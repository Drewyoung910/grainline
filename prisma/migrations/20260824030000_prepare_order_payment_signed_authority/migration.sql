-- Compatible source-bound authority for signed platform refund and dispute
-- webhooks. OrderPaymentEvent RLS and predecessor table grants remain
-- unchanged so old and new deployments can coexist.

BEGIN;

ALTER TABLE public."OrderPaymentEvent"
  ADD COLUMN "stripeEventCreatedSeconds" bigint;

ALTER TABLE public."OrderPaymentEvent"
  ADD CONSTRAINT "OrderPaymentEvent_stripeEventCreatedSeconds_check"
  CHECK (
    "stripeEventCreatedSeconds" IS NULL
    OR "stripeEventCreatedSeconds" BETWEEN 1 AND 253402300799
  ) NOT VALID;

ALTER TABLE public."OrderPaymentEvent"
  VALIDATE CONSTRAINT "OrderPaymentEvent_stripeEventCreatedSeconds_check";

CREATE INDEX "OrderPaymentEvent_order_dispute_event_time_idx"
  ON public."OrderPaymentEvent" (
    "orderId",
    "eventType",
    "stripeObjectId",
    "stripeEventCreatedSeconds" DESC,
    id DESC
  );

CREATE FUNCTION public.grainline_order_payment_signed_refund_apply(
  p_event_id text,
  p_claim_generation bigint,
  p_charge_id text,
  p_event_created_seconds bigint,
  p_amount_refunded_cents integer,
  p_currency text,
  p_refund_id text,
  p_refund_amount_cents integer,
  p_refund_status text,
  p_refund_created_seconds bigint,
  p_refund_reason text
)
RETURNS TABLE (
  action text,
  "paymentEventId" text,
  "orderId" text,
  "orderUpdated" boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_signed_refund_apply$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  existing_payment public."OrderPaymentEvent"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  source_now_seconds bigint :=
    pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::bigint;
  payment_event_id text;
  refund_object_id text;
  event_amount integer;
  order_total integer;
  normalized_currency text := pg_catalog.lower(pg_catalog.btrim(p_currency));
  normalized_status text :=
    COALESCE(NULLIF(pg_catalog.lower(pg_catalog.btrim(p_refund_status)), ''), 'refunded');
  normalized_reason text := NULLIF(pg_catalog.btrim(p_refund_reason), '');
  classification_reason text;
  event_description text;
  event_metadata jsonb;
  has_local_refund boolean;
  has_active_claim boolean;
  is_known_local_refund boolean;
  is_additional_external_refund boolean;
  refund_exceeds_order_total boolean;
  did_update boolean := false;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_charge_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_charge_id)) NOT BETWEEN 1 AND 255
     OR p_event_created_seconds IS NULL
     OR p_event_created_seconds < source_now_seconds - (31 * 24 * 60 * 60)
     OR p_event_created_seconds > source_now_seconds + (10 * 60)
     OR p_amount_refunded_cents IS NULL OR p_amount_refunded_cents <= 0
     OR p_currency IS NULL OR normalized_currency !~ '^[a-z]{3}$'
     OR (
       p_refund_id IS NOT NULL
       AND (
         p_refund_id !~ '^re_[A-Za-z0-9]+$'
         OR pg_catalog.char_length(p_refund_id) > 220
       )
     )
     OR (p_refund_id IS NULL AND (
       p_refund_amount_cents IS NOT NULL
       OR p_refund_status IS NOT NULL
       OR p_refund_created_seconds IS NOT NULL
       OR p_refund_reason IS NOT NULL
     ))
     OR (
       p_refund_id IS NOT NULL
       AND (p_refund_amount_cents IS NULL OR p_refund_amount_cents <= 0)
     )
     OR (
       p_refund_amount_cents IS NOT NULL
       AND p_refund_amount_cents > p_amount_refunded_cents
     )
     OR (
       p_refund_status IS NOT NULL
       AND pg_catalog.char_length(pg_catalog.btrim(p_refund_status)) NOT BETWEEN 1 AND 100
     )
     OR (
       p_refund_created_seconds IS NOT NULL
       AND (
         p_refund_created_seconds < 1
         OR p_refund_created_seconds > p_event_created_seconds
       )
     )
     OR (p_refund_reason IS NOT NULL AND pg_catalog.char_length(p_refund_reason) > 255) THEN
    RAISE EXCEPTION 'Signed refund input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type IS DISTINCT FROM 'charge.refunded'
     OR source_event."sourceObjectId" IS DISTINCT FROM p_charge_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Signed refund source lease is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(p_charge_id));

  SELECT orders.*
    INTO source_order
    FROM public."Order" AS orders
   WHERE orders."stripeChargeId" = p_charge_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_order.currency IS NULL
     OR pg_catalog.lower(source_order.currency) IS DISTINCT FROM normalized_currency THEN
    RAISE EXCEPTION 'Signed refund Order source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  refund_object_id := COALESCE(p_refund_id, 'external:' || p_event_id);
  event_amount := COALESCE(p_refund_amount_cents, p_amount_refunded_cents);
  order_total :=
      source_order."itemsSubtotalCents"
    + source_order."shippingAmountCents"
    + COALESCE(source_order."giftWrappingPriceCents", 0)
    + source_order."taxAmountCents";
  IF order_total <= 0 OR order_total > 2147483647 THEN
    RAISE EXCEPTION 'Signed refund Order total is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT payment.*
    INTO existing_payment
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."stripeEventId" = p_event_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_payment."orderId" IS DISTINCT FROM source_order.id
       OR existing_payment."stripeObjectId" IS DISTINCT FROM refund_object_id
       OR existing_payment."stripeObjectType" IS DISTINCT FROM 'refund'
       OR existing_payment."eventType" IS DISTINCT FROM 'REFUND'
       OR existing_payment."amountCents" IS DISTINCT FROM event_amount
       OR existing_payment.currency IS DISTINCT FROM normalized_currency
       OR existing_payment.status IS DISTINCT FROM normalized_status
       OR existing_payment."stripeEventCreatedSeconds"
            IS DISTINCT FROM p_event_created_seconds
       OR existing_payment.metadata->>'chargeId' IS DISTINCT FROM p_charge_id
       OR existing_payment.metadata->>'latestRefundId'
            IS DISTINCT FROM p_refund_id
       OR existing_payment.metadata->>'latestRefundAmountCents'
            IS DISTINCT FROM p_refund_amount_cents::text
       OR existing_payment.metadata->>'totalRefundedCents'
            IS DISTINCT FROM p_amount_refunded_cents::text
       OR existing_payment.metadata->>'refundCreatedSeconds'
            IS DISTINCT FROM p_refund_created_seconds::text
       OR existing_payment.metadata->>'refundReason'
            IS DISTINCT FROM normalized_reason THEN
      RAISE EXCEPTION 'Signed refund replay payload is inconsistent'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY SELECT
      'replay'::text,
      existing_payment.id::text,
      source_order.id::text,
      false;
    RETURN;
  END IF;

  has_local_refund :=
    source_order."sellerRefundId" IS NOT NULL
    AND source_order."sellerRefundId" NOT IN (
      'pending',
      'ambiguous_refund_pending_reconciliation'
    )
    AND source_order."sellerRefundId" NOT LIKE 'external:%';
  has_active_claim :=
    source_order."refundClaimId" IS NOT NULL
    OR (
      source_order."sellerRefundId" = 'pending'
      AND (
        source_order."caseResolutionClaimId" IS NOT NULL
        OR (
          source_order."sellerRefundLockedAt" IS NOT NULL
          AND source_order."sellerRefundLockedAt" >= source_now - INTERVAL '15 minutes'
        )
      )
    );
  is_known_local_refund :=
    has_local_refund AND source_order."sellerRefundId" = refund_object_id;
  is_additional_external_refund :=
    has_local_refund AND NOT is_known_local_refund;
  refund_exceeds_order_total := p_amount_refunded_cents > order_total;

  classification_reason := CASE
    WHEN has_active_claim THEN 'local_refund_pending_confirmation'
    WHEN normalized_reason IS NOT NULL THEN normalized_reason
    WHEN is_known_local_refund THEN 'local_refund_confirmed'
    WHEN is_additional_external_refund THEN 'additional_external_refund'
    ELSE 'external_refund'
  END;
  event_description := CASE
    WHEN is_known_local_refund THEN
      'Stripe confirmed a Grainline-tracked refund.'
    WHEN has_active_claim THEN
      'Stripe reported a refund while Grainline was recording local refund side effects.'
    WHEN is_additional_external_refund THEN
      'Stripe reported an additional refund outside the local Grainline refund record.'
    ELSE
      'Stripe reported a refund created outside Grainline.'
  END;
  event_metadata := pg_catalog.jsonb_build_object(
    'chargeId', p_charge_id,
    'latestRefundId', p_refund_id,
    'latestRefundAmountCents', p_refund_amount_cents,
    'totalRefundedCents', p_amount_refunded_cents,
    'refundCreatedSeconds', p_refund_created_seconds,
    'refundReason', normalized_reason,
    'preservedLocalRefundId', CASE
      WHEN is_additional_external_refund THEN source_order."sellerRefundId"
      ELSE NULL
    END,
    'pendingLocalRefundLock', has_active_claim,
    'orderTotalCents', order_total,
    'refundExceedsOrderTotal', refund_exceeds_order_total,
    'stripeEventType', source_event.type
  );

  payment_event_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."OrderPaymentEvent" (
    id,
    "orderId",
    "stripeEventId",
    "stripeObjectId",
    "stripeObjectType",
    "eventType",
    "amountCents",
    currency,
    status,
    reason,
    description,
    metadata,
    "stripeEventCreatedSeconds",
    "createdAt",
    "updatedAt"
  ) VALUES (
    payment_event_id,
    source_order.id,
    p_event_id,
    refund_object_id,
    'refund',
    'REFUND',
    event_amount,
    normalized_currency,
    normalized_status,
    classification_reason,
    event_description,
    event_metadata,
    p_event_created_seconds,
    source_now,
    source_now
  );

  IF source_order."sellerRefundId" = refund_object_id OR has_active_claim THEN
    did_update := false;
  ELSIF is_additional_external_refund THEN
    UPDATE public."Order" AS orders
       SET "sellerRefundAmountCents" = GREATEST(
             COALESCE(orders."sellerRefundAmountCents", 0),
             p_amount_refunded_cents
           ),
           "sellerRefundLockedAt" = NULL,
           "reviewNeeded" = true,
           "reviewNote" = CASE
             WHEN refund_exceeds_order_total THEN
               'Additional Stripe refund was detected outside Grainline; total refunded exceeds the order total and staff must reconcile before fulfillment. Local refund audit ID was preserved.'
             ELSE
               'Additional Stripe refund was detected outside Grainline; local refund audit ID was preserved.'
           END
     WHERE orders.id = source_order.id;
    did_update := true;
  ELSE
    UPDATE public."Order" AS orders
       SET "sellerRefundId" = refund_object_id,
           "sellerRefundAmountCents" = p_amount_refunded_cents,
           "sellerRefundLockedAt" = NULL,
           "reviewNeeded" = true,
           "reviewNote" = CASE
             WHEN refund_exceeds_order_total THEN
               'Stripe refund was created outside Grainline; total refunded exceeds the order total and staff must reconcile before fulfillment.'
             ELSE
               'Stripe refund was created outside Grainline.'
           END
     WHERE orders.id = source_order.id;
    did_update := true;
  END IF;

  INSERT INTO public."SystemAuditLog" (
    id,
    "actorType",
    "actorId",
    action,
    "targetType",
    "targetId",
    reason,
    metadata,
    "createdAt"
  ) VALUES (
    'signed-refund-audit:' || pg_catalog.gen_random_uuid()::text,
    'webhook',
    p_event_id,
    'STRIPE_REFUND_RECORDED',
    'ORDER',
    source_order.id,
    classification_reason,
    pg_catalog.jsonb_build_object(
      'orderPaymentEventId', payment_event_id,
      'stripeEventType', source_event.type,
      'stripeChargeId', p_charge_id,
      'stripeRefundId', refund_object_id,
      'amountCents', event_amount,
      'currency', normalized_currency,
      'status', normalized_status,
      'hasOrderUpdate', did_update
    ),
    source_now
  );

  RETURN QUERY SELECT
    'inserted'::text,
    payment_event_id,
    source_order.id::text,
    did_update;
