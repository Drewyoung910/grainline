BEGIN;

-- Compatible preparation only. Follow RLS and predecessor table grants remain
-- unchanged until all callers, races, cascades and rollback behavior pass the
-- separate activation review.
DO $grainline_follow_preflight$
DECLARE
  missing_predecessors text[];
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."Follow"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Follow RLS must remain off during compatible preparation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid IN (
       pg_catalog.to_regprocedure('public.grainline_follow_public_state_batch(text[])'),
       pg_catalog.to_regprocedure('public.grainline_follow_source_notification_page(text,text,text,integer)'),
       pg_catalog.to_regprocedure('public.grainline_follow_owner_target_ids(integer)'),
       pg_catalog.to_regprocedure('public.grainline_follow_owner_outgoing_count()'),
       pg_catalog.to_regprocedure('public.grainline_follow_seller_owner_incoming_count()'),
       pg_catalog.to_regprocedure('public.grainline_follow_account_deletion_cleanup(text,text,bigint,uuid)')
     )
  ) THEN
    RAISE EXCEPTION 'Follow preparation function already exists';
  END IF;

  SELECT pg_catalog.array_agg(expected.signature ORDER BY expected.signature)
    INTO missing_predecessors
    FROM (
      VALUES
        ('public.grainline_seller_public_follow_state(text)'),
        ('public.grainline_seller_owner_following_count()'),
        ('public.grainline_seller_owner_following_page(integer,integer)'),
        ('public.grainline_seller_public_follow_create(text,text)'),
        ('public.grainline_seller_public_follow_delete(text)'),
        ('public.grainline_seller_owner_follow_export()'),
        ('public.grainline_user_follower_notification_page(text,text,integer)'),
        ('public.grainline_user_owner_broadcast_follower_page(text,text,integer,boolean)'),
        ('public.grainline_user_block_follow_cleanup(text)')
    ) AS expected(signature)
   WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL;
  IF missing_predecessors IS NOT NULL THEN
    RAISE EXCEPTION 'Follow predecessor functions are missing: %', missing_predecessors;
  END IF;
END;
$grainline_follow_preflight$;

