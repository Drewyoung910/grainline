-- Coexistence-safe seller and blocked-checkout refund claim generation.
--
-- Old application deployments may continue using the legacy pending sentinel:
-- all new columns are additive and the tuple constraint permits an entirely
-- absent claim. Converted deployments acquire a database-derived claim and
-- monotonically increasing generation before any Stripe call. This migration
-- does not change OrderPaymentEvent grants or RLS posture.

BEGIN;

DO $grainline_order_refund_claim_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'public."Order"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND attribute.attname IN (
         'refundClaimId',
         'refundClaimGeneration',
         'refundClaimSource',
         'refundClaimSourceId',
         'refundClaimSourceGeneration',
         'refundClaimIdempotencyScope',
         'refundClaimProviderAuthorizedAt'
       )
  )
  OR pg_catalog.to_regprocedure(
    'public.grainline_seller_refund_claim(text,text)'
  ) IS NOT NULL
  OR pg_catalog.to_regprocedure(
    'public.grainline_blocked_checkout_refund_claim(text,bigint,text,text,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Order refund claim preparation is not at the clean predecessor';
  END IF;
END
$grainline_order_refund_claim_preflight$;

ALTER TABLE public."Order"
  ADD COLUMN "refundClaimId" varchar(255),
  ADD COLUMN "refundClaimGeneration" bigint NOT NULL DEFAULT 0,
  ADD COLUMN "refundClaimSource" varchar(32),
  ADD COLUMN "refundClaimSourceId" varchar(255),
  ADD COLUMN "refundClaimSourceGeneration" bigint,
  ADD COLUMN "refundClaimIdempotencyScope" varchar(191),
  ADD COLUMN "refundClaimProviderAuthorizedAt" timestamp(3) without time zone;

ALTER TABLE public."Order"
  ADD CONSTRAINT "Order_refundClaimGeneration_non_negative_check"
  CHECK ("refundClaimGeneration" >= 0) NOT VALID,
  ADD CONSTRAINT "Order_refundClaim_tuple_check"
  CHECK (
    (
      "refundClaimId" IS NULL
      AND "refundClaimSource" IS NULL
      AND "refundClaimSourceId" IS NULL
      AND "refundClaimSourceGeneration" IS NULL
      AND "refundClaimIdempotencyScope" IS NULL
      AND "refundClaimProviderAuthorizedAt" IS NULL
    )
    OR
    (
      "refundClaimId" IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim("refundClaimId")) BETWEEN 1 AND 255
      AND "refundClaimGeneration" >= 1
      AND "refundClaimSource" IN ('SELLER', 'BLOCKED_CHECKOUT')
      AND "refundClaimSourceId" IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim("refundClaimSourceId")) BETWEEN 1 AND 255
      AND "refundClaimIdempotencyScope" IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim("refundClaimIdempotencyScope")) BETWEEN 1 AND 191
      AND "refundClaimProviderAuthorizedAt" IS NOT NULL
      AND "sellerRefundId" IS NOT NULL
      AND "sellerRefundId" IN (
        'pending',
        'ambiguous_refund_pending_reconciliation'
      )
      AND (
        (
          "refundClaimSource" = 'SELLER'
          AND "refundClaimSourceGeneration" IS NULL
        )
        OR
        (
          "refundClaimSource" = 'BLOCKED_CHECKOUT'
          AND "refundClaimSourceGeneration" >= 1
        )
      )
    )
  ) NOT VALID;

ALTER TABLE public."Order"
  VALIDATE CONSTRAINT "Order_refundClaimGeneration_non_negative_check";
ALTER TABLE public."Order"
  VALIDATE CONSTRAINT "Order_refundClaim_tuple_check";

CREATE UNIQUE INDEX "Order_refundClaimId_key"
  ON public."Order" ("refundClaimId")
  WHERE "refundClaimId" IS NOT NULL;
CREATE UNIQUE INDEX "Order_refundClaimIdempotencyScope_key"
  ON public."Order" ("refundClaimIdempotencyScope")
  WHERE "refundClaimIdempotencyScope" IS NOT NULL;
CREATE INDEX "Order_refundClaimSource_state_idx"
  ON public."Order" (
    "refundClaimSource",
    "refundClaimProviderAuthorizedAt",
    "refundClaimGeneration"
  )
  WHERE "refundClaimId" IS NOT NULL;

