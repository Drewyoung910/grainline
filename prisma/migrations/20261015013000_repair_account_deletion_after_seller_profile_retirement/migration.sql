-- Repair the account-deletion claim and Order scrub after SellerProfile private
-- predecessor retirement. The predecessor migration is already immutable in
-- Production, so both corrections are forward-only and preserve the existing
-- function identities, owners, security posture, and ACLs.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE TEMPORARY TABLE account_deletion_repair_function_state
ON COMMIT DROP
AS
SELECT procedure.oid,
       procedure.oid::regprocedure::text AS identity,
       procedure.proowner,
       procedure.proacl,
       procedure.prosecdef,
       procedure.provolatile,
       procedure.proparallel,
       procedure.proconfig
  FROM pg_catalog.pg_proc AS procedure
 WHERE procedure.oid IN (
   'public.grainline_account_deletion_side_effect_claim(text)'::regprocedure,
   'public.grainline_order_account_deletion_scrub(text,text[])'::regprocedure
 );

DO $account_deletion_repair_preflight$
DECLARE
  retirement_checksum constant text :=
    'd111e615a40cd0c2936eeb137db23c5fbcc63c7acb81bce27a36d71229963b3a';
  source_function record;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public._prisma_migrations AS migration
     WHERE migration.migration_name =
       '20261015010000_retire_seller_profile_private_predecessor'
       AND migration.checksum = retirement_checksum
       AND migration.finished_at IS NOT NULL
       AND migration.rolled_back_at IS NULL
       AND migration.applied_steps_count = 1
  ) THEN
    RAISE EXCEPTION
      'Account deletion repair requires the exact SellerProfile predecessor retirement';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'public."SellerProfile"'::regclass
       AND attribute.attname IN (
         'shipFromName',
         'shipFromLine1',
         'shipFromLine2',
         'shipFromCity',
         'shipFromState',
         'shipFromPostal'
       )
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION
      'Account deletion repair found unretired SellerProfile private columns';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'public."SellerProfilePrivate"'::regclass
       AND attribute.attname IN (
         'shipFromName',
         'shipFromLine1',
         'shipFromLine2',
         'shipFromCity',
         'shipFromState',
         'shipFromPostal'
       )
       AND NOT attribute.attisdropped
  ) <> 6 THEN
    RAISE EXCEPTION
      'Account deletion repair cannot find the private shipping source';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM account_deletion_repair_function_state) <> 2 THEN
    RAISE EXCEPTION 'Account deletion repair function inventory is incomplete';
  END IF;

  FOR source_function IN
    SELECT * FROM account_deletion_repair_function_state
  LOOP
    IF source_function.proowner <> (
         SELECT role.oid
           FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = current_user
       )
       OR NOT source_function.prosecdef
       OR source_function.provolatile <> 'v'
       OR source_function.proparallel <> 'u'
       OR source_function.proconfig IS DISTINCT FROM
            ARRAY['search_path=pg_catalog']::text[] THEN
      RAISE EXCEPTION
        'Account deletion repair found unsafe posture for %',
        source_function.identity;
    END IF;
  END LOOP;
