BEGIN;

-- This migration is deployed while old and new application instances may
-- overlap. Require the dedicated worker principal up front, then preserve the
-- predecessor ordinary-runtime surface until the later activation migration.
DO $grainline_account_deletion_side_effect_worker_preflight$
DECLARE
  worker_role record;
BEGIN
  SELECT role.rolsuper, role.rolinherit, role.rolcanlogin,
         role.rolcreatedb, role.rolcreaterole, role.rolreplication,
         role.rolbypassrls
    INTO worker_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_account_deletion_runtime';

  IF NOT FOUND
     OR worker_role.rolsuper
     OR worker_role.rolinherit
     OR NOT worker_role.rolcanlogin
     OR worker_role.rolcreatedb
     OR worker_role.rolcreaterole
     OR worker_role.rolreplication
     OR worker_role.rolbypassrls THEN
    RAISE EXCEPTION
      'grainline_account_deletion_runtime role posture is not safe';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
     WHERE (
       member.rolname = 'grainline_account_deletion_runtime'
       OR granted_role.rolname = 'grainline_account_deletion_runtime'
     )
       AND NOT (
         granted_role.rolname = 'grainline_account_deletion_runtime'
         AND member.rolname = 'neondb_owner'
         AND grantor.rolname = 'cloud_admin'
         AND membership.admin_option
         AND NOT membership.inherit_option
         AND NOT membership.set_option
       )
  ) THEN
    RAISE EXCEPTION
      'grainline_account_deletion_runtime retains unreviewed membership';
  END IF;
END
$grainline_account_deletion_side_effect_worker_preflight$;

ALTER TABLE public."AccountDeletionSideEffect"
  ADD COLUMN "claimGeneration" bigint NOT NULL DEFAULT 0,
  ADD COLUMN "claimToken" uuid,
  ADD COLUMN "processingStartedAt" timestamp(3) without time zone;

UPDATE public."AccountDeletionSideEffect"
   SET "processingStartedAt" = "updatedAt"
 WHERE status = 'PROCESSING'
   AND "processingStartedAt" IS NULL;

ALTER TABLE public."AccountDeletionSideEffect"
  ADD CONSTRAINT "AccountDeletionSideEffect_claimGeneration_check"
  CHECK ("claimGeneration" >= 0) NOT VALID,
  ADD CONSTRAINT "AccountDeletionSideEffect_attempts_check"
  CHECK (attempts >= 0) NOT VALID;

ALTER TABLE public."AccountDeletionSideEffect"
  VALIDATE CONSTRAINT "AccountDeletionSideEffect_claimGeneration_check";
ALTER TABLE public."AccountDeletionSideEffect"
  VALIDATE CONSTRAINT "AccountDeletionSideEffect_attempts_check";

CREATE INDEX "AccountDeletionSideEffect_status_processingStartedAt_idx"
  ON public."AccountDeletionSideEffect"(status, "processingStartedAt");

