-- Fixed Order review-state authority for seller ban and unban flows.
-- Database-first draft only; not a production migration.

CREATE OR REPLACE FUNCTION public.grainline_order_flag_banned_seller_open_orders(
  p_actor_user_id text,
  p_target_user_id text
)
RETURNS TABLE (
  order_id text,
  buyer_id text,
  previous_review_needed boolean,
  previous_review_note_hash text,
  previous_review_note_length integer,
  added_review_note boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_flag_banned_seller_open_orders$
DECLARE
  source_seller_profile_id text;
  locked_order public."Order"%ROWTYPE;
  marker CONSTANT text :=
    'Seller account was banned after payment. Staff must review fulfillment and refund options before further action.';
  prior_note text;
  next_note text;
  flagged_count integer := 0;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_target_user_id IS NULL
     OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'Ban Order review input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
     AND actor.role::text = 'ADMIN'
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ban Order review mutation requires an active administrator'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1
    FROM public."User" AS target_user
   WHERE target_user.id = p_target_user_id
     AND target_user.role::text <> 'ADMIN'
     AND target_user.banned = true
     AND target_user."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ban Order review target is not an active banned user'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT seller.id
    INTO source_seller_profile_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = p_target_user_id
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR locked_order IN
    SELECT source_order.*
      FROM public."Order" AS source_order
     WHERE source_order."sellerProfileId" = source_seller_profile_id
       AND source_order."fulfillmentStatus"::text IN (
         'PENDING', 'READY_FOR_PICKUP', 'SHIPPED'
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
     ORDER BY source_order.id
     FOR UPDATE
  LOOP
    flagged_count := flagged_count + 1;
    IF flagged_count > 5000 THEN
      RAISE EXCEPTION 'Ban Order review set is too large'
        USING ERRCODE = 'program_limit_exceeded';
    END IF;
    prior_note := locked_order."reviewNote";
    previous_review_note_hash := CASE
      WHEN COALESCE(prior_note, '') = '' THEN NULL
      ELSE pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(prior_note, 'UTF8')),
        'hex'
      )
    END;
    previous_review_note_length := pg_catalog.char_length(COALESCE(prior_note, ''));

    IF COALESCE(prior_note, '') = '' THEN
      next_note := marker;
      added_review_note := true;
    ELSIF pg_catalog.strpos(prior_note, marker) > 0 THEN
      next_note := prior_note;
      added_review_note := false;
    ELSIF pg_catalog.char_length(prior_note) + 2 + pg_catalog.char_length(marker) <= 10000 THEN
      next_note := prior_note || E'\n\n' || marker;
      added_review_note := true;
    ELSE
      -- Never truncate existing staff notes merely to append the ban marker.
      next_note := prior_note;
      added_review_note := false;
    END IF;

    UPDATE public."Order"
       SET "reviewNeeded" = true,
           "reviewNote" = next_note
     WHERE id = locked_order.id;

    order_id := locked_order.id;
    buyer_id := locked_order."buyerId";
    previous_review_needed := locked_order."reviewNeeded";
    RETURN NEXT;
  END LOOP;
END
$grainline_order_flag_banned_seller_open_orders$;