END
$account_deletion_repair_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_account_deletion_side_effect_claim(
  p_side_effect_id text
)
RETURNS TABLE(
  action text,
  side_effect_id text,
  user_id text,
  effect_kind text,
  effect_payload jsonb,
  attempt_count integer,
  claim_generation bigint,
  claim_token text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_account_deletion_side_effect_claim$
DECLARE
  source_effect public."AccountDeletionSideEffect"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_side_effect_id IS NULL
     OR pg_catalog.btrim(p_side_effect_id) = ''
     OR pg_catalog.char_length(p_side_effect_id) > 191 THEN
    RAISE EXCEPTION 'Account deletion side effect id is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."AccountDeletionSideEffect" AS effect
     SET status = 'PROCESSING',
         attempts = effect.attempts + 1,
         "claimGeneration" = effect."claimGeneration" + 1,
         "claimToken" = pg_catalog.gen_random_uuid(),
         "processingStartedAt" = source_now,
         "lastError" = NULL,
         "updatedAt" = source_now
   WHERE effect.id = p_side_effect_id
     AND (
       (
         effect.status IN ('PENDING', 'FAILED')
         AND (
           effect."nextAttemptAt" IS NULL
           OR effect."nextAttemptAt" <= source_now
         )
       )
       OR (
         effect.status = 'PROCESSING'
         AND COALESCE(effect."processingStartedAt", effect."updatedAt")
               < source_now - interval '1 hour'
       )
     )
  RETURNING effect.* INTO source_effect;

  IF FOUND THEN
    RETURN QUERY SELECT
      'process'::text,
      source_effect.id,
      source_effect."userId"::text,
      source_effect.kind::text,
      source_effect.payload,
      source_effect.attempts,
      source_effect."claimGeneration",
      source_effect."claimToken"::text;
    RETURN;
  END IF;

  SELECT effect.*
    INTO source_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'missing'::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::jsonb,
      NULL::integer,
      NULL::bigint,
      NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    CASE WHEN source_effect.status = 'DONE'
      THEN 'done'::text
      ELSE 'unavailable'::text
    END,
    source_effect.id,
    NULL::text,
    NULL::text,
    NULL::jsonb,
    NULL::integer,
    source_effect."claimGeneration",
    NULL::text;
END
$grainline_account_deletion_side_effect_claim$;

CREATE OR REPLACE FUNCTION public.grainline_order_account_deletion_scrub(
  p_actor_user_id text,
  p_additional_sensitive_values text[]
)
RETURNS TABLE(
  review_notes_redacted bigint,
  buyer_orders_scrubbed bigint,
  seller_orders_scrubbed bigint,
  shipping_quotes_deleted bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_account_deletion_scrub$
DECLARE
  session_actor_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  locked_actor public."User"%ROWTYPE;
  source_seller_profile_id text;
  source_seller_private_id text;
  source_seller_display_name text;
  source_seller_city text;
  source_seller_state text;
  source_seller_ship_from_name text;
  source_seller_ship_from_line_1 text;
  source_seller_ship_from_line_2 text;
  source_seller_ship_from_city text;
  source_seller_ship_from_state text;
  source_seller_ship_from_postal text;
  source_seller_tagline text;
  source_seller_banner_image_url text;
  source_seller_avatar_image_url text;
  source_seller_workshop_image_url text;
  source_seller_instagram_url text;
  source_seller_facebook_url text;
  source_seller_pinterest_url text;
  source_seller_tiktok_url text;
  source_seller_website_url text;
  purge_at timestamp(3) without time zone;
  sensitive_values text[];
  blocker_buyer_count bigint;
  blocker_seller_count bigint;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR COALESCE(pg_catalog.array_length(p_additional_sensitive_values, 1), 0) > 128
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(
           COALESCE(p_additional_sensitive_values, ARRAY[]::text[])
         ) AS supplied(value)
        WHERE supplied.value IS NULL
           OR pg_catalog.char_length(supplied.value) NOT BETWEEN 1 AND 2048
     ) THEN
    RAISE EXCEPTION 'Order account-deletion scrub input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF session_actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Order account-deletion actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT actor.*
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR UPDATE OF actor;
  IF NOT FOUND OR locked_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Order account-deletion actor is unavailable'
      USING ERRCODE = '23503';
  END IF;

  SELECT seller.id,
         seller_private."sellerProfileId",
         seller."displayName",
         seller.city,
         seller.state,
         seller_private."shipFromName",
         seller_private."shipFromLine1",
         seller_private."shipFromLine2",
         seller_private."shipFromCity",
         seller_private."shipFromState",
         seller_private."shipFromPostal",
         seller.tagline,
         seller."bannerImageUrl",
         seller."avatarImageUrl",
         seller."workshopImageUrl",
         seller."instagramUrl",
         seller."facebookUrl",
         seller."pinterestUrl",
         seller."tiktokUrl",
         seller."websiteUrl"
    INTO source_seller_profile_id,
         source_seller_private_id,
         source_seller_display_name,
         source_seller_city,
         source_seller_state,
         source_seller_ship_from_name,
         source_seller_ship_from_line_1,
         source_seller_ship_from_line_2,
         source_seller_ship_from_city,
         source_seller_ship_from_state,
         source_seller_ship_from_postal,
         source_seller_tagline,
         source_seller_banner_image_url,
         source_seller_avatar_image_url,
         source_seller_workshop_image_url,
         source_seller_instagram_url,
         source_seller_facebook_url,
         source_seller_pinterest_url,
         source_seller_tiktok_url,
         source_seller_website_url
    FROM public."SellerProfile" AS seller
    LEFT JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."userId" = locked_actor.id;

  IF source_seller_profile_id IS NOT NULL
     AND source_seller_private_id IS NULL THEN
    RAISE EXCEPTION 'Order account-deletion seller private state is unavailable'
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT blocker.buyer_order_count, blocker.seller_order_count
    INTO STRICT blocker_buyer_count, blocker_seller_count
    FROM public.grainline_order_account_deletion_blockers(
      p_actor_user_id
    ) AS blocker;
  IF blocker_buyer_count <> 0 OR blocker_seller_count <> 0 THEN
    RAISE EXCEPTION 'Order account-deletion obligations changed after the initial check'
      USING ERRCODE = '40001';
  END IF;

  purge_at := (
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;

  SELECT ARRAY(
    SELECT DISTINCT normalized.value
      FROM (
        SELECT pg_catalog.btrim(supplied.value) AS value
          FROM pg_catalog.unnest(
            COALESCE(p_additional_sensitive_values, ARRAY[]::text[])
          ) AS supplied(value)
        UNION ALL
        SELECT pg_catalog.btrim(derived.value)
          FROM (VALUES
            (locked_actor.id),
            (locked_actor."clerkId"),
            (locked_actor.email),
            (locked_actor.name),
            (locked_actor."shippingName"),
            (locked_actor."shippingLine1"),
            (locked_actor."shippingLine2"),
            (locked_actor."shippingCity"),
            (locked_actor."shippingState"),
            (locked_actor."shippingPostalCode"),
            (locked_actor."shippingPhone"),
            (source_seller_profile_id),
            (source_seller_display_name),
            (source_seller_city),
            (source_seller_state),
            (source_seller_ship_from_name),
            (source_seller_ship_from_line_1),
            (source_seller_ship_from_line_2),
            (source_seller_ship_from_city),
            (source_seller_ship_from_state),
            (source_seller_ship_from_postal),
            (source_seller_tagline),
            (source_seller_banner_image_url),
            (source_seller_avatar_image_url),
            (source_seller_workshop_image_url),
            (source_seller_instagram_url),
            (source_seller_facebook_url),
            (source_seller_pinterest_url),
            (source_seller_tiktok_url),
            (source_seller_website_url)
          ) AS derived(value)
      ) AS normalized
     WHERE normalized.value IS NOT NULL
       AND normalized.value <> ''
     ORDER BY normalized.value
  ) INTO sensitive_values;

  UPDATE public."Order" AS target_order
     SET "reviewNote" = public.grainline_account_deletion_redact_text_core(
       target_order."reviewNote",
       sensitive_values
     )
   WHERE target_order."reviewNote" IS NOT NULL
     AND (
       target_order."buyerId" = locked_actor.id
       OR (
         source_seller_profile_id IS NOT NULL
         AND target_order."sellerProfileId" = source_seller_profile_id
       )
     )
     AND public.grainline_account_deletion_redact_text_core(
       target_order."reviewNote",
       sensitive_values
     ) IS DISTINCT FROM target_order."reviewNote";
  GET DIAGNOSTICS review_notes_redacted = ROW_COUNT;

  UPDATE public."Order" AS target_order
     SET "buyerEmail" = NULL,
         "buyerName" = NULL,
         "shipToLine1" = NULL,
         "shipToLine2" = NULL,
         "shipToCity" = NULL,
         "shipToState" = NULL,
         "shipToPostalCode" = NULL,
         "shipToCountry" = NULL,
         "quotedToLine1" = NULL,
         "quotedToLine2" = NULL,
         "quotedToCity" = NULL,
         "quotedToState" = NULL,
         "quotedToPostalCode" = NULL,
         "quotedToCountry" = NULL,
         "quotedToName" = NULL,
         "quotedToPhone" = NULL,
         "trackingCarrier" = NULL,
         "trackingNumber" = NULL,
         "sellerNotes" = NULL,
         "shippoShipmentId" = NULL,
         "shippoRateObjectId" = NULL,
         "shippoTransactionId" = NULL,
         "labelUrl" = NULL,
         "labelCarrier" = NULL,
         "labelTrackingNumber" = NULL,
         "giftNote" = NULL,
         "buyerDataPurgedAt" = COALESCE(
           target_order."buyerDataPurgedAt",
           purge_at
         )
   WHERE target_order."buyerId" = locked_actor.id;
  GET DIAGNOSTICS buyer_orders_scrubbed = ROW_COUNT;

  IF source_seller_profile_id IS NULL THEN
    seller_orders_scrubbed := 0;
  ELSE
    UPDATE public."Order" AS target_order
       SET "trackingCarrier" = NULL,
           "trackingNumber" = NULL,
           "sellerNotes" = NULL,
           "shippoShipmentId" = NULL,
           "shippoRateObjectId" = NULL,
           "shippoTransactionId" = NULL,
           "labelUrl" = NULL,
           "labelCarrier" = NULL,
           "labelTrackingNumber" = NULL
     WHERE target_order."sellerProfileId" = source_seller_profile_id;
    GET DIAGNOSTICS seller_orders_scrubbed = ROW_COUNT;
  END IF;

  WITH deleted_quotes AS (
    DELETE FROM public."OrderShippingRateQuote" AS quote
    USING public."Order" AS source_order
     WHERE quote."orderId" = source_order.id
       AND (
         source_order."buyerId" = locked_actor.id
         OR (
           source_seller_profile_id IS NOT NULL
           AND source_order."sellerProfileId" = source_seller_profile_id
         )
       )
    RETURNING quote.id
  )
  SELECT pg_catalog.count(*)::bigint
    INTO STRICT shipping_quotes_deleted
    FROM deleted_quotes;

  RETURN NEXT;
END
$grainline_order_account_deletion_scrub$;

DO $account_deletion_repair_postflight$
DECLARE
  source_function record;
  current_function record;
  claim_definition text := pg_catalog.pg_get_functiondef(
    'public.grainline_account_deletion_side_effect_claim(text)'::regprocedure
  );
  scrub_definition text := pg_catalog.pg_get_functiondef(
    'public.grainline_order_account_deletion_scrub(text,text[])'::regprocedure
  );
BEGIN
  FOR source_function IN
    SELECT * FROM account_deletion_repair_function_state
  LOOP
    SELECT procedure.proowner,
           procedure.proacl,
           procedure.prosecdef,
           procedure.provolatile,
           procedure.proparallel,
           procedure.proconfig
      INTO STRICT current_function
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = source_function.oid;

    IF current_function.proowner IS DISTINCT FROM source_function.proowner
       OR current_function.proacl IS DISTINCT FROM source_function.proacl
       OR current_function.prosecdef IS DISTINCT FROM source_function.prosecdef
       OR current_function.provolatile IS DISTINCT FROM source_function.provolatile
       OR current_function.proparallel IS DISTINCT FROM source_function.proparallel
       OR current_function.proconfig IS DISTINCT FROM source_function.proconfig THEN
      RAISE EXCEPTION
        'Account deletion repair changed security posture for %',
        source_function.identity;
    END IF;
  END LOOP;

  IF pg_catalog.strpos(claim_definition, 'source_effect."userId"::text') = 0
     OR pg_catalog.strpos(claim_definition, 'source_effect.kind::text') = 0 THEN
    RAISE EXCEPTION 'Account deletion claim return casts are missing';
  END IF;

  IF pg_catalog.strpos(scrub_definition, 'SellerProfile"%ROWTYPE') <> 0
     OR pg_catalog.strpos(scrub_definition, 'seller_private."shipFromName"') = 0
     OR pg_catalog.strpos(scrub_definition, 'seller_private."shipFromPostal"') = 0 THEN
    RAISE EXCEPTION 'Account deletion scrub still depends on retired columns';
  END IF;
END
$account_deletion_repair_postflight$;

COMMIT;
