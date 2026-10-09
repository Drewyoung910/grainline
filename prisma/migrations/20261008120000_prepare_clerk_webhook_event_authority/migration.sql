BEGIN;

ALTER TABLE public."ClerkWebhookEvent"
  ADD COLUMN "claimGeneration" bigint NOT NULL DEFAULT 0;

ALTER TABLE public."ClerkWebhookEvent"
  ADD CONSTRAINT "ClerkWebhookEvent_claimGeneration_check"
  CHECK ("claimGeneration" >= 0) NOT VALID;
ALTER TABLE public."ClerkWebhookEvent"
  VALIDATE CONSTRAINT "ClerkWebhookEvent_claimGeneration_check";

CREATE FUNCTION public.grainline_clerk_webhook_begin(
  p_svix_id text,
  p_event_type text
)
RETURNS TABLE(action text, claim_generation bigint)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_clerk_webhook_begin$
DECLARE
  source_event public."ClerkWebhookEvent"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  inserted_count integer;
BEGIN
  IF p_svix_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_svix_id)) = 0
     OR pg_catalog.char_length(p_svix_id) > 255 THEN
    RAISE EXCEPTION 'Clerk webhook event id is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_event_type IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_type)) = 0
     OR pg_catalog.char_length(p_event_type) > 100 THEN
    RAISE EXCEPTION 'Clerk webhook event type is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public."ClerkWebhookEvent" (
    "svixId",
    type,
    "claimGeneration",
    "processingStartedAt",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    p_svix_id,
    p_event_type,
    1,
    source_now,
    source_now,
    source_now
  )
  ON CONFLICT ("svixId") DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 1 THEN
    RETURN QUERY SELECT 'process'::text, 1::bigint;
    RETURN;
  END IF;

  SELECT event.*
    INTO STRICT source_event
    FROM public."ClerkWebhookEvent" AS event
   WHERE event."svixId" = p_svix_id
   FOR UPDATE;

  IF source_event.type IS DISTINCT FROM p_event_type THEN
    RAISE EXCEPTION 'Clerk webhook event type is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF source_event."processedAt" IS NOT NULL THEN
    RETURN QUERY
      SELECT 'processed'::text, source_event."claimGeneration";
    RETURN;
  END IF;

  IF source_event."processingStartedAt" IS NOT NULL
     AND source_event."processingStartedAt" >= source_now - interval '5 minutes' THEN
    RETURN QUERY
      SELECT 'in_progress'::text, source_event."claimGeneration";
    RETURN;
  END IF;

  UPDATE public."ClerkWebhookEvent" AS event
     SET "claimGeneration" = event."claimGeneration" + 1,
         "processingStartedAt" = source_now,
         "lastError" = NULL,
         "updatedAt" = source_now
   WHERE event."svixId" = p_svix_id
  RETURNING event.* INTO STRICT source_event;

  RETURN QUERY
    SELECT 'process'::text, source_event."claimGeneration";
END
$grainline_clerk_webhook_begin$;

CREATE FUNCTION public.grainline_clerk_webhook_complete(
  p_svix_id text,
  p_claim_generation bigint
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_clerk_webhook_complete$
DECLARE
  source_event public."ClerkWebhookEvent"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_svix_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_svix_id)) = 0
     OR pg_catalog.char_length(p_svix_id) > 255 THEN
    RAISE EXCEPTION 'Clerk webhook event id is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_claim_generation IS NULL OR p_claim_generation < 1 THEN
    RAISE EXCEPTION 'Clerk webhook claim generation is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."ClerkWebhookEvent" AS event
     SET "processedAt" = source_now,
         "lastError" = NULL,
         "updatedAt" = source_now
   WHERE event."svixId" = p_svix_id
     AND event."processedAt" IS NULL
     AND event."processingStartedAt" IS NOT NULL
     AND event."claimGeneration" = p_claim_generation
  RETURNING event.* INTO source_event;

  IF FOUND THEN
    RETURN 'completed';
  END IF;

  SELECT event.*
    INTO STRICT source_event
    FROM public."ClerkWebhookEvent" AS event
   WHERE event."svixId" = p_svix_id
   FOR UPDATE;

  IF source_event."processedAt" IS NOT NULL
     AND source_event."claimGeneration" = p_claim_generation THEN
    RETURN 'already_processed';
  END IF;
  RETURN 'superseded';