CREATE OR REPLACE FUNCTION public.grainline_order_restore_banned_seller_reviews(
  p_actor_user_id text,
  p_target_user_id text,
  p_snapshots jsonb
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_restore_banned_seller_reviews$
DECLARE
  source_seller_profile_id text;
  snapshot jsonb;
  locked_order public."Order"%ROWTYPE;
  marker CONSTANT text :=
    'Seller account was banned after payment. Staff must review fulfillment and refund options before further action.';
  marker_suffix CONSTANT text := E'\n\n' ||
    'Seller account was banned after payment. Staff must review fulfillment and refund options before further action.';
  prior_note text;
  prior_hash text;
  restored_count integer := 0;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_target_user_id IS NULL
     OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_snapshots IS NULL
     OR pg_catalog.jsonb_typeof(p_snapshots) <> 'array'
     OR pg_catalog.jsonb_array_length(p_snapshots) > 5000 THEN
    RAISE EXCEPTION 'Ban Order restore input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
     AND actor.role::text = 'ADMIN'
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ban Order restore requires an active administrator'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1
    FROM public."User" AS target_user
   WHERE target_user.id = p_target_user_id
     AND target_user.role::text <> 'ADMIN'
     AND target_user.banned = true
     AND target_user."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ban Order restore target is not an active banned user'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT seller.id
    INTO source_seller_profile_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = p_target_user_id
   FOR SHARE;
  IF NOT FOUND THEN
    IF pg_catalog.jsonb_array_length(p_snapshots) <> 0 THEN
      RAISE EXCEPTION 'Ban Order restore snapshots have no target seller'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_snapshots) AS item(value)
     WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
        OR NOT (item.value ? 'id')
        OR item.value->>'id' !~ '^[A-Za-z0-9._:-]{1,191}$'
        OR pg_catalog.jsonb_typeof(item.value->'previousReviewNeeded') <> 'boolean'
        OR NOT (item.value ? 'previousReviewNoteHash')
        OR (
          pg_catalog.jsonb_typeof(item.value->'previousReviewNoteHash') <> 'null'
          AND (
            pg_catalog.jsonb_typeof(item.value->'previousReviewNoteHash') <> 'string'
            OR item.value->>'previousReviewNoteHash' !~ '^[a-f0-9]{64}$'
          )
        )
        OR pg_catalog.jsonb_typeof(item.value->'previousReviewNoteLength') <> 'number'
        OR (item.value->>'previousReviewNoteLength') !~ '^(0|[1-9][0-9]{0,4})$'
        OR (item.value->>'previousReviewNoteLength')::integer > 10000
        OR (
          item.value ? 'addedReviewNote'
          AND pg_catalog.jsonb_typeof(item.value->'addedReviewNote') <> 'boolean'
        )
  ) THEN
    RAISE EXCEPTION 'Ban Order restore snapshot is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.jsonb_array_elements(p_snapshots) AS item(value)
  ) IS DISTINCT FROM (
    SELECT pg_catalog.count(DISTINCT item.value->>'id')
      FROM pg_catalog.jsonb_array_elements(p_snapshots) AS item(value)
  ) THEN
    RAISE EXCEPTION 'Ban Order restore snapshots contain duplicate Orders'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_snapshots) AS item(value)
      LEFT JOIN public."Order" AS source_order
        ON source_order.id = item.value->>'id'
       AND source_order."sellerProfileId" = source_seller_profile_id
     WHERE source_order.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Ban Order restore snapshot is outside the target seller'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR snapshot IN
    SELECT item.value
      FROM pg_catalog.jsonb_array_elements(p_snapshots) AS item(value)
     ORDER BY item.value->>'id'
  LOOP
    SELECT source_order.*
      INTO STRICT locked_order
      FROM public."Order" AS source_order
     WHERE source_order.id = snapshot->>'id'
       AND source_order."sellerProfileId" = source_seller_profile_id
     FOR UPDATE;

    IF COALESCE((snapshot->>'addedReviewNote')::boolean, true) = false THEN
      CONTINUE;
    END IF;

    prior_note := NULL;
    IF locked_order."reviewNote" = marker
       AND pg_catalog.jsonb_typeof(snapshot->'previousReviewNoteHash') = 'null'
       AND (snapshot->>'previousReviewNoteLength')::integer = 0 THEN
      prior_note := NULL;
    ELSIF pg_catalog.right(
      COALESCE(locked_order."reviewNote", ''),
      pg_catalog.char_length(marker_suffix)
    ) = marker_suffix THEN
      prior_note := pg_catalog.left(
        locked_order."reviewNote",
        pg_catalog.char_length(locked_order."reviewNote")
          - pg_catalog.char_length(marker_suffix)
      );
      prior_hash := pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(prior_note, 'UTF8')),
        'hex'
      );
      IF prior_hash IS DISTINCT FROM snapshot->>'previousReviewNoteHash'
         OR pg_catalog.char_length(prior_note)
              IS DISTINCT FROM (snapshot->>'previousReviewNoteLength')::integer THEN
        CONTINUE;
      END IF;
    ELSE
      CONTINUE;
    END IF;

    UPDATE public."Order"
       SET "reviewNeeded" = (snapshot->>'previousReviewNeeded')::boolean,
           "reviewNote" = prior_note
     WHERE id = locked_order.id;
    restored_count := restored_count + 1;
  END LOOP;

  RETURN restored_count;
END
$grainline_order_restore_banned_seller_reviews$;

REVOKE ALL ON FUNCTION public.grainline_order_flag_banned_seller_open_orders(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_restore_banned_seller_reviews(text, text, jsonb)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_flag_banned_seller_open_orders(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_restore_banned_seller_reviews(text, text, jsonb)
  TO grainline_app_runtime;