CREATE FUNCTION public.grainline_follow_public_state_batch(
  p_seller_profile_ids text[]
)
RETURNS TABLE (
  "sellerProfileId" text,
  "followerCount" bigint,
  following boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_follow_public_state_batch$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_seller_profile_ids IS NULL
     OR pg_catalog.cardinality(p_seller_profile_ids) < 1
     OR pg_catalog.cardinality(p_seller_profile_ids) > 100
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_seller_profile_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR requested.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR pg_catalog.cardinality(p_seller_profile_ids) <> (
       SELECT pg_catalog.count(DISTINCT requested.id)
         FROM pg_catalog.unnest(p_seller_profile_ids) AS requested(id)
     )
     OR (
       request_user_id IS NOT NULL
       AND request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'Follow public state batch input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id::text,
         (
           SELECT pg_catalog.count(*)::bigint
             FROM public."Follow" AS relationship
            WHERE relationship."sellerProfileId" = seller.id
         ),
         request_user_id IS NOT NULL
         AND EXISTS (
           SELECT 1
             FROM public."User" AS actor
             JOIN public."Follow" AS relationship
               ON relationship."followerId" = actor.id
              AND relationship."sellerProfileId" = seller.id
            WHERE actor.id = request_user_id
              AND actor.banned = false
              AND actor."deletedAt" IS NULL
         )
    FROM pg_catalog.unnest(p_seller_profile_ids) WITH ORDINALITY AS requested(id, position)
    JOIN public."SellerProfile" AS seller
      ON seller.id = requested.id
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
   ORDER BY requested.position;
END;
$grainline_follow_public_state_batch$;

-- The predecessor fanout projection accepts any seller-profile id and exposes
-- that shop's follower ids to the runtime role. Keep it available for the
-- deployed predecessor during compatible preparation, but move the prepared
-- application to this exact-source projection. A public listing or published
-- maker post is now required before any follower row can leave the boundary;
-- notification creation independently revalidates the same source/follower
-- relationship before inserting a row.
CREATE FUNCTION public.grainline_follow_source_notification_page(
  p_source_type text,
  p_source_id text,
  p_after_follow_id text,
  p_limit integer
)
RETURNS TABLE (
  "followId" text,
  "followerId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_follow_source_notification_page$
DECLARE
  source_seller_profile_id text;
  source_seller_user_id text;
BEGIN
  IF p_source_type NOT IN (
       'followed_maker_new_listing',
       'followed_maker_new_blog'
     )
     OR p_source_id IS NULL
     OR p_source_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_after_follow_id IS NOT NULL
         AND p_after_follow_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Follow notification source page input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_type = 'followed_maker_new_listing' THEN
    SELECT seller.id, seller."userId"
      INTO source_seller_profile_id, source_seller_user_id
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
      JOIN public."User" AS seller_user
        ON seller_user.id = seller."userId"
     WHERE listing.id = p_source_id
       AND listing.status = 'ACTIVE'
       AND listing."isPrivate" = false
       AND seller."chargesEnabled" = true
       AND seller."vacationMode" = false
       AND (seller."stripeAccountVersion" IS NULL
            OR seller."stripeAccountVersion" = 'v2')
       AND seller_user.banned = false
       AND seller_user."deletedAt" IS NULL;
  ELSE
    SELECT seller.id, seller."userId"
      INTO source_seller_profile_id, source_seller_user_id
      FROM public."BlogPost" AS post
      JOIN public."SellerProfile" AS seller
        ON seller.id = post."sellerProfileId"
      JOIN public."User" AS seller_user
        ON seller_user.id = seller."userId"
     WHERE post.id = p_source_id
       AND post."authorType" = 'MAKER'
       AND post.status = 'PUBLISHED'
       AND post."publishedAt" IS NOT NULL
       AND post."publishedAt" <= (
         pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
       )
       AND post."authorAccountActive" = true
       AND seller."chargesEnabled" = true
       AND seller."vacationMode" = false
       AND (seller."stripeAccountVersion" IS NULL
            OR seller."stripeAccountVersion" = 'v2')
       AND seller_user.banned = false
       AND seller_user."deletedAt" IS NULL;
  END IF;

  IF source_seller_profile_id IS NULL OR source_seller_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT relationship.id,
         relationship."followerId"
    FROM public."Follow" AS relationship
    JOIN public."User" AS follower
      ON follower.id = relationship."followerId"
     AND follower.banned = false
     AND follower."deletedAt" IS NULL
   WHERE relationship."sellerProfileId" = source_seller_profile_id
     AND relationship."followerId" <> source_seller_user_id
     AND (p_after_follow_id IS NULL OR relationship.id > p_after_follow_id)
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS blocked_pair
        WHERE (
                blocked_pair."blockerId" = relationship."followerId"
            AND blocked_pair."blockedId" = source_seller_user_id
              )
           OR (
                blocked_pair."blockerId" = source_seller_user_id
            AND blocked_pair."blockedId" = relationship."followerId"
              )
     )
   ORDER BY relationship.id
   LIMIT p_limit;
END;
$grainline_follow_source_notification_page$;

CREATE FUNCTION public.grainline_follow_owner_target_ids(
  p_limit integer
)
RETURNS TABLE ("sellerProfileId" text)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_follow_owner_target_ids$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Follow owner target input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Follow owner target actor is inactive'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT relationship."sellerProfileId"::text
    FROM public."Follow" AS relationship
   WHERE relationship."followerId" = request_user_id
   ORDER BY relationship."createdAt" DESC, relationship.id DESC
   LIMIT p_limit;
END;
$grainline_follow_owner_target_ids$;

CREATE FUNCTION public.grainline_follow_owner_outgoing_count()
RETURNS TABLE (value bigint)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_follow_owner_outgoing_count$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = request_user_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Follow owner outgoing-count context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT pg_catalog.count(*)::bigint
    FROM public."Follow" AS relationship
   WHERE relationship."followerId" = request_user_id;
END;
$grainline_follow_owner_outgoing_count$;

CREATE FUNCTION public.grainline_follow_seller_owner_incoming_count()
RETURNS TABLE (value bigint)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_follow_seller_owner_incoming_count$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  owned_seller_profile_id text;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Follow seller-owner context is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id
    INTO owned_seller_profile_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
  IF owned_seller_profile_id IS NULL THEN
    RAISE EXCEPTION 'Follow seller-owner context has no seller profile'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT pg_catalog.count(*)::bigint
    FROM public."Follow" AS relationship
   WHERE relationship."sellerProfileId" = owned_seller_profile_id;
END;
$grainline_follow_seller_owner_incoming_count$;

CREATE FUNCTION public.grainline_follow_account_deletion_cleanup(
  p_side_effect_id text,
  p_expected_user_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_follow_account_deletion_cleanup$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  owned_seller_profile_id text;
  deleted_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_expected_user_id IS NULL
     OR p_expected_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR request_user_id IS DISTINCT FROM p_expected_user_id
     OR p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Follow account-deletion context is invalid'
      USING ERRCODE = '42501';
  END IF;

  -- Match the account-deletion protocol's User-before-side-effect lock order.
  SELECT seller.id
    INTO owned_seller_profile_id
    FROM public."User" AS actor
    LEFT JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = p_expected_user_id
   FOR UPDATE OF actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Follow account-deletion user is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
     AND effect."userId" = p_expected_user_id
     AND effect.kind = 'LOCAL_ANONYMIZE'
     AND effect."dedupKey" = 'account-delete:local:' || p_expected_user_id
     AND effect.payload = '{}'::jsonb
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
     AND effect."processingStartedAt" IS NOT NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Follow account-deletion claim is not authorized'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."Follow" AS relationship
   WHERE relationship."followerId" = p_expected_user_id
      OR (
        owned_seller_profile_id IS NOT NULL
        AND relationship."sellerProfileId" = owned_seller_profile_id
      );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_follow_account_deletion_cleanup$;

REVOKE ALL ON FUNCTION public.grainline_follow_public_state_batch(text[])
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_follow_source_notification_page(text,text,text,integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_follow_owner_target_ids(integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_follow_owner_outgoing_count()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_follow_seller_owner_incoming_count()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_follow_account_deletion_cleanup(text,text,bigint,uuid)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_follow_public_state_batch(text[])
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_follow_source_notification_page(text,text,text,integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_follow_owner_target_ids(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_follow_owner_outgoing_count()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_follow_seller_owner_incoming_count()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_follow_account_deletion_cleanup(text,text,bigint,uuid)
  TO grainline_app_runtime;

DO $grainline_follow_postflight$
DECLARE
  missing_functions text[];
BEGIN
  SELECT pg_catalog.array_agg(expected.signature ORDER BY expected.signature)
    INTO missing_functions
    FROM (
      VALUES
        ('public.grainline_follow_public_state_batch(text[])'),
        ('public.grainline_follow_source_notification_page(text,text,text,integer)'),
        ('public.grainline_follow_owner_target_ids(integer)'),
        ('public.grainline_follow_owner_outgoing_count()'),
        ('public.grainline_follow_seller_owner_incoming_count()'),
        ('public.grainline_follow_account_deletion_cleanup(text,text,bigint,uuid)')
    ) AS expected(signature)
   WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL;
  IF missing_functions IS NOT NULL THEN
    RAISE EXCEPTION 'Follow preparation functions are missing: %', missing_functions;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."Follow"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Follow RLS changed during compatible preparation';
  END IF;
END;
$grainline_follow_postflight$;

COMMIT;
