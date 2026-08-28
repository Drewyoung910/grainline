-- Correct signed charge.refunded identity when the pinned Stripe payload omits
-- its nested refund collection. The function derives an identity only from one
-- exact local refund ledger plus its co-committed audit evidence; ambiguous or
-- mismatched evidence retains the external-refund behavior. OrderPaymentEvent
-- RLS and all table grants remain unchanged for deployment compatibility.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_order_payment_signed_refund_apply(
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
  local_refund_evidence public."OrderPaymentEvent"%ROWTYPE;
  local_refund_evidence_count integer := 0;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  source_now_seconds bigint :=
    pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::bigint;
  payment_event_id text;
  refund_object_id text;
  event_amount integer;
  effective_refund_id text := p_refund_id;
  effective_refund_amount_cents integer := p_refund_amount_cents;
  local_refund_evidence_id text;
  local_refund_evidence_action text;
  local_refund_identity_derived boolean := false;
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

  order_total :=
      source_order."itemsSubtotalCents"
    + source_order."shippingAmountCents"
    + COALESCE(source_order."giftWrappingPriceCents", 0)
    + source_order."taxAmountCents";
  IF order_total <= 0 OR order_total > 2147483647 THEN
    RAISE EXCEPTION 'Signed refund Order total is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_refund_id IS NULL
     AND source_order."sellerRefundId" ~ '^re_[A-Za-z0-9]+$'
     AND source_order."sellerRefundAmountCents"
          IS NOT DISTINCT FROM p_amount_refunded_cents THEN
    SELECT pg_catalog.count(*)::integer
      INTO local_refund_evidence_count
      FROM public."OrderPaymentEvent" AS payment
     WHERE payment."orderId" = source_order.id
       AND payment."stripeObjectId" = source_order."sellerRefundId"
       AND payment."stripeObjectType" = 'refund'
       AND payment."eventType" = 'REFUND'
       AND payment."amountCents" = p_amount_refunded_cents
       AND pg_catalog.lower(payment.currency) = normalized_currency
       AND payment.status IS NOT NULL
       AND pg_catalog.char_length(pg_catalog.btrim(payment.status)) BETWEEN 1 AND 100
       AND pg_catalog.jsonb_typeof(payment.metadata) = 'object'
       AND payment.metadata->>'localAction' IN (
         'SELLER_REFUND_RECORDED',
         'CASE_REFUND_RECORDED',
         'BLOCKED_CHECKOUT_REFUND_RECORDED'
       )
       AND payment.reason = CASE payment.metadata->>'localAction'
         WHEN 'SELLER_REFUND_RECORDED' THEN 'seller_refund'
         WHEN 'CASE_REFUND_RECORDED' THEN 'case_resolution_refund'
         WHEN 'BLOCKED_CHECKOUT_REFUND_RECORDED' THEN 'blocked_checkout'
       END
       AND payment."stripeEventId" =
         'local:' || pg_catalog.lower(payment.metadata->>'localAction')
         || ':' || source_order."sellerRefundId"
       AND pg_catalog.jsonb_typeof(payment.metadata->'refundIds') = 'array'
       AND payment.metadata->'refundIds'
            @> pg_catalog.jsonb_build_array(source_order."sellerRefundId")
       AND EXISTS (
         SELECT 1
           FROM public."SystemAuditLog" AS audit
          WHERE audit.action = payment.metadata->>'localAction'
            AND audit."targetType" = 'ORDER'
            AND audit."targetId" = source_order.id
            AND audit.metadata->>'orderPaymentEventId' = payment.id
            AND audit.metadata->>'stripeRefundId' = source_order."sellerRefundId"
            AND audit.metadata->>'amountCents' = p_amount_refunded_cents::text
            AND pg_catalog.lower(audit.metadata->>'currency') = normalized_currency
       );

    IF local_refund_evidence_count = 1 THEN
      SELECT payment.*
        INTO local_refund_evidence
        FROM public."OrderPaymentEvent" AS payment
       WHERE payment."orderId" = source_order.id
         AND payment."stripeObjectId" = source_order."sellerRefundId"
         AND payment."stripeObjectType" = 'refund'
         AND payment."eventType" = 'REFUND'
         AND payment."amountCents" = p_amount_refunded_cents
         AND pg_catalog.lower(payment.currency) = normalized_currency
         AND payment.status IS NOT NULL
         AND pg_catalog.char_length(pg_catalog.btrim(payment.status)) BETWEEN 1 AND 100
         AND pg_catalog.jsonb_typeof(payment.metadata) = 'object'
         AND payment.metadata->>'localAction' IN (
           'SELLER_REFUND_RECORDED',
           'CASE_REFUND_RECORDED',
           'BLOCKED_CHECKOUT_REFUND_RECORDED'
         )
         AND payment.reason = CASE payment.metadata->>'localAction'
           WHEN 'SELLER_REFUND_RECORDED' THEN 'seller_refund'
           WHEN 'CASE_REFUND_RECORDED' THEN 'case_resolution_refund'
           WHEN 'BLOCKED_CHECKOUT_REFUND_RECORDED' THEN 'blocked_checkout'
         END
         AND payment."stripeEventId" =
           'local:' || pg_catalog.lower(payment.metadata->>'localAction')
           || ':' || source_order."sellerRefundId"
         AND pg_catalog.jsonb_typeof(payment.metadata->'refundIds') = 'array'
         AND payment.metadata->'refundIds'
              @> pg_catalog.jsonb_build_array(source_order."sellerRefundId")
         AND EXISTS (
           SELECT 1
             FROM public."SystemAuditLog" AS audit
            WHERE audit.action = payment.metadata->>'localAction'
              AND audit."targetType" = 'ORDER'
              AND audit."targetId" = source_order.id
              AND audit.metadata->>'orderPaymentEventId' = payment.id
              AND audit.metadata->>'stripeRefundId' = source_order."sellerRefundId"
              AND audit.metadata->>'amountCents' = p_amount_refunded_cents::text
              AND pg_catalog.lower(audit.metadata->>'currency') = normalized_currency
         )
       FOR SHARE;
      effective_refund_id := local_refund_evidence."stripeObjectId";
      effective_refund_amount_cents := local_refund_evidence."amountCents";
      normalized_status := COALESCE(
        NULLIF(pg_catalog.lower(pg_catalog.btrim(local_refund_evidence.status)), ''),
        'refunded'
      );
      local_refund_evidence_id := local_refund_evidence.id;
      local_refund_evidence_action :=
        local_refund_evidence.metadata->>'localAction';
      local_refund_identity_derived := true;
    END IF;
  END IF;

  refund_object_id := COALESCE(
    effective_refund_id,
    'external:' || p_event_id
  );
  event_amount := COALESCE(
    effective_refund_amount_cents,
    p_amount_refunded_cents
  );

  SELECT payment.*
    INTO existing_payment
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."stripeEventId" = p_event_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_payment."orderId" IS DISTINCT FROM source_order.id
       OR existing_payment."stripeObjectType" IS DISTINCT FROM 'refund'
       OR existing_payment."eventType" IS DISTINCT FROM 'REFUND'
       OR existing_payment.currency IS DISTINCT FROM normalized_currency
       OR existing_payment."stripeEventCreatedSeconds"
            IS DISTINCT FROM p_event_created_seconds
       OR existing_payment.metadata->>'chargeId' IS DISTINCT FROM p_charge_id
       OR existing_payment.metadata->>'totalRefundedCents'
            IS DISTINCT FROM p_amount_refunded_cents::text
       OR existing_payment.metadata->>'refundCreatedSeconds'
            IS DISTINCT FROM p_refund_created_seconds::text
       OR existing_payment.metadata->>'refundReason'
            IS DISTINCT FROM normalized_reason
       OR NOT (
         (
           existing_payment."stripeObjectId" IS NOT DISTINCT FROM refund_object_id
           AND existing_payment."amountCents" IS NOT DISTINCT FROM event_amount
           AND existing_payment.status IS NOT DISTINCT FROM normalized_status
           AND existing_payment.metadata->>'latestRefundId'
                IS NOT DISTINCT FROM effective_refund_id
           AND existing_payment.metadata->>'latestRefundAmountCents'
                IS NOT DISTINCT FROM effective_refund_amount_cents::text
           AND existing_payment.metadata->>'localRefundEvidenceId'
                IS NOT DISTINCT FROM local_refund_evidence_id
           AND existing_payment.metadata->>'localRefundEvidenceAction'
                IS NOT DISTINCT FROM local_refund_evidence_action
         )
         OR (
           p_refund_id IS NULL
           AND local_refund_identity_derived
           AND existing_payment."stripeObjectId" = 'external:' || p_event_id
           AND existing_payment."amountCents" = p_amount_refunded_cents
           AND existing_payment.status = 'refunded'
           AND existing_payment.metadata->>'latestRefundId' IS NULL
           AND existing_payment.metadata->>'latestRefundAmountCents' IS NULL
           AND existing_payment.metadata->>'localRefundEvidenceId' IS NULL
           AND existing_payment.metadata->>'localRefundEvidenceAction' IS NULL
         )
       ) THEN
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
    'latestRefundId', effective_refund_id,
    'latestRefundAmountCents', effective_refund_amount_cents,
    'localRefundEvidenceId', local_refund_evidence_id,
    'localRefundEvidenceAction', local_refund_evidence_action,
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

REVOKE ALL ON FUNCTION
  public.grainline_order_payment_signed_refund_apply(
    text, bigint, text, bigint, integer, text, text, integer, text, bigint, text
  ) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_payment_signed_refund_apply(
    text, bigint, text, bigint, integer, text, text, integer, text, bigint, text
  ) TO grainline_app_runtime;

COMMENT ON FUNCTION
  public.grainline_order_payment_signed_refund_apply(
    text, bigint, text, bigint, integer, text, text, integer, text, bigint, text
  ) IS
  'Applies one signed charge.refunded observation and derives an omitted refund identity only from exact durable local refund and audit evidence.';

DO $grainline_signed_refund_identity_verify$
DECLARE
  function_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)'
  );
BEGIN
  IF function_oid IS NULL
     OR NOT (
       SELECT routine.prosecdef
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = function_oid
     )
     OR (
       SELECT routine.proconfig
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = function_oid
     ) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', function_oid, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine,
              LATERAL pg_catalog.aclexplode(
                COALESCE(
                  routine.proacl,
                  pg_catalog.acldefault('f', routine.proowner)
                )
              ) AS acl
        WHERE routine.oid = function_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Signed refund identity function catalog drifted';
  END IF;
END;
$grainline_signed_refund_identity_verify$;

COMMIT;
