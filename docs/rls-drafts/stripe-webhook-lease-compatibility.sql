-- DRAFT ONLY: compatible generation-bound Stripe webhook leases.
-- Exercised only inside the rollback-only loopback PostgreSQL proof.
-- This is not a production migration or approval to inspect/change production.

BEGIN;

ALTER TABLE public."StripeWebhookEvent"
  ADD COLUMN "claimGeneration" bigint NOT NULL DEFAULT 0;

ALTER TABLE public."StripeWebhookEvent"
  ADD CONSTRAINT "StripeWebhookEvent_claimGeneration_check"
  CHECK ("claimGeneration" >= 0)
  NOT VALID;
ALTER TABLE public."StripeWebhookEvent"
  VALIDATE CONSTRAINT "StripeWebhookEvent_claimGeneration_check";

CREATE FUNCTION public.grainline_stripe_webhook_begin(
  p_event_id text,
  p_event_type text
)
RETURNS TABLE(action text, claim_generation bigint)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stripe_webhook_begin$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_now timestamp(3) without time zone := pg_catalog.clock_timestamp();
  inserted_count integer;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(p_event_id) = 0
     OR pg_catalog.char_length(p_event_id) > 255 THEN
    RAISE EXCEPTION 'Stripe webhook event id is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_event_type IS NULL
     OR pg_catalog.char_length(p_event_type) = 0
     OR pg_catalog.char_length(p_event_type) > 100 THEN
    RAISE EXCEPTION 'Stripe webhook event type is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public."StripeWebhookEvent" (
    id,
    type,
    "claimGeneration",
    "processingStartedAt",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    p_event_id,
    p_event_type,
    1,
    source_now,
    source_now,
    source_now
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 1 THEN
    RETURN QUERY SELECT 'process'::text, 1::bigint;
    RETURN;
  END IF;

  SELECT event.*
    INTO STRICT source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;

  IF source_event.type IS DISTINCT FROM p_event_type THEN
    RAISE EXCEPTION 'Stripe webhook event type is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF source_event."processedAt" IS NOT NULL THEN
    RETURN QUERY
      SELECT 'processed'::text, source_event."claimGeneration";
    RETURN;
  END IF;

  IF source_event."processingStartedAt" IS NOT NULL
     AND source_event."processingStartedAt" >= source_now - interval '2 minutes' THEN
    RETURN QUERY
      SELECT 'in_progress'::text, source_event."claimGeneration";
    RETURN;
  END IF;

  UPDATE public."StripeWebhookEvent" AS event
     SET "claimGeneration" = event."claimGeneration" + 1,
         "processingStartedAt" = source_now,
         "lastError" = NULL,
         "updatedAt" = source_now
   WHERE event.id = p_event_id
  RETURNING event.* INTO STRICT source_event;

  RETURN QUERY
    SELECT 'process'::text, source_event."claimGeneration";
END
$grainline_stripe_webhook_begin$;

CREATE FUNCTION public.grainline_stripe_webhook_complete(
  p_event_id text,
  p_claim_generation bigint
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stripe_webhook_complete$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_now timestamp(3) without time zone := pg_catalog.clock_timestamp();
BEGIN
  IF p_claim_generation IS NULL OR p_claim_generation < 1 THEN
    RAISE EXCEPTION 'Stripe webhook claim generation is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."StripeWebhookEvent" AS event
     SET "processedAt" = source_now,
         "lastError" = NULL,
         "updatedAt" = source_now
   WHERE event.id = p_event_id
     AND event."processedAt" IS NULL
     AND event."processingStartedAt" IS NOT NULL
     AND event."claimGeneration" = p_claim_generation
  RETURNING event.* INTO source_event;

  IF FOUND THEN
    RETURN 'completed';
  END IF;

  SELECT event.*
    INTO STRICT source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;

  IF source_event."processedAt" IS NOT NULL
     AND source_event."claimGeneration" = p_claim_generation THEN
    RETURN 'already_processed';
  END IF;
  RETURN 'superseded';
END
$grainline_stripe_webhook_complete$;

CREATE FUNCTION public.grainline_stripe_webhook_fail(
  p_event_id text,
  p_claim_generation bigint,
  p_sanitized_error text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stripe_webhook_fail$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_now timestamp(3) without time zone := pg_catalog.clock_timestamp();
BEGIN
  IF p_claim_generation IS NULL OR p_claim_generation < 1 THEN
    RAISE EXCEPTION 'Stripe webhook claim generation is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."StripeWebhookEvent" AS event
     SET "processingStartedAt" = NULL,
         "lastError" = pg_catalog.left(
           pg_catalog.coalesce(
             pg_catalog.nullif(p_sanitized_error, ''),
             'Webhook processing failed'
           ),
           500
         ),
         "updatedAt" = source_now
   WHERE event.id = p_event_id
     AND event."processedAt" IS NULL
     AND event."processingStartedAt" IS NOT NULL
     AND event."claimGeneration" = p_claim_generation
  RETURNING event.* INTO source_event;

  IF FOUND THEN
    RETURN 'failed';
  END IF;

  SELECT event.*
    INTO STRICT source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  RETURN 'superseded';
END
$grainline_stripe_webhook_fail$;

REVOKE ALL ON FUNCTION public.grainline_stripe_webhook_begin(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_stripe_webhook_complete(text, bigint)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_stripe_webhook_fail(text, bigint, text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_stripe_webhook_begin(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stripe_webhook_complete(text, bigint)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stripe_webhook_fail(text, bigint, text)
  TO grainline_app_runtime;

COMMIT;