CREATE FUNCTION public.grainline_seller_refund_claim(
  p_actor_user_id text,
  p_order_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_refund_claim$
DECLARE
  locked_actor public."User"%ROWTYPE;
  locked_seller public."SellerProfile"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  claim_id text;
  claim_generation bigint;
  claim_amount integer;
  idempotency_scope text;
  transition_at timestamp(3) without time zone;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Seller refund claim input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT actor.*
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR UPDATE;
  IF NOT FOUND OR locked_actor."deletedAt" IS NOT NULL OR locked_actor.banned THEN
    RAISE EXCEPTION 'Seller refund actor is not active'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT seller.*
    INTO locked_seller
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = locked_actor.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller refund actor has no seller profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND OR locked_order."sellerProfileId" IS DISTINCT FROM locked_seller.id THEN
    RAISE EXCEPTION 'Seller refund Order authority is invalid'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF locked_order."sellerRefundId" = 'pending'
     AND locked_order."refundClaimId" IS NOT NULL
     AND locked_order."refundClaimSource" = 'SELLER'
     AND locked_order."refundClaimSourceId" = locked_actor.id
     AND locked_order."refundClaimSourceGeneration" IS NULL
     AND locked_order."refundClaimProviderAuthorizedAt" IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_order."refundClaimId",
      'claimGeneration', locked_order."refundClaimGeneration",
      'idempotencyScope', locked_order."refundClaimIdempotencyScope",
      'refundAmountCents',
        locked_order."itemsSubtotalCents"
        + locked_order."shippingAmountCents"
        + COALESCE(locked_order."giftWrappingPriceCents", 0)
        + locked_order."taxAmountCents",
      'currency', pg_catalog.lower(locked_order.currency),
      'paymentIntentId', locked_order."stripePaymentIntentId",
      'itemsSubtotalCents', locked_order."itemsSubtotalCents",
      'shippingAmountCents', locked_order."shippingAmountCents",
      'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
      'taxAmountCents', locked_order."taxAmountCents",
      'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
      'action', 'replay'
    );
  END IF;

  IF locked_order."sellerRefundId" IS NOT NULL
     OR locked_order."sellerRefundLockedAt" IS NOT NULL
     OR locked_order."caseResolutionClaimId" IS NOT NULL
     OR locked_order."refundClaimId" IS NOT NULL
     OR locked_order."stripePaymentIntentId" IS NULL
     OR locked_order."paidAt" IS NULL
     OR locked_order."labelStatus"::text = 'PURCHASED'
     OR EXISTS (
       SELECT 1
         FROM public."OrderPaymentEvent" AS payment_event
        WHERE payment_event."orderId" = locked_order.id
          AND payment_event."eventType" = 'REFUND'
          AND (
            payment_event.status IS NULL
            OR pg_catalog.lower(payment_event.status)
              NOT IN ('failed', 'canceled', 'cancelled')
          )
     )
     OR EXISTS (
       SELECT 1
         FROM (
           SELECT DISTINCT ON (
             COALESCE(dispute_event."stripeObjectId", dispute_event.id)
           ) dispute_event.status
             FROM public."OrderPaymentEvent" AS dispute_event
            WHERE dispute_event."orderId" = locked_order.id
              AND dispute_event."eventType" = 'DISPUTE'
            ORDER BY
              COALESCE(dispute_event."stripeObjectId", dispute_event.id),
              COALESCE(
                CASE
                  WHEN dispute_event.metadata->>'stripeEventCreated' ~ '^[0-9]+$'
                  THEN (dispute_event.metadata->>'stripeEventCreated')::bigint
                  ELSE NULL
                END,
                EXTRACT(EPOCH FROM dispute_event."createdAt")::bigint
              ) DESC,
              dispute_event."createdAt" DESC,
              dispute_event.id DESC
         ) AS latest_dispute
        WHERE latest_dispute.status IS NULL
           OR pg_catalog.lower(latest_dispute.status)
             NOT IN ('won', 'lost', 'prevented', 'warning_closed')
     ) THEN
    RETURN NULL;
  END IF;

  claim_amount :=
    locked_order."itemsSubtotalCents"
    + locked_order."shippingAmountCents"
    + COALESCE(locked_order."giftWrappingPriceCents", 0)
    + locked_order."taxAmountCents";
  IF claim_amount <= 0 OR claim_amount > 2147483647
     OR locked_order.currency !~ '^[A-Za-z]{3}$' THEN
    RAISE EXCEPTION 'Seller refund amount or currency is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  transition_at := pg_catalog.clock_timestamp()::timestamp(3);
  claim_generation := locked_order."refundClaimGeneration" + 1;
  claim_id := 'order_refund_claim_' || pg_catalog.gen_random_uuid()::text;
  idempotency_scope :=
    'seller-refund:' || claim_id || ':FULL:' || claim_amount::text;

  UPDATE public."Order" AS orders
     SET "sellerRefundId" = 'pending',
         "sellerRefundLockedAt" = transition_at,
         "refundClaimId" = claim_id,
         "refundClaimGeneration" = claim_generation,
         "refundClaimSource" = 'SELLER',
         "refundClaimSourceId" = locked_actor.id,
         "refundClaimSourceGeneration" = NULL,
         "refundClaimIdempotencyScope" = idempotency_scope,
         "refundClaimProviderAuthorizedAt" = transition_at
   WHERE orders.id = locked_order.id
     AND orders."refundClaimGeneration" = locked_order."refundClaimGeneration"
     AND orders."sellerRefundId" IS NULL
     AND orders."refundClaimId" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller refund claim acquisition raced'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'claimId', claim_id,
    'claimGeneration', claim_generation,
    'idempotencyScope', idempotency_scope,
    'refundAmountCents', claim_amount,
    'currency', pg_catalog.lower(locked_order.currency),
    'paymentIntentId', locked_order."stripePaymentIntentId",
    'itemsSubtotalCents', locked_order."itemsSubtotalCents",
    'shippingAmountCents', locked_order."shippingAmountCents",
    'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
    'taxAmountCents', locked_order."taxAmountCents",
    'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
    'action', 'claimed'
  );
