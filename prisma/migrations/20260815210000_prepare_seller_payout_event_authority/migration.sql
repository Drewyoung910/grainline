-- Compatible SellerPayoutEvent authority preparation.
--
-- This migration is additive. It does not enable RLS, revoke predecessor
-- table/column privileges, deploy application code, or mutate provider state.
-- Old and new application instances may coexist until the later drain and
-- activation releases.

ALTER TABLE public."SellerPayoutEvent"
  ADD COLUMN "stripeEventCreatedSeconds" bigint;

ALTER TABLE public."SellerPayoutEvent"
  ADD CONSTRAINT "SellerPayoutEvent_failed_status_chk"
    CHECK (status = 'failed') NOT VALID,
  ADD CONSTRAINT "SellerPayoutEvent_amount_nonnegative_chk"
    CHECK ("amountCents" IS NULL OR "amountCents" >= 0) NOT VALID,
  ADD CONSTRAINT "SellerPayoutEvent_currency_chk"
    CHECK (currency ~ '^[a-z]{3}$') NOT VALID,
  ADD CONSTRAINT "SellerPayoutEvent_source_event_chk"
    CHECK (
      "stripeEventId" IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim("stripeEventId")) BETWEEN 1 AND 255
    ) NOT VALID,
  ADD CONSTRAINT "SellerPayoutEvent_event_created_seconds_chk"
    CHECK (
      "stripeEventCreatedSeconds" IS NULL
      OR "stripeEventCreatedSeconds" BETWEEN 1 AND 253402300799
    ) NOT VALID;

ALTER TABLE public."SellerPayoutEvent"
  VALIDATE CONSTRAINT "SellerPayoutEvent_failed_status_chk";
ALTER TABLE public."SellerPayoutEvent"
  VALIDATE CONSTRAINT "SellerPayoutEvent_amount_nonnegative_chk";
ALTER TABLE public."SellerPayoutEvent"
  VALIDATE CONSTRAINT "SellerPayoutEvent_currency_chk";
ALTER TABLE public."SellerPayoutEvent"
  VALIDATE CONSTRAINT "SellerPayoutEvent_source_event_chk";
ALTER TABLE public."SellerPayoutEvent"
  VALIDATE CONSTRAINT "SellerPayoutEvent_event_created_seconds_chk";

CREATE UNIQUE INDEX "SellerPayoutEvent_stripeEventId_key"
  ON public."SellerPayoutEvent" ("stripeEventId");

CREATE INDEX "SellerPayoutEvent_seller_event_time_idx"
  ON public."SellerPayoutEvent" (
    "sellerProfileId",
    "stripeEventCreatedSeconds" DESC,
    id DESC
  );