END
$grainline_order_payment_signed_refund_apply$;

CREATE FUNCTION public.grainline_order_payment_signed_dispute_apply(
  p_event_id text,
  p_claim_generation bigint,
  p_charge_id text,
  p_dispute_id text,
  p_event_created_seconds bigint,
  p_amount_cents integer,
  p_currency text,
  p_reason text,
  p_status text
)
RETURNS TABLE (
  action text,
  "paymentEventId" text,
  "orderId" text,
  "sellerUserId" text,
  "buyerUserId" text,
  "caseId" text,
  "caseAction" text,
  "notificationAuthorized" boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_signed_dispute_apply$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  source_seller_user_id text;
  existing_payment public."OrderPaymentEvent"%ROWTYPE;
  latest_payment record;
  case_result record;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  source_now_seconds bigint :=
    pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::bigint;
  payment_event_id text;
  normalized_currency text := pg_catalog.lower(pg_catalog.btrim(p_currency));
  normalized_reason text := NULLIF(pg_catalog.btrim(p_reason), '');
  normalized_status text := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_status)), '');
  event_description text;
  event_metadata jsonb;
  result_action text;
  should_apply boolean := false;
  is_terminal boolean;
  case_id text;
  case_action text;
  notification_authorized boolean := false;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_charge_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_charge_id)) NOT BETWEEN 1 AND 255
     OR p_dispute_id IS NULL
     OR p_dispute_id !~ '^dp_[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_dispute_id) > 220
     OR p_event_created_seconds IS NULL
     OR p_event_created_seconds < source_now_seconds - (31 * 24 * 60 * 60)
     OR p_event_created_seconds > source_now_seconds + (10 * 60)
     OR p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_currency IS NULL OR normalized_currency !~ '^[a-z]{3}$'
     OR (p_reason IS NOT NULL AND pg_catalog.char_length(p_reason) > 255)
     OR normalized_status IS NULL
     OR pg_catalog.char_length(normalized_status) > 100 THEN
    RAISE EXCEPTION 'Signed dispute input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type NOT IN (
       'charge.dispute.created',
       'charge.dispute.updated',
       'charge.dispute.closed',
       'charge.dispute.funds_withdrawn',
       'charge.dispute.funds_reinstated'
     )
     OR source_event."sourceObjectId" IS DISTINCT FROM p_dispute_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Signed dispute source lease is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(p_charge_id));

  SELECT orders.*
    INTO source_order
    FROM public."Order" AS orders
   WHERE orders."stripeChargeId" = p_charge_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_order."buyerId" IS NULL
     OR source_order."sellerProfileId" IS NULL
     OR source_order.currency IS NULL
     OR pg_catalog.lower(source_order.currency) IS DISTINCT FROM normalized_currency THEN
    RAISE EXCEPTION 'Signed dispute Order source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT seller."userId"
    INTO source_seller_user_id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = source_order."sellerProfileId"
   FOR SHARE;
  IF NOT FOUND
     OR source_seller_user_id IS NULL
     OR source_seller_user_id = source_order."buyerId" THEN
    RAISE EXCEPTION 'Signed dispute participant source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_dispute_id, 824030003)
  );

  SELECT payment.*
    INTO existing_payment
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."stripeEventId" = p_event_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_payment."orderId" IS DISTINCT FROM source_order.id
       OR existing_payment."stripeObjectId" IS DISTINCT FROM p_dispute_id
       OR existing_payment."stripeObjectType" IS DISTINCT FROM 'dispute'
       OR existing_payment."eventType" IS DISTINCT FROM 'DISPUTE'
       OR existing_payment."amountCents" IS DISTINCT FROM p_amount_cents
       OR existing_payment.currency IS DISTINCT FROM normalized_currency
       OR existing_payment.status IS DISTINCT FROM normalized_status
       OR existing_payment.reason IS DISTINCT FROM normalized_reason
       OR existing_payment."stripeEventCreatedSeconds"
            IS DISTINCT FROM p_event_created_seconds
       OR existing_payment.metadata->>'chargeId' IS DISTINCT FROM p_charge_id
       OR existing_payment.metadata->>'disputeId' IS DISTINCT FROM p_dispute_id
       OR existing_payment.metadata->>'stripeEventType'
            IS DISTINCT FROM source_event.type
       OR existing_payment.metadata->>'stripeEventCreated'
            IS DISTINCT FROM p_event_created_seconds::text THEN
      RAISE EXCEPTION 'Signed dispute replay payload is inconsistent'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY SELECT
      'replay'::text,
      existing_payment.id::text,
      source_order.id::text,
      source_seller_user_id,
      source_order."buyerId"::text,
      NULL::text,
      NULL::text,
      false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."OrderPaymentEvent" AS legacy_payment
     WHERE legacy_payment."orderId" = source_order.id
       AND legacy_payment."eventType" = 'DISPUTE'
       AND legacy_payment."stripeObjectId" = p_dispute_id
       AND legacy_payment."stripeEventCreatedSeconds" IS NULL
       AND (
         pg_catalog.jsonb_typeof(legacy_payment.metadata) IS DISTINCT FROM 'object'
         OR legacy_payment.metadata->>'stripeEventCreated' IS NULL
         OR legacy_payment.metadata->>'stripeEventCreated' !~ '^[0-9]{1,12}$'
       )
  ) THEN
    RAISE EXCEPTION 'Signed dispute legacy ordering requires reconciliation'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT
    payment."stripeEventId",
    payment."amountCents",
    payment.currency,
    payment.status,
    payment.reason,
    payment.metadata->>'stripeEventType' AS stripe_event_type,
    COALESCE(
      payment."stripeEventCreatedSeconds",
      CASE
        WHEN payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
        THEN (payment.metadata->>'stripeEventCreated')::bigint
        ELSE NULL
      END
    ) AS stripe_event_created
    INTO latest_payment
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."orderId" = source_order.id
     AND payment."eventType" = 'DISPUTE'
     AND payment."stripeObjectType" = 'dispute'
     AND payment."stripeObjectId" = p_dispute_id
   ORDER BY
     COALESCE(
       payment."stripeEventCreatedSeconds",
       CASE
         WHEN payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
         THEN (payment.metadata->>'stripeEventCreated')::bigint
         ELSE NULL
       END
     ) DESC NULLS LAST,
     payment.id DESC
   LIMIT 1
   FOR SHARE;

  IF NOT FOUND THEN
    result_action := 'applied';
    should_apply := true;
  ELSIF p_event_created_seconds > latest_payment.stripe_event_created THEN
    result_action := 'applied';
    should_apply := true;
  ELSIF p_event_created_seconds < latest_payment.stripe_event_created THEN
    result_action := 'stale_recorded';
  ELSIF EXISTS (
    SELECT 1
      FROM public."OrderPaymentEvent" AS equal_payment
     WHERE equal_payment."orderId" = source_order.id
       AND equal_payment."eventType" = 'DISPUTE'
       AND equal_payment."stripeObjectType" = 'dispute'
       AND equal_payment."stripeObjectId" = p_dispute_id
       AND COALESCE(
             equal_payment."stripeEventCreatedSeconds",
             CASE
               WHEN equal_payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
               THEN (equal_payment.metadata->>'stripeEventCreated')::bigint
               ELSE NULL
             END
           ) = p_event_created_seconds
       AND (
         equal_payment."amountCents" IS DISTINCT FROM p_amount_cents
         OR equal_payment.currency IS DISTINCT FROM normalized_currency
         OR equal_payment.status IS DISTINCT FROM normalized_status
         OR equal_payment.reason IS DISTINCT FROM normalized_reason
         OR equal_payment.metadata->>'stripeEventType'
              IS DISTINCT FROM source_event.type
       )
  ) THEN
    result_action := 'conflict_recorded';
  ELSE
    result_action := 'same_second_recorded';
  END IF;

  event_description := pg_catalog.left(
    'Stripe dispute '
      || source_event.type
      || CASE
           WHEN normalized_reason IS NULL THEN ''
           ELSE ': ' || normalized_reason
         END,
    5000
  );
  event_metadata := pg_catalog.jsonb_build_object(
    'chargeId', p_charge_id,
    'disputeId', p_dispute_id,
    'stripeEventType', source_event.type,
    'stripeEventCreated', p_event_created_seconds,
    'orderingAction', result_action
  );

  payment_event_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."OrderPaymentEvent" (
    id,
    "orderId",
    "stripeEventId",
    "stripeObjectId",
    "stripeObjectType",
    "eventType",
    "amountCents",
    currency,
    status,
    reason,
    description,
    metadata,
    "stripeEventCreatedSeconds",
    "createdAt",
    "updatedAt"
  ) VALUES (
    payment_event_id,
    source_order.id,
    p_event_id,
    p_dispute_id,
    'dispute',
    'DISPUTE',
    p_amount_cents,
    normalized_currency,
    normalized_status,
    normalized_reason,
    event_description,
    event_metadata,
    p_event_created_seconds,
    source_now,
    source_now
  );

  is_terminal := normalized_status IN (
    'won',
    'lost',
    'prevented',
    'warning_closed'
  );
  IF result_action = 'conflict_recorded' THEN
    UPDATE public."Order" AS orders
       SET "reviewNeeded" = true,
           "reviewNote" =
             'Stripe reported conflicting dispute states at the same provider second; staff must reconcile before further automated dispute actions.'
     WHERE orders.id = source_order.id;
  ELSIF should_apply THEN
    UPDATE public."Order" AS orders
       SET "reviewNeeded" = true,
           "reviewNote" = event_description,
           "sellerRefundLockedAt" = CASE
             WHEN is_terminal
              AND orders."sellerRefundId" = 'pending'
              AND orders."refundClaimId" IS NULL
              AND (
                orders."sellerRefundLockedAt" IS NULL
                OR orders."sellerRefundLockedAt" < source_now - INTERVAL '15 minutes'
              )
             THEN NULL
             ELSE orders."sellerRefundLockedAt"
           END
     WHERE orders.id = source_order.id;

    IF source_event.type = 'charge.dispute.created' THEN
      SELECT application.*
        INTO case_result
        FROM public.grainline_case_stripe_dispute_apply(payment_event_id)
          AS application;
      IF NOT FOUND
         OR case_result."orderId" IS DISTINCT FROM source_order.id
         OR case_result."sellerUserId" IS DISTINCT FROM source_seller_user_id
         OR case_result."buyerUserId" IS DISTINCT FROM source_order."buyerId"
         OR case_result."paymentEventId" IS DISTINCT FROM payment_event_id
         OR case_result.action NOT IN ('create', 'reopen', 'replay') THEN
        RAISE EXCEPTION 'Signed dispute Case result is invalid'
          USING ERRCODE = 'check_violation';
      END IF;
      case_id := case_result."caseId";
      case_action := case_result.action;
      notification_authorized := case_result.action IN ('create', 'reopen');
    END IF;
  END IF;

  INSERT INTO public."SystemAuditLog" (
    id,
    "actorType",
    "actorId",
    action,
    "targetType",
    "targetId",
    reason,
    metadata,
    "createdAt"
  ) VALUES (
    'signed-dispute-audit:' || pg_catalog.gen_random_uuid()::text,
    'webhook',
    p_event_id,
    'STRIPE_DISPUTE_RECORDED',
    'ORDER',
    source_order.id,
    normalized_reason,
    pg_catalog.jsonb_build_object(
      'orderPaymentEventId', payment_event_id,
      'stripeEventType', source_event.type,
      'stripeChargeId', p_charge_id,
      'stripeDisputeId', p_dispute_id,
      'amountCents', p_amount_cents,
      'currency', normalized_currency,
      'status', normalized_status,
      'caseAction', COALESCE(case_action, 'none'),
      'hasOrderUpdate', should_apply OR result_action = 'conflict_recorded',
      'disputeSideEffectsApplied', should_apply,
      'orderingAction', result_action,
      'latestRecordedStripeEventId', latest_payment."stripeEventId",
      'latestRecordedStripeEventCreated', latest_payment.stripe_event_created
    ),
    source_now
  );

  RETURN QUERY SELECT
    result_action,
    payment_event_id,
    source_order.id::text,
    source_seller_user_id,
    source_order."buyerId"::text,
    case_id,
    case_action,
    notification_authorized;
END
$grainline_order_payment_signed_dispute_apply$;

REVOKE ALL ON FUNCTION
  public.grainline_order_payment_signed_refund_apply(
    text,
    bigint,
    text,
    bigint,
    integer,
    text,
    text,
    integer,
    text,
    bigint,
    text
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_payment_signed_refund_apply(
    text,
    bigint,
    text,
    bigint,
    integer,
    text,
    text,
    integer,
    text,
    bigint,
    text
  )
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_order_payment_signed_dispute_apply(
    text,
    bigint,
    text,
    text,
    bigint,
    integer,
    text,
    text,
    text
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_payment_signed_dispute_apply(
    text,
    bigint,
    text,
    text,
    bigint,
    integer,
    text,
    text,
    text
  )
  TO grainline_app_runtime;

COMMIT;