END
$grainline_seller_refund_claim$;

CREATE FUNCTION public.grainline_blocked_checkout_refund_claim(
  p_event_id text,
  p_event_claim_generation bigint,
  p_session_id text,
  p_order_id text,
  p_expected_amount_cents integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_blocked_checkout_refund_claim$
DECLARE
  locked_event public."StripeWebhookEvent"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  claim_id text;
  claim_generation bigint;
  claim_amount integer;
  idempotency_scope text;
  transition_at timestamp(3) without time zone;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_event_claim_generation IS NULL OR p_event_claim_generation < 1
     OR p_session_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_session_id)) NOT BETWEEN 1 AND 255
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191
     OR p_expected_amount_cents IS NULL OR p_expected_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Blocked-checkout refund claim input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT source_event.*
    INTO locked_event
    FROM public."StripeWebhookEvent" AS source_event
   WHERE source_event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_event.type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR locked_event."claimGeneration" IS DISTINCT FROM p_event_claim_generation
     OR locked_event."processingStartedAt" IS NULL
     OR locked_event."processedAt" IS NOT NULL
     OR locked_event."sourceObjectId" IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'Blocked-checkout refund source lease is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND OR locked_order."stripeSessionId" IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'Blocked-checkout refund Order source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF locked_order."sellerRefundId" = 'pending'
     AND locked_order."refundClaimId" IS NOT NULL
     AND locked_order."refundClaimSource" = 'BLOCKED_CHECKOUT'
     AND locked_order."refundClaimSourceId" = locked_event.id
     AND locked_order."refundClaimSourceGeneration"
       = locked_event."claimGeneration"
     AND locked_order."refundClaimProviderAuthorizedAt" IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_order."refundClaimId",
      'claimGeneration', locked_order."refundClaimGeneration",
      'idempotencyScope', locked_order."refundClaimIdempotencyScope",
      'refundAmountCents',
        locked_order."itemsSubtotalCents"
        + locked_order."shippingAmountCents"
        + COALESCE(locked_order."giftWrappingPriceCents", 0)
        + locked_order."taxAmountCents",
      'currency', pg_catalog.lower(locked_order.currency),
      'paymentIntentId', locked_order."stripePaymentIntentId",
      'itemsSubtotalCents', locked_order."itemsSubtotalCents",
      'shippingAmountCents', locked_order."shippingAmountCents",
      'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
      'taxAmountCents', locked_order."taxAmountCents",
      'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
      'action', 'replay'
    );
  END IF;

  IF locked_order."sellerRefundId" IS NOT NULL
     OR locked_order."sellerRefundLockedAt" IS NOT NULL
     OR locked_order."caseResolutionClaimId" IS NOT NULL
     OR locked_order."refundClaimId" IS NOT NULL
     OR locked_order."stripePaymentIntentId" IS NULL
     OR locked_order."paidAt" IS NULL
     OR EXISTS (
       SELECT 1
         FROM public."OrderPaymentEvent" AS payment_event
        WHERE payment_event."orderId" = locked_order.id
          AND payment_event."eventType" = 'REFUND'
          AND (
            payment_event.status IS NULL
            OR pg_catalog.lower(payment_event.status)
              NOT IN ('failed', 'canceled', 'cancelled')
          )
     )
     OR EXISTS (
       SELECT 1
         FROM (
           SELECT DISTINCT ON (
             COALESCE(dispute_event."stripeObjectId", dispute_event.id)
           ) dispute_event.status
             FROM public."OrderPaymentEvent" AS dispute_event
            WHERE dispute_event."orderId" = locked_order.id
              AND dispute_event."eventType" = 'DISPUTE'
            ORDER BY
              COALESCE(dispute_event."stripeObjectId", dispute_event.id),
              COALESCE(
                CASE
                  WHEN dispute_event.metadata->>'stripeEventCreated' ~ '^[0-9]+$'
                  THEN (dispute_event.metadata->>'stripeEventCreated')::bigint
                  ELSE NULL
                END,
                EXTRACT(EPOCH FROM dispute_event."createdAt")::bigint
              ) DESC,
              dispute_event."createdAt" DESC,
              dispute_event.id DESC
         ) AS latest_dispute
        WHERE latest_dispute.status IS NULL
           OR pg_catalog.lower(latest_dispute.status)
             NOT IN ('won', 'lost', 'prevented', 'warning_closed')
     ) THEN
    RETURN NULL;
  END IF;

  claim_amount :=
    locked_order."itemsSubtotalCents"
    + locked_order."shippingAmountCents"
    + COALESCE(locked_order."giftWrappingPriceCents", 0)
    + locked_order."taxAmountCents";
  IF claim_amount IS DISTINCT FROM p_expected_amount_cents
     OR claim_amount > 2147483647
     OR locked_order.currency !~ '^[A-Za-z]{3}$' THEN
    RAISE EXCEPTION 'Blocked-checkout refund amount or currency drifted'
      USING ERRCODE = 'check_violation';
  END IF;

  transition_at := pg_catalog.clock_timestamp()::timestamp(3);
  claim_generation := locked_order."refundClaimGeneration" + 1;
  claim_id := 'order_refund_claim_' || pg_catalog.gen_random_uuid()::text;
  idempotency_scope :=
    'blocked-checkout-refund:' || claim_id || ':FULL:' || claim_amount::text;

  UPDATE public."Order" AS orders
     SET "sellerRefundId" = 'pending',
         "sellerRefundLockedAt" = transition_at,
         "refundClaimId" = claim_id,
         "refundClaimGeneration" = claim_generation,
         "refundClaimSource" = 'BLOCKED_CHECKOUT',
         "refundClaimSourceId" = locked_event.id,
         "refundClaimSourceGeneration" = locked_event."claimGeneration",
         "refundClaimIdempotencyScope" = idempotency_scope,
         "refundClaimProviderAuthorizedAt" = transition_at,
         "reviewNeeded" = true
   WHERE orders.id = locked_order.id
     AND orders."refundClaimGeneration" = locked_order."refundClaimGeneration"
     AND orders."sellerRefundId" IS NULL
     AND orders."refundClaimId" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blocked-checkout refund claim acquisition raced'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'claimId', claim_id,
    'claimGeneration', claim_generation,
    'idempotencyScope', idempotency_scope,
    'refundAmountCents', claim_amount,
    'currency', pg_catalog.lower(locked_order.currency),
    'paymentIntentId', locked_order."stripePaymentIntentId",
    'itemsSubtotalCents', locked_order."itemsSubtotalCents",
    'shippingAmountCents', locked_order."shippingAmountCents",
    'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
    'taxAmountCents', locked_order."taxAmountCents",
    'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
    'action', 'claimed'
  );
