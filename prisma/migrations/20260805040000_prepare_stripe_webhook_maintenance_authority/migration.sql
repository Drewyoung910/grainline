BEGIN;

CREATE FUNCTION public.grainline_stripe_webhook_prune_batch(
  p_limit integer
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stripe_webhook_prune_batch$
DECLARE
  safe_limit integer;
  deleted_count bigint;
  source_cutoff timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '90 days';
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'Stripe webhook prune limit is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  safe_limit := LEAST(p_limit, 1000);

  WITH candidates AS MATERIALIZED (
    SELECT event.id
      FROM public."StripeWebhookEvent" AS event
     WHERE event."processedAt" IS NOT NULL
       AND event."processedAt" < source_cutoff
       AND event.type <> 'checkout.session.stock_restored'
     ORDER BY event."processedAt" ASC, event.id ASC
     LIMIT safe_limit
     FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."StripeWebhookEvent" AS event
     USING candidates
     WHERE event.id = candidates.id
     RETURNING 1
  )
  SELECT pg_catalog.count(*)
    INTO STRICT deleted_count
    FROM deleted;

  RETURN deleted_count;
END
$grainline_stripe_webhook_prune_batch$;

CREATE FUNCTION public.grainline_stripe_webhook_health_summary()
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
AS $grainline_stripe_webhook_health_summary$
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
          AND event."processingStartedAt" < source_now - interval '2 minutes'
      ) AS stale_count,
      pg_catalog.count(*) FILTER (
        WHERE event."processedAt" IS NULL
          AND (
            event."lastError" IS NOT NULL
            OR event."processingStartedAt" IS NULL
            OR event."processingStartedAt" < source_now - interval '2 minutes'
          )
      ) AS issue_count
      FROM public."StripeWebhookEvent" AS event;
END
$grainline_stripe_webhook_health_summary$;

CREATE FUNCTION public.grainline_legacy_stock_restore_claim(
  p_session_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_legacy_stock_restore_claim$
DECLARE
  canonical_event_id text;
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  inserted_count integer;
BEGIN
  IF p_session_id IS NULL
     OR pg_catalog.char_length(p_session_id) = 0
     OR p_session_id IS DISTINCT FROM pg_catalog.btrim(p_session_id)
     OR p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'Checkout stock restore session id is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  canonical_event_id := 'checkout-stock-restore:' || p_session_id;
  IF pg_catalog.char_length(canonical_event_id) > 255 THEN
    RAISE EXCEPTION 'Checkout stock restore session id is too long'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(p_session_id));

  INSERT INTO public."StripeWebhookEvent" (
    id,
    type,
    "claimGeneration",
    "processingStartedAt",
    "processedAt",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    canonical_event_id,
    'checkout.session.stock_restored',
    1,
    source_now,
    source_now,
    source_now,
    source_now
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 1 THEN
    RETURN true;
  END IF;

  SELECT event.*
    INTO STRICT source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = canonical_event_id
   FOR UPDATE;

  IF source_event.type IS DISTINCT FROM 'checkout.session.stock_restored'
     OR source_event."processedAt" IS NULL THEN
    RAISE EXCEPTION 'Checkout stock restore claim conflicts with an invalid event'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN false;
END
$grainline_legacy_stock_restore_claim$;

REVOKE ALL ON FUNCTION public.grainline_stripe_webhook_prune_batch(integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_stripe_webhook_health_summary()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_legacy_stock_restore_claim(text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_stripe_webhook_prune_batch(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stripe_webhook_health_summary()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_legacy_stock_restore_claim(text)
  TO grainline_app_runtime;

COMMIT;
