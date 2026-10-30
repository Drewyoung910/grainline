BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- Compatible preparation only. SellerFaq RLS and predecessor table grants
-- remain unchanged until every caller and the separate activation proof pass.
DO $grainline_seller_faq_preflight$
DECLARE
  missing_predecessors text[];
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."SellerFaq"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'SellerFaq RLS must remain off during compatible preparation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid IN (
       pg_catalog.to_regprocedure('public.grainline_seller_faq_owner_create(text,text,text)'),
       pg_catalog.to_regprocedure('public.grainline_seller_faq_owner_remove(text)'),
       pg_catalog.to_regprocedure('public.grainline_seller_faq_owner_export()'),
       pg_catalog.to_regprocedure('public.grainline_seller_faq_account_deletion_cleanup(text,text,bigint,uuid)')
     )
  ) THEN
    RAISE EXCEPTION 'SellerFaq preparation function already exists';
  END IF;

  SELECT pg_catalog.array_agg(expected.signature ORDER BY expected.signature)
    INTO missing_predecessors
    FROM (
      VALUES
        ('public.grainline_seller_public_profile(text)'),
        ('public.grainline_seller_owner_profile_editor_state(text)')
    ) AS expected(signature)
   WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL;
  IF missing_predecessors IS NOT NULL THEN
    RAISE EXCEPTION 'SellerFaq retained reader functions are missing: %', missing_predecessors;
  END IF;
END;
$grainline_seller_faq_preflight$;

CREATE FUNCTION public.grainline_seller_faq_owner_create(
  p_faq_id text,
  p_question text,
  p_answer text
)
RETURNS TABLE (
  "resultStatus" text,
  id text,
  "sortOrder" integer,
  created boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_faq_owner_create$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  actor_active boolean := false;
  owned_seller_profile_id text;
  next_sort_order integer;
  existing_row public."SellerFaq"%ROWTYPE;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'SellerFaq owner context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_faq_id IS NULL
     OR p_faq_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_question IS NULL
     OR pg_catalog.char_length(p_question) NOT BETWEEN 1 AND 200
     OR pg_catalog.btrim(p_question) = ''
     OR p_answer IS NULL
     OR pg_catalog.char_length(p_answer) NOT BETWEEN 1 AND 2000
     OR pg_catalog.btrim(p_answer) = '' THEN
    RAISE EXCEPTION 'SellerFaq create input is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Account deletion takes the same User-before-domain-row lock order. Once
  -- this lock is held, a concurrent deletion either finished and is observed,
  -- or waits and includes this row in its claimed cleanup.
  SELECT actor.banned = false AND actor."deletedAt" IS NULL
    INTO actor_active
    FROM public."User" AS actor
   WHERE actor.id = request_user_id
   FOR UPDATE;
  IF NOT FOUND OR NOT actor_active THEN
    RAISE EXCEPTION 'SellerFaq owner context is inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id
    INTO owned_seller_profile_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = request_user_id
     AND seller."ownerAccountActive" = true
   FOR UPDATE;
  IF owned_seller_profile_id IS NULL THEN
    RAISE EXCEPTION 'SellerFaq owner context has no active seller profile'
      USING ERRCODE = '42501';
  END IF;

  SELECT faq.*
    INTO existing_row
    FROM public."SellerFaq" AS faq
   WHERE faq.id = p_faq_id;
  IF FOUND THEN
    IF existing_row."sellerProfileId" = owned_seller_profile_id
       AND existing_row.question = p_question
       AND existing_row.answer = p_answer THEN
      RETURN QUERY
      SELECT 'OK'::text, existing_row.id::text,
             existing_row."sortOrder", false;
      RETURN;
    END IF;
    RAISE EXCEPTION 'SellerFaq id already belongs to different content'
      USING ERRCODE = '23505';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM public."SellerFaq" AS faq
     WHERE faq."sellerProfileId" = owned_seller_profile_id
  ) >= 20 THEN
    RETURN QUERY SELECT 'LIMIT_REACHED'::text, NULL::text, NULL::integer, false;
    RETURN;
  END IF;

  SELECT COALESCE(pg_catalog.max(faq."sortOrder"), 0) + 1
    INTO next_sort_order
    FROM public."SellerFaq" AS faq
   WHERE faq."sellerProfileId" = owned_seller_profile_id;

  INSERT INTO public."SellerFaq" (
    id,
    "sellerProfileId",
    question,
    answer,
    "sortOrder",
    "createdAt"
  )
  VALUES (
    p_faq_id,
    owned_seller_profile_id,
    p_question,
    p_answer,
    next_sort_order,
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  );

  RETURN QUERY SELECT 'OK'::text, p_faq_id, next_sort_order, true;