CREATE FUNCTION public.grainline_seller_payout_event_apply(
  p_event_id text,
  p_claim_generation bigint,
  p_event_created_seconds bigint,
  p_connected_account_id text,
  p_payout_id text,
  p_amount_cents integer,
  p_currency text,
  p_failure_code text,
  p_failure_message text
)
RETURNS TABLE(action text, payout_event_id text, seller_user_id text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_payout_event_apply$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_payout public."SellerPayoutEvent"%ROWTYPE;
  source_seller_id text;
  source_seller_user_id text;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  source_now_seconds bigint :=
    pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::bigint;
  normalized_failure_code text :=
    NULLIF(pg_catalog.btrim(p_failure_code), '');
  normalized_failure_message text :=
    NULLIF(pg_catalog.btrim(p_failure_message), '');
  target_payout_event_id text;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_event_created_seconds IS NULL
     OR p_event_created_seconds < source_now_seconds - (30 * 24 * 60 * 60)
     OR p_event_created_seconds > source_now_seconds + (10 * 60)
     OR p_connected_account_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_connected_account_id)) NOT BETWEEN 1 AND 255
     OR p_payout_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_payout_id)) NOT BETWEEN 1 AND 255
     OR (p_amount_cents IS NOT NULL AND p_amount_cents < 0)
     OR p_currency IS NULL OR p_currency !~ '^[a-z]{3}$'
     OR (p_failure_code IS NOT NULL AND pg_catalog.char_length(p_failure_code) > 100)
     OR (p_failure_message IS NOT NULL AND pg_catalog.char_length(p_failure_message) > 1000) THEN
    RAISE EXCEPTION 'Seller payout event input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type IS DISTINCT FROM 'payout.failed'
     OR source_event."sourceObjectId" IS DISTINCT FROM p_payout_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Seller payout webhook claim is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT seller.id, seller."userId"
    INTO source_seller_id, source_seller_user_id
    FROM public."SellerProfile" AS seller
   WHERE seller."stripeAccountId" = p_connected_account_id
   FOR SHARE OF seller;
  IF NOT FOUND THEN
    RETURN QUERY
      SELECT 'ignored_unknown_account'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- A row lock cannot serialize the first insert because no payout row exists
  -- yet. Lock the signed payout identity before the lookup so concurrent
  -- distinct events cannot race into a unique violation or apply out of order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_payout_id, 620081501)
  );

  SELECT payout.*
    INTO source_payout
    FROM public."SellerPayoutEvent" AS payout
   WHERE payout."stripePayoutId" = p_payout_id
   FOR UPDATE;

  IF NOT FOUND THEN
    target_payout_event_id := pg_catalog.gen_random_uuid()::text;
    INSERT INTO public."SellerPayoutEvent" (
      id,
      "sellerProfileId",
      "stripePayoutId",
      status,
      "amountCents",
      currency,
      "failureCode",
      "failureMessage",
      "stripeEventId",
      "stripeEventCreatedSeconds",
      "createdAt",
      "updatedAt"
    ) VALUES (
      target_payout_event_id,
      source_seller_id,
      p_payout_id,
      'failed',
      p_amount_cents,
      p_currency,
      normalized_failure_code,
      normalized_failure_message,
      p_event_id,
      p_event_created_seconds,
      source_now,
      source_now
    );
    RETURN QUERY
      SELECT 'inserted'::text, target_payout_event_id, source_seller_user_id;
    RETURN;
  END IF;

  IF source_payout."sellerProfileId" IS DISTINCT FROM source_seller_id THEN
    RAISE EXCEPTION 'Seller payout ownership is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF source_payout."stripeEventId" = p_event_id THEN
    IF source_payout."stripeEventCreatedSeconds" IS NULL THEN
      UPDATE public."SellerPayoutEvent" AS payout
         SET status = 'failed',
             "amountCents" = p_amount_cents,
             currency = p_currency,
             "failureCode" = normalized_failure_code,
             "failureMessage" = normalized_failure_message,
             "stripeEventCreatedSeconds" = p_event_created_seconds,
             "updatedAt" = source_now
       WHERE payout.id = source_payout.id;
      RETURN QUERY
        SELECT 'legacy_converged'::text, source_payout.id, source_seller_user_id;
      RETURN;
    END IF;

    IF source_payout."stripeEventCreatedSeconds" IS DISTINCT FROM p_event_created_seconds
       OR source_payout.status IS DISTINCT FROM 'failed'
       OR source_payout."amountCents" IS DISTINCT FROM p_amount_cents
       OR source_payout.currency IS DISTINCT FROM p_currency
       OR source_payout."failureCode" IS DISTINCT FROM normalized_failure_code
       OR source_payout."failureMessage" IS DISTINCT FROM normalized_failure_message THEN
      RAISE EXCEPTION 'Seller payout replay payload is inconsistent'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN QUERY
      SELECT 'already_applied'::text, source_payout.id, source_seller_user_id;
    RETURN;
  END IF;

  IF source_payout."stripeEventCreatedSeconds" IS NULL THEN
    RAISE EXCEPTION 'Legacy seller payout event requires ordering review'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_event_created_seconds < source_payout."stripeEventCreatedSeconds" THEN
    RETURN QUERY
      SELECT 'stale_ignored'::text, source_payout.id, source_seller_user_id;
    RETURN;
  END IF;

  IF p_event_created_seconds = source_payout."stripeEventCreatedSeconds" THEN
    RAISE EXCEPTION 'Seller payout event ordering is ambiguous'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."SellerPayoutEvent" AS payout
     SET status = 'failed',
         "amountCents" = p_amount_cents,
         currency = p_currency,
         "failureCode" = normalized_failure_code,
         "failureMessage" = normalized_failure_message,
         "stripeEventId" = p_event_id,
         "stripeEventCreatedSeconds" = p_event_created_seconds,
         "updatedAt" = source_now
   WHERE payout.id = source_payout.id;

  RETURN QUERY
    SELECT 'updated'::text, source_payout.id, source_seller_user_id;
END
$grainline_seller_payout_event_apply$;