END
$grainline_clerk_webhook_complete$;

CREATE FUNCTION public.grainline_clerk_webhook_fail(
  p_svix_id text,
  p_claim_generation bigint,
  p_sanitized_error text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_clerk_webhook_fail$
DECLARE
  source_event public."ClerkWebhookEvent"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_svix_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_svix_id)) = 0
     OR pg_catalog.char_length(p_svix_id) > 255 THEN
    RAISE EXCEPTION 'Clerk webhook event id is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_claim_generation IS NULL OR p_claim_generation < 1 THEN
    RAISE EXCEPTION 'Clerk webhook claim generation is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."ClerkWebhookEvent" AS event
     SET "processingStartedAt" = NULL,
         "lastError" = pg_catalog.left(
           COALESCE(NULLIF(p_sanitized_error, ''), 'Webhook processing failed'),
           500
         ),
         "updatedAt" = source_now
   WHERE event."svixId" = p_svix_id
     AND event."processedAt" IS NULL
     AND event."processingStartedAt" IS NOT NULL
     AND event."claimGeneration" = p_claim_generation
  RETURNING event.* INTO source_event;

  IF FOUND THEN
    RETURN 'failed';
  END IF;

  SELECT event.*
    INTO STRICT source_event
    FROM public."ClerkWebhookEvent" AS event
   WHERE event."svixId" = p_svix_id
   FOR UPDATE;
  RETURN 'superseded';
END
$grainline_clerk_webhook_fail$;

CREATE FUNCTION public.grainline_clerk_webhook_prune_batch(
  p_limit integer
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_clerk_webhook_prune_batch$
DECLARE
  safe_limit integer;
  deleted_count bigint;
  source_cutoff timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '90 days';
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'Clerk webhook prune limit is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  safe_limit := LEAST(p_limit, 1000);

  WITH candidates AS MATERIALIZED (
    SELECT event."svixId"
      FROM public."ClerkWebhookEvent" AS event
     WHERE event."processedAt" IS NOT NULL
       AND event."processedAt" < source_cutoff
     ORDER BY event."processedAt" ASC, event."svixId" ASC
     LIMIT safe_limit
     FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."ClerkWebhookEvent" AS event
     USING candidates
     WHERE event."svixId" = candidates."svixId"
     RETURNING 1
  )
  SELECT pg_catalog.count(*)
    INTO STRICT deleted_count
    FROM deleted;

  RETURN deleted_count;
END
$grainline_clerk_webhook_prune_batch$;

CREATE FUNCTION public.grainline_clerk_webhook_health_summary()
RETURNS TABLE(
  failed_count bigint,
  released_count bigint,
  stale_count bigint,
  issue_count bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_clerk_webhook_health_summary$
DECLARE
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  RETURN QUERY
    SELECT
      pg_catalog.count(*) FILTER (
        WHERE event."processedAt" IS NULL
          AND event."lastError" IS NOT NULL
      ) AS failed_count,
      pg_catalog.count(*) FILTER (
        WHERE event."processedAt" IS NULL
          AND event."processingStartedAt" IS NULL
      ) AS released_count,
      pg_catalog.count(*) FILTER (
        WHERE event."processedAt" IS NULL
          AND event."processingStartedAt" IS NOT NULL
          AND event."processingStartedAt" < source_now - interval '5 minutes'
      ) AS stale_count,
      pg_catalog.count(*) FILTER (
        WHERE event."processedAt" IS NULL
          AND (
            event."lastError" IS NOT NULL
            OR event."processingStartedAt" IS NULL
            OR event."processingStartedAt" < source_now - interval '5 minutes'
          )
      ) AS issue_count
      FROM public."ClerkWebhookEvent" AS event;
END
$grainline_clerk_webhook_health_summary$;

REVOKE ALL ON FUNCTION public.grainline_clerk_webhook_begin(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_clerk_webhook_complete(text, bigint)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_clerk_webhook_fail(text, bigint, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_clerk_webhook_prune_batch(integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_clerk_webhook_health_summary()
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_clerk_webhook_begin(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_clerk_webhook_complete(text, bigint)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_clerk_webhook_fail(text, bigint, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_clerk_webhook_prune_batch(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_clerk_webhook_health_summary()
  TO grainline_app_runtime;

COMMIT;