END;
$grainline_seller_faq_owner_create$;

CREATE FUNCTION public.grainline_seller_faq_owner_remove(
  p_faq_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_faq_owner_remove$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  actor_active boolean := false;
  owned_seller_profile_id text;
  deleted_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'SellerFaq owner context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_faq_id IS NULL
     OR p_faq_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'SellerFaq id is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.banned = false AND actor."deletedAt" IS NULL
    INTO actor_active
    FROM public."User" AS actor
   WHERE actor.id = request_user_id
   FOR SHARE;
  IF NOT FOUND OR NOT actor_active THEN
    RAISE EXCEPTION 'SellerFaq owner context is inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id
    INTO owned_seller_profile_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = request_user_id
     AND seller."ownerAccountActive" = true
   FOR SHARE;
  IF owned_seller_profile_id IS NULL THEN
    RAISE EXCEPTION 'SellerFaq owner context has no active seller profile'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."SellerFaq"
   WHERE id = p_faq_id
     AND "sellerProfileId" = owned_seller_profile_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_seller_faq_owner_remove$;

CREATE FUNCTION public.grainline_seller_faq_owner_export()
RETURNS TABLE (
  id text,
  question text,
  answer text,
  "sortOrder" integer,
  "createdAt" timestamp without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_faq_owner_export$
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
    RAISE EXCEPTION 'SellerFaq owner export context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT faq.id::text,
         faq.question::text,
         faq.answer::text,
         faq."sortOrder",
         faq."createdAt"::timestamp without time zone
    FROM public."SellerFaq" AS faq
    JOIN public."SellerProfile" AS seller
      ON seller.id = faq."sellerProfileId"
     AND seller."userId" = request_user_id
   ORDER BY faq."sortOrder", faq.id;
END;
$grainline_seller_faq_owner_export$;

CREATE FUNCTION public.grainline_seller_faq_account_deletion_cleanup(
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
AS $grainline_seller_faq_account_deletion_cleanup$
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
    RAISE EXCEPTION 'SellerFaq account-deletion context is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id
    INTO owned_seller_profile_id
    FROM public."User" AS actor
    LEFT JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = p_expected_user_id
   FOR UPDATE OF actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SellerFaq account-deletion user is unavailable'
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
    RAISE EXCEPTION 'SellerFaq account-deletion claim is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF owned_seller_profile_id IS NOT NULL THEN
    DELETE FROM public."SellerFaq"
     WHERE "sellerProfileId" = owned_seller_profile_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
  END IF;
  RETURN deleted_count;
END;
$grainline_seller_faq_account_deletion_cleanup$;

REVOKE ALL ON FUNCTION public.grainline_seller_faq_owner_create(text,text,text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_faq_owner_remove(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_faq_owner_export()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_faq_account_deletion_cleanup(text,text,bigint,uuid)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_faq_owner_create(text,text,text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_faq_owner_remove(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_faq_owner_export()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_faq_account_deletion_cleanup(text,text,bigint,uuid)
  TO grainline_app_runtime;

DO $grainline_seller_faq_postflight$
DECLARE
  missing_functions text[];
BEGIN
  SELECT pg_catalog.array_agg(expected.signature ORDER BY expected.signature)
    INTO missing_functions
    FROM (
      VALUES
        ('public.grainline_seller_faq_owner_create(text,text,text)'),
        ('public.grainline_seller_faq_owner_remove(text)'),
        ('public.grainline_seller_faq_owner_export()'),
        ('public.grainline_seller_faq_account_deletion_cleanup(text,text,bigint,uuid)')
    ) AS expected(signature)
   WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL;
  IF missing_functions IS NOT NULL THEN
    RAISE EXCEPTION 'SellerFaq preparation functions are missing: %', missing_functions;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."SellerFaq"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'SellerFaq compatible preparation changed RLS posture';
  END IF;
END;
$grainline_seller_faq_postflight$;

COMMIT;