CREATE FUNCTION public.grainline_seller_payout_latest_failure(
  p_actor_user_id text
)
RETURNS TABLE(
  payout_event_id text,
  event_created_seconds bigint,
  failure_message text,
  amount_cents integer,
  currency text
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_payout_latest_failure$
  SELECT
    payout.id,
    COALESCE(
      payout."stripeEventCreatedSeconds",
      pg_catalog.floor(EXTRACT(EPOCH FROM (payout."createdAt" AT TIME ZONE 'UTC')))::bigint
    ),
    payout."failureMessage"::text,
    payout."amountCents",
    payout.currency::text
  FROM public."SellerProfile" AS seller
  JOIN public."SellerPayoutEvent" AS payout
    ON payout."sellerProfileId" = seller.id
  WHERE p_actor_user_id IS NOT NULL
    AND pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) BETWEEN 1 AND 191
    AND seller."userId" = p_actor_user_id
    AND payout.status = 'failed'
    AND COALESCE(
      payout."stripeEventCreatedSeconds",
      pg_catalog.floor(EXTRACT(EPOCH FROM (payout."createdAt" AT TIME ZONE 'UTC')))::bigint
    ) >= pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.statement_timestamp()))::bigint
      - (30 * 24 * 60 * 60)
  ORDER BY
    COALESCE(
      payout."stripeEventCreatedSeconds",
      pg_catalog.floor(EXTRACT(EPOCH FROM (payout."createdAt" AT TIME ZONE 'UTC')))::bigint
    ) DESC,
    payout.id DESC
  LIMIT 1
$grainline_seller_payout_latest_failure$;

CREATE FUNCTION public.grainline_seller_payout_export_page(
  p_actor_user_id text,
  p_limit integer,
  p_before_event_created_seconds bigint,
  p_before_id text
)
RETURNS TABLE(
  payout_event_id text,
  seller_profile_id text,
  stripe_payout_id text,
  status text,
  amount_cents integer,
  currency text,
  failure_code text,
  failure_message text,
  stripe_event_id text,
  event_created_seconds bigint,
  created_at timestamp(3) without time zone,
  updated_at timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_payout_export_page$
DECLARE
  source_limit integer;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_limit IS NULL
     OR (p_before_event_created_seconds IS NULL) <> (p_before_id IS NULL)
     OR (p_before_event_created_seconds IS NOT NULL AND p_before_event_created_seconds < 1)
     OR (p_before_id IS NOT NULL AND pg_catalog.char_length(p_before_id) NOT BETWEEN 1 AND 191) THEN
    RAISE EXCEPTION 'Seller payout export input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  source_limit := LEAST(GREATEST(p_limit, 1), 500);

  RETURN QUERY
  SELECT
    payout.id,
    payout."sellerProfileId",
    payout."stripePayoutId"::text,
    payout.status::text,
    payout."amountCents",
    payout.currency::text,
    payout."failureCode"::text,
    payout."failureMessage"::text,
    payout."stripeEventId"::text,
    COALESCE(
      payout."stripeEventCreatedSeconds",
      pg_catalog.floor(EXTRACT(EPOCH FROM (payout."createdAt" AT TIME ZONE 'UTC')))::bigint
    ),
    payout."createdAt",
    payout."updatedAt"
  FROM public."SellerProfile" AS seller
  JOIN public."SellerPayoutEvent" AS payout
    ON payout."sellerProfileId" = seller.id
  WHERE seller."userId" = p_actor_user_id
    AND (
      p_before_event_created_seconds IS NULL
      OR (
        COALESCE(
          payout."stripeEventCreatedSeconds",
          pg_catalog.floor(EXTRACT(EPOCH FROM (payout."createdAt" AT TIME ZONE 'UTC')))::bigint
        ),
        payout.id
      ) < (p_before_event_created_seconds, p_before_id)
    )
  ORDER BY
    COALESCE(
      payout."stripeEventCreatedSeconds",
      pg_catalog.floor(EXTRACT(EPOCH FROM (payout."createdAt" AT TIME ZONE 'UTC')))::bigint
    ) DESC,
    payout.id DESC
  LIMIT source_limit;
END
$grainline_seller_payout_export_page$;

REVOKE ALL ON FUNCTION public.grainline_seller_payout_event_apply(
  text, bigint, bigint, text, text, integer, text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_payout_latest_failure(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_payout_export_page(
  text, integer, bigint, text
) FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_payout_event_apply(
  text, bigint, bigint, text, text, integer, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_payout_latest_failure(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_payout_export_page(
  text, integer, bigint, text
) TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_seller_payout_event_apply(
  text, bigint, bigint, text, text, integer, text, text, text
) IS 'Applies one generation-bound signed payout.failed projection; no caller-selected seller, row id, status or notification target.';
COMMENT ON FUNCTION public.grainline_seller_payout_latest_failure(text)
  IS 'Returns only the actor-owned recent payout-failure banner projection.';
COMMENT ON FUNCTION public.grainline_seller_payout_export_page(
  text, integer, bigint, text
) IS 'Returns one database-clamped actor-owned payout export page using an event-time/id keyset cursor.';