CREATE FUNCTION public.grainline_account_deletion_side_effect_claim(
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
      source_effect."userId",
      source_effect.kind,
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

CREATE FUNCTION public.grainline_account_deletion_side_effect_complete(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_account_deletion_side_effect_complete$
DECLARE
  source_effect public."AccountDeletionSideEffect"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_side_effect_id IS NULL
     OR pg_catalog.btrim(p_side_effect_id) = ''
     OR pg_catalog.char_length(p_side_effect_id) > 191
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Account deletion completion claim is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."AccountDeletionSideEffect" AS effect
     SET status = 'DONE',
         "processingStartedAt" = NULL,
         "processedAt" = source_now,
         "nextAttemptAt" = NULL,
         "lastError" = NULL,
         payload = '{}'::jsonb,
         "updatedAt" = source_now
   WHERE effect.id = p_side_effect_id
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
  RETURNING effect.* INTO source_effect;

  IF FOUND THEN
    RETURN 'completed';
  END IF;

  SELECT effect.*
    INTO source_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id;

  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;
  IF source_effect.status = 'DONE'
     AND source_effect."claimGeneration" = p_claim_generation
     AND source_effect."claimToken" = p_claim_token THEN
    RETURN 'already_completed';
  END IF;
  RETURN 'superseded';
END
$grainline_account_deletion_side_effect_complete$;

CREATE FUNCTION public.grainline_account_deletion_side_effect_fail(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_sanitized_error text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_account_deletion_side_effect_fail$
DECLARE
  source_effect public."AccountDeletionSideEffect"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  retry_minutes integer;
BEGIN
  IF p_side_effect_id IS NULL
     OR pg_catalog.btrim(p_side_effect_id) = ''
     OR pg_catalog.char_length(p_side_effect_id) > 191
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Account deletion failure claim is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT effect.*
    INTO source_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'superseded';
  END IF;

  retry_minutes := LEAST(
    60,
    GREATEST(5, pg_catalog.power(2, LEAST(source_effect.attempts, 5))::integer)
  );

  UPDATE public."AccountDeletionSideEffect" AS effect
     SET status = 'FAILED',
         "processingStartedAt" = NULL,
         "nextAttemptAt" = source_now + pg_catalog.make_interval(mins => retry_minutes),
         "lastError" = pg_catalog.left(
           COALESCE(NULLIF(p_sanitized_error, ''), 'Side effect failed'),
           1000
         ),
         "updatedAt" = source_now
   WHERE effect.id = p_side_effect_id
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token;

  RETURN 'failed';
END
$grainline_account_deletion_side_effect_fail$;

CREATE FUNCTION public.grainline_account_deletion_media_enqueue_claimed(
  p_parent_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_urls text[]
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_account_deletion_media_enqueue_claimed$
DECLARE
  source_effect public."AccountDeletionSideEffect"%ROWTYPE;
  inserted_count bigint;
BEGIN
  IF p_parent_side_effect_id IS NULL
     OR pg_catalog.btrim(p_parent_side_effect_id) = ''
     OR pg_catalog.char_length(p_parent_side_effect_id) > 191
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL
     OR COALESCE(pg_catalog.array_length(p_urls, 1), 0) > 500
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(COALESCE(p_urls, ARRAY[]::text[])) AS supplied(url)
        WHERE supplied.url IS NULL
           OR pg_catalog.char_length(supplied.url) NOT BETWEEN 1 AND 2048
     ) THEN
    RAISE EXCEPTION 'Account deletion media enqueue claim is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT effect.*
    INTO source_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_parent_side_effect_id
     AND effect.status = 'PROCESSING'
     AND effect.kind = 'LOCAL_ANONYMIZE'
     AND effect."dedupKey" = 'account-delete:local:' || effect."userId"
     AND effect.payload = '{}'::jsonb
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account deletion media enqueue source is not authorized'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH inserted AS (
    INSERT INTO public."AccountDeletionSideEffect" (
      id,
      "userId",
      kind,
      "dedupKey",
      payload,
      status,
      attempts,
      "claimGeneration",
      "claimToken",
      "processingStartedAt",
      "nextAttemptAt",
      "processedAt",
      "lastError",
      "createdAt",
      "updatedAt"
    )
    SELECT
      'account-delete-media:' || pg_catalog.gen_random_uuid()::text,
      source_effect."userId",
      'MEDIA_DELETE',
      'account-delete:media:' || source_effect."userId" || ':' ||
        pg_catalog.substr(
          pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(supplied.url, 'UTF8')),
            'hex'
          ),
          1,
          32
        ),
      pg_catalog.jsonb_build_object('url', supplied.url),
      'PENDING',
      0,
      0,
      NULL,
      NULL,
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
      NULL,
      NULL,
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      FROM (
        SELECT DISTINCT url
          FROM pg_catalog.unnest(COALESCE(p_urls, ARRAY[]::text[])) AS candidate(url)
      ) AS supplied
    ON CONFLICT ("dedupKey") DO NOTHING
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::bigint
    INTO STRICT inserted_count
    FROM inserted;

  RETURN inserted_count;
END
$grainline_account_deletion_media_enqueue_claimed$;

CREATE FUNCTION public.grainline_account_deletion_claim_user(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_account_deletion_claim_user$
DECLARE
  claimed_user_id text;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_side_effect_id IS NULL
     OR pg_catalog.btrim(p_side_effect_id) = ''
     OR pg_catalog.char_length(p_side_effect_id) > 191
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Account deletion claim is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."AccountDeletionSideEffect" AS effect
     SET "processingStartedAt" = source_now,
         "updatedAt" = source_now
   WHERE effect.id = p_side_effect_id
     AND effect.status = 'PROCESSING'
     AND effect.kind = 'LOCAL_ANONYMIZE'
     AND effect."dedupKey" = 'account-delete:local:' || effect."userId"
     AND effect.payload = '{}'::jsonb
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
  RETURNING effect."userId" INTO claimed_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account deletion claim is not authorized'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN claimed_user_id;
END
$grainline_account_deletion_claim_user$;

CREATE FUNCTION public.grainline_user_account_deletion_preflight(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS TABLE (
  "userId" text,
  "clerkId" text,
  "deletedAt" timestamp(3),
  "sellerProfileId" text,
  "stripeAccountId" text,
  "stripeAccountVersion" text,
  "stripeControllerType" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_account_deletion_preflight_claimed$
BEGIN
  PERFORM public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );
  RETURN QUERY
  SELECT *
    FROM public.grainline_user_account_deletion_preflight(p_side_effect_id);
END
$grainline_user_account_deletion_preflight_claimed$;

CREATE FUNCTION public.grainline_user_account_deletion_snapshot(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS TABLE (
  "userId" text,
  "clerkId" text,
  email text,
  name text,
  "deletedAt" timestamp(3),
  "shippingName" text,
  "shippingLine1" text,
  "shippingLine2" text,
  "shippingCity" text,
  "shippingState" text,
  "shippingPostalCode" text,
  "shippingPhone" text,
  "sellerProfileId" text,
  "sellerDisplayName" text,
  "sellerCity" text,
  "sellerState" text,
  "sellerShipFromName" text,
  "sellerShipFromLine1" text,
  "sellerShipFromLine2" text,
  "sellerShipFromCity" text,
  "sellerShipFromState" text,
  "sellerShipFromPostal" text,
  "sellerShipFromPhone" text,
  "sellerTagline" text,
  "sellerBannerImageUrl" text,
  "sellerAvatarImageUrl" text,
  "sellerWorkshopImageUrl" text,
  "sellerInstagramUrl" text,
  "sellerFacebookUrl" text,
  "sellerPinterestUrl" text,
  "sellerTiktokUrl" text,
  "sellerWebsiteUrl" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_account_deletion_snapshot_claimed$
BEGIN
  PERFORM public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );
  RETURN QUERY
  SELECT *
    FROM public.grainline_user_account_deletion_snapshot(p_side_effect_id);
END
$grainline_user_account_deletion_snapshot_claimed$;

CREATE FUNCTION public.grainline_user_account_deletion_finalize(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS TABLE (
  "userId" text,
  "clerkId" text,
  email text,
  "deletedAt" timestamp(3)
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_account_deletion_finalize_claimed$
BEGIN
  PERFORM public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );
  RETURN QUERY
  SELECT *
    FROM public.grainline_user_account_deletion_finalize(p_side_effect_id);
END
$grainline_user_account_deletion_finalize_claimed$;

CREATE FUNCTION public.grainline_case_account_deletion_redact(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS TABLE (
  "sideEffectId" text,
  "userId" text,
  "authoredMessagesRedacted" integer,
  "quotedMessagesRedacted" integer,
  "buyerDescriptionsRedacted" integer,
  "participantDescriptionsRedacted" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_account_deletion_redact_claimed$
BEGIN
  PERFORM public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );
  RETURN QUERY
  SELECT *
    FROM public.grainline_case_account_deletion_redact(p_side_effect_id);
END
$grainline_case_account_deletion_redact_claimed$;

CREATE FUNCTION public.grainline_message_redact_for_account_deletion(
  p_side_effect_id text,
  p_expected_user_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS TABLE (
  "sentRedacted" integer,
  "receivedRedacted" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_message_redact_for_account_deletion_claimed$
DECLARE
  claimed_user_id text;
BEGIN
  claimed_user_id := public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );
  IF claimed_user_id IS DISTINCT FROM p_expected_user_id THEN
    RAISE EXCEPTION 'Account deletion message claim user changed'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN QUERY
  SELECT *
    FROM public.grainline_message_redact_for_account_deletion(claimed_user_id);
END
$grainline_message_redact_for_account_deletion_claimed$;

CREATE FUNCTION public.grainline_order_account_deletion_scrub(
  p_side_effect_id text,
  p_expected_user_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
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
AS $grainline_order_account_deletion_scrub_claimed$
DECLARE
  claimed_user_id text;
BEGIN
  claimed_user_id := public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );
  IF claimed_user_id IS DISTINCT FROM p_expected_user_id THEN
    RAISE EXCEPTION 'Account deletion Order claim user changed'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN QUERY
  SELECT *
    FROM public.grainline_order_account_deletion_scrub(
      claimed_user_id,
      p_additional_sensitive_values
    );
END
$grainline_order_account_deletion_scrub_claimed$;

REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_side_effect_claim(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_side_effect_complete(text, bigint, uuid)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_side_effect_fail(text, bigint, uuid, text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_media_enqueue_claimed(text, bigint, uuid, text[])
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_claim_user(text, bigint, uuid)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_account_deletion_preflight(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_account_deletion_snapshot(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_account_deletion_finalize(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION public.grainline_case_account_deletion_redact(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION public.grainline_message_redact_for_account_deletion(text)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_account_deletion_scrub(text, text[])
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_account_deletion_preflight(text, bigint, uuid)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_user_account_deletion_snapshot(text, bigint, uuid)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_user_account_deletion_finalize(text, bigint, uuid)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_case_account_deletion_redact(text, bigint, uuid)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_message_redact_for_account_deletion(text, text, bigint, uuid)
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_order_account_deletion_scrub(text, text, bigint, uuid, text[])
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;

REVOKE CREATE ON SCHEMA public FROM grainline_account_deletion_runtime;
GRANT USAGE ON SCHEMA public TO grainline_account_deletion_runtime;
REVOKE ALL ON TABLE public."AccountDeletionSideEffect"
  FROM grainline_account_deletion_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."AccountDeletionSideEffect"
  TO grainline_account_deletion_runtime;

-- Mixed-version compatibility: old instances retain the legacy unbound
-- functions, while new instances can authenticate as the dedicated worker.
-- The activation migration retires the ordinary surface after old instances
-- have drained.
GRANT EXECUTE ON FUNCTION public.grainline_user_account_deletion_preflight(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_account_deletion_snapshot(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_account_deletion_finalize(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_case_account_deletion_redact(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_message_redact_for_account_deletion(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_account_deletion_scrub(text, text[])
  TO grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_account_deletion_side_effect_claim(text)
  TO grainline_app_runtime, grainline_account_deletion_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_account_deletion_side_effect_complete(text, bigint, uuid)
  TO grainline_app_runtime, grainline_account_deletion_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_account_deletion_side_effect_fail(text, bigint, uuid, text)
  TO grainline_app_runtime, grainline_account_deletion_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_account_deletion_media_enqueue_claimed(text, bigint, uuid, text[])
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_account_deletion_preflight(text, bigint, uuid)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_account_deletion_snapshot(text, bigint, uuid)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_account_deletion_finalize(text, bigint, uuid)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_account_deletion_redact(text, bigint, uuid)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_message_redact_for_account_deletion(text, text, bigint, uuid)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_account_deletion_scrub(text, text, bigint, uuid, text[])
  TO grainline_app_runtime;

COMMIT;