END
$grainline_blocked_checkout_refund_claim$;

REVOKE ALL ON FUNCTION public.grainline_seller_refund_claim(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_blocked_checkout_refund_claim(text, bigint, text, text, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_refund_claim(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_blocked_checkout_refund_claim(text, bigint, text, text, integer)
  TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_seller_refund_claim(text, text) IS
  'Claims one seller-owned full refund with a database-derived generation and provider-authorized idempotency scope.';
COMMENT ON FUNCTION public.grainline_blocked_checkout_refund_claim(text, bigint, text, text, integer) IS
  'Claims one full refund from an exact active signed checkout webhook generation and matching Order/session.';

DO $grainline_order_refund_claim_postflight$
DECLARE
  runtime_role_oid oid := 'grainline_app_runtime'::pg_catalog.regrole;
  function_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.oid IN (
       'public.grainline_seller_refund_claim(text,text)'::pg_catalog.regprocedure,
       'public.grainline_blocked_checkout_refund_claim(text,bigint,text,text,integer)'::pg_catalog.regprocedure
     )
     AND procedure.prosecdef
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proowner <> runtime_role_oid
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE');
  IF function_count <> 2 THEN
    RAISE EXCEPTION 'Order refund claim function posture is incomplete';
  END IF;
END
$grainline_order_refund_claim_postflight$;

COMMIT;
