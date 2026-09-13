-- Evidence-bound reconciliation for generation-fenced seller and
-- blocked-checkout refunds. This compatible release does not change
-- OrderPaymentEvent RLS or predecessor Order/table grants.

BEGIN;

DO $grainline_order_refund_reconciliation_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."OrderRefundReconciliation"') IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_order_refund_reconciliation_immutable()'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_order_refund_reconciliation_prepare(text,text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_order_refund_claim_mark_ambiguous(text,bigint,text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Order refund reconciliation authority already exists'
      USING ERRCODE = 'duplicate_object';
  END IF;
END
$grainline_order_refund_reconciliation_preflight$;

CREATE TABLE public."OrderRefundReconciliation" (
  id TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "claimId" VARCHAR(255) NOT NULL,
  "claimGeneration" BIGINT NOT NULL,
  "claimSource" VARCHAR(32) NOT NULL,
  "claimSourceId" VARCHAR(255) NOT NULL,
  "claimSourceGeneration" BIGINT,
  "idempotencyScope" VARCHAR(191) NOT NULL,
  action VARCHAR(40) NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "providerInspectedAt" TIMESTAMP(3) NOT NULL,
  "providerDisposition" VARCHAR(32) NOT NULL,
  "providerEvidenceSha256" VARCHAR(64) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  "auditLogId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  ),

  CONSTRAINT "OrderRefundReconciliation_pkey" PRIMARY KEY (id),
  CONSTRAINT "OrderRefundReconciliation_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES public."Order"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderRefundReconciliation_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES public."User"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderRefundReconciliation_auditLogId_fkey"
    FOREIGN KEY ("auditLogId") REFERENCES public."AdminAuditLog"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderRefundReconciliation_auditLogId_key"
    UNIQUE ("auditLogId"),
  CONSTRAINT "OrderRefundReconciliation_replay_key"
    UNIQUE (
      "claimId",
      "claimGeneration",
      action,
      "providerEvidenceSha256"
    ),
  CONSTRAINT "OrderRefundReconciliation_identity_check"
    CHECK (
      id ~ '^order-refund-reconcile:[0-9a-f-]{36}$'
      AND pg_catalog.char_length("orderId") BETWEEN 1 AND 191
      AND "claimId" ~ '^order_refund_claim_[0-9a-f-]{36}$'
      AND "claimGeneration" >= 1
      AND "claimSource" IN ('SELLER', 'BLOCKED_CHECKOUT')
      AND pg_catalog.char_length("claimSourceId") BETWEEN 1 AND 255
      AND pg_catalog.char_length("actorUserId") BETWEEN 1 AND 191
    ),
  CONSTRAINT "OrderRefundReconciliation_source_shape_check"
    CHECK (
      (
        "claimSource" = 'SELLER'
        AND "claimSourceGeneration" IS NULL
        AND "idempotencyScope" ~
          ('^seller-refund:' || "claimId" || ':FULL:[1-9][0-9]*$')
      )
      OR
      (
        "claimSource" = 'BLOCKED_CHECKOUT'
        AND "claimSourceGeneration" >= 1
        AND "idempotencyScope" ~
          ('^blocked-checkout-refund:' || "claimId" || ':FULL:[1-9][0-9]*$')
      )
    ),
  CONSTRAINT "OrderRefundReconciliation_action_check"
    CHECK (
      action IN (
        'RETRY_EXISTING_SCOPE',
        'CONFIRMED_PROVIDER_EFFECT',
        'CONFIRMED_NO_PROVIDER_EFFECT'
      )
      AND (
        (action = 'RETRY_EXISTING_SCOPE'
          AND "providerDisposition" = 'ABSENT')
        OR (action = 'CONFIRMED_PROVIDER_EFFECT'
          AND "providerDisposition" = 'USABLE_REFUND')
        OR (action = 'CONFIRMED_NO_PROVIDER_EFFECT'
          AND "providerDisposition" IN ('ABSENT', 'TERMINAL_NO_EFFECT'))
      )
    ),
  CONSTRAINT "OrderRefundReconciliation_evidence_check"
    CHECK (
      "providerEvidenceSha256" ~ '^[0-9a-f]{64}$'
      AND pg_catalog.char_length(pg_catalog.btrim(reason)) BETWEEN 10 AND 1000
      AND "providerInspectedAt" <= "createdAt" + INTERVAL '5 minutes'
    )
);

CREATE INDEX "OrderRefundReconciliation_orderId_createdAt_idx"
  ON public."OrderRefundReconciliation" ("orderId", "createdAt" DESC);
CREATE INDEX "OrderRefundReconciliation_claimId_createdAt_idx"
  ON public."OrderRefundReconciliation" ("claimId", "createdAt" DESC);
CREATE INDEX "OrderRefundReconciliation_actorUserId_createdAt_idx"
  ON public."OrderRefundReconciliation" ("actorUserId", "createdAt" DESC);

ALTER TABLE public."OrderRefundReconciliation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderRefundReconciliation" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."OrderRefundReconciliation"
  FROM PUBLIC, grainline_app_runtime;

CREATE FUNCTION public.grainline_order_refund_reconciliation_immutable()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SET search_path = pg_catalog
AS $grainline_order_refund_reconciliation_immutable$
BEGIN
  RAISE EXCEPTION 'Order refund reconciliation evidence is immutable'
    USING ERRCODE = 'integrity_constraint_violation';
END
$grainline_order_refund_reconciliation_immutable$;

REVOKE ALL ON FUNCTION
  public.grainline_order_refund_reconciliation_immutable()
  FROM PUBLIC, grainline_app_runtime;
CREATE TRIGGER grainline_order_refund_reconciliation_immutable
BEFORE UPDATE OR DELETE ON public."OrderRefundReconciliation"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_order_refund_reconciliation_immutable();

CREATE FUNCTION public.grainline_order_refund_reconciliation_prepare(
  p_actor_user_id text,
  p_order_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_refund_reconciliation_prepare$
DECLARE
  source_actor public."User"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  claim_amount integer;
  provider_authorized_seconds bigint;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id))
          NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id))
          NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Order refund reconciliation input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT actor.*
    INTO source_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id;
  IF NOT FOUND
     OR source_actor.role <> 'ADMIN'::public."Role"
     OR source_actor.banned
     OR source_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Order refund reconciliation requires a current ADMIN'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT orders.*
    INTO source_order
    FROM public."Order" AS orders
   WHERE orders.id = p_order_id;
  IF NOT FOUND
     OR source_order."refundClaimId" IS NULL
     OR source_order."refundClaimGeneration" < 1
     OR source_order."refundClaimProviderAuthorizedAt" IS NULL
     OR source_order."sellerRefundId" NOT IN (
       'pending',
       'ambiguous_refund_pending_reconciliation'
     ) THEN
    RETURN NULL;
  END IF;

  claim_amount :=
      source_order."itemsSubtotalCents"
    + source_order."shippingAmountCents"
    + COALESCE(source_order."giftWrappingPriceCents", 0)
    + source_order."taxAmountCents";
  IF claim_amount <= 0
     OR source_order.currency !~ '^[A-Za-z]{3}$'
     OR source_order."stripePaymentIntentId" IS NULL
     OR (
       source_order."refundClaimSource" = 'SELLER'
       AND (
         source_order."refundClaimSourceGeneration" IS NOT NULL
         OR source_order."refundClaimIdempotencyScope" IS DISTINCT FROM
           'seller-refund:' || source_order."refundClaimId"
           || ':FULL:' || claim_amount::text
       )
     )
     OR (
       source_order."refundClaimSource" = 'BLOCKED_CHECKOUT'
       AND (
         source_order."refundClaimSourceGeneration" IS NULL
         OR source_order."refundClaimSourceGeneration" < 1
         OR source_order."refundClaimIdempotencyScope" IS DISTINCT FROM
           'blocked-checkout-refund:' || source_order."refundClaimId"
           || ':FULL:' || claim_amount::text
       )
     )
     OR source_order."refundClaimSource" NOT IN (
       'SELLER',
       'BLOCKED_CHECKOUT'
     ) THEN
    RAISE EXCEPTION 'Order refund reconciliation claim shape is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  provider_authorized_seconds := pg_catalog.floor(
    EXTRACT(EPOCH FROM (
      source_order."refundClaimProviderAuthorizedAt" AT TIME ZONE 'UTC'
    ))
  )::bigint;

  RETURN pg_catalog.jsonb_build_object(
    'orderId', source_order.id,
    'claimId', source_order."refundClaimId",
    'claimGeneration', source_order."refundClaimGeneration",
    'claimSource', source_order."refundClaimSource",
    'claimSourceId', source_order."refundClaimSourceId",
    'claimSourceGeneration', source_order."refundClaimSourceGeneration",
    'idempotencyScope', source_order."refundClaimIdempotencyScope",
    'providerAuthorizedAtSeconds', provider_authorized_seconds,
    'refundAmountCents', claim_amount,
    'currency', pg_catalog.lower(source_order.currency),
    'paymentIntentId', source_order."stripePaymentIntentId",
    'itemsSubtotalCents', source_order."itemsSubtotalCents",
    'shippingAmountCents', source_order."shippingAmountCents",
    'giftWrappingPriceCents', source_order."giftWrappingPriceCents",
    'taxAmountCents', source_order."taxAmountCents",
    'canReverseTransfer', source_order."stripeTransferId" IS NOT NULL,
    'state', CASE source_order."sellerRefundId"
      WHEN 'pending' THEN 'RETRY_PENDING'
      ELSE 'RECONCILIATION_REQUIRED'
    END
  );
END
$grainline_order_refund_reconciliation_prepare$;

CREATE FUNCTION public.grainline_order_refund_claim_mark_ambiguous(
  p_claim_id text,
  p_claim_generation bigint,
  p_reason_code text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_refund_claim_mark_ambiguous$
DECLARE
  locked_order public."Order"%ROWTYPE;
  review_note text;
BEGIN
  IF p_claim_id IS NULL
     OR p_claim_id !~ '^order_refund_claim_[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_reason_code NOT IN (
       'SELLER_CLAIM_DRIFT',
       'SELLER_PROVIDER_AMBIGUOUS',
       'BLOCKED_CHECKOUT_PROVIDER_AMBIGUOUS',
       'ADMIN_RECONCILIATION_INTERRUPTED'
     ) THEN
    RAISE EXCEPTION 'Order refund ambiguous transition input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders."refundClaimId" = p_claim_id
     AND orders."refundClaimGeneration" = p_claim_generation
   FOR UPDATE;
  IF NOT FOUND
     OR locked_order."refundClaimProviderAuthorizedAt" IS NULL
     OR locked_order."sellerRefundId" NOT IN (
       'pending',
       'ambiguous_refund_pending_reconciliation'
     )
     OR (
       p_reason_code LIKE 'SELLER_%'
       AND locked_order."refundClaimSource" <> 'SELLER'
     )
     OR (
       p_reason_code = 'BLOCKED_CHECKOUT_PROVIDER_AMBIGUOUS'
       AND locked_order."refundClaimSource" <> 'BLOCKED_CHECKOUT'
     ) THEN
    RAISE EXCEPTION 'Order refund claim is not active for ambiguous transition'
      USING ERRCODE = 'serialization_failure';
  END IF;

  review_note := CASE p_reason_code
    WHEN 'SELLER_CLAIM_DRIFT' THEN
      'Seller refund claim drifted from the loaded Order; staff must reconcile before another attempt.'
    WHEN 'SELLER_PROVIDER_AMBIGUOUS' THEN
      'Seller refund attempt has an ambiguous Stripe outcome; staff must reconcile Stripe before another refund is attempted.'
    WHEN 'BLOCKED_CHECKOUT_PROVIDER_AMBIGUOUS' THEN
      'Automatic blocked-checkout refund has an ambiguous Stripe outcome; staff must reconcile Stripe before another refund is attempted.'
    ELSE
      'Administrator refund reconciliation was interrupted; staff must inspect the exact Stripe claim before another attempt.'
  END;

  IF locked_order."sellerRefundId"
       = 'ambiguous_refund_pending_reconciliation' THEN
    RETURN pg_catalog.jsonb_build_object(
      'orderId', locked_order.id,
      'claimId', locked_order."refundClaimId",
      'claimGeneration', locked_order."refundClaimGeneration",
      'status', 'RECONCILIATION_REQUIRED',
      'action', 'replay'
    );
  END IF;

  UPDATE public."Order" AS orders
     SET "sellerRefundId" = 'ambiguous_refund_pending_reconciliation',
         "sellerRefundLockedAt" = NULL,
         "reviewNeeded" = true,
         "reviewNote" = review_note
   WHERE orders.id = locked_order.id
     AND orders."refundClaimId" = p_claim_id
     AND orders."refundClaimGeneration" = p_claim_generation
     AND orders."sellerRefundId" = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order refund ambiguous transition raced'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'orderId', locked_order.id,
    'claimId', locked_order."refundClaimId",
    'claimGeneration', locked_order."refundClaimGeneration",
    'status', 'RECONCILIATION_REQUIRED',
    'action', 'recorded'
  );
END
$grainline_order_refund_claim_mark_ambiguous$;

CREATE FUNCTION public.grainline_order_refund_reconcile(
  p_actor_user_id text,
  p_claim_id text,
  p_claim_generation bigint,
  p_action text,
  p_reason text,
  p_provider_inspected_at_seconds bigint,
  p_provider_disposition text,
  p_provider_evidence_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_refund_reconcile$
DECLARE
  source_actor public."User"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  existing_reconciliation public."OrderRefundReconciliation"%ROWTYPE;
  claim_amount integer;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  provider_inspected_at timestamp(3) without time zone;
  retry_deadline timestamp(3) without time zone;
  release_not_before timestamp(3) without time zone;
  normalized_reason text := pg_catalog.btrim(p_reason);
  reconciliation_id text;
  audit_id text;
  result_action text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id))
          NOT BETWEEN 1 AND 191
     OR p_claim_id IS NULL
     OR p_claim_id !~ '^order_refund_claim_[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_action NOT IN (
       'RETRY_EXISTING_SCOPE',
       'CONFIRMED_PROVIDER_EFFECT',
       'CONFIRMED_NO_PROVIDER_EFFECT'
     )
     OR normalized_reason IS NULL
     OR pg_catalog.char_length(normalized_reason) NOT BETWEEN 10 AND 1000
     OR p_provider_inspected_at_seconds IS NULL
     OR p_provider_inspected_at_seconds < 1
     OR p_provider_disposition NOT IN (
       'ABSENT',
       'USABLE_REFUND',
       'TERMINAL_NO_EFFECT'
     )
     OR p_provider_evidence_sha256 IS NULL
     OR p_provider_evidence_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Order refund reconciliation transition input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  provider_inspected_at :=
    pg_catalog.to_timestamp(p_provider_inspected_at_seconds)
      AT TIME ZONE 'UTC';
  IF provider_inspected_at < source_now - INTERVAL '10 minutes'
     OR provider_inspected_at > source_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'Order refund reconciliation provider evidence is stale'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT actor.*
    INTO source_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR source_actor.role <> 'ADMIN'::public."Role"
     OR source_actor.banned
     OR source_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Order refund reconciliation requires a current ADMIN'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT reconciliation.*
    INTO existing_reconciliation
    FROM public."OrderRefundReconciliation" AS reconciliation
   WHERE reconciliation."claimId" = p_claim_id
     AND reconciliation."claimGeneration" = p_claim_generation
     AND reconciliation.action = p_action
     AND reconciliation."providerEvidenceSha256"
          = p_provider_evidence_sha256;
  IF FOUND THEN
    IF existing_reconciliation."actorUserId" IS DISTINCT FROM source_actor.id
       OR existing_reconciliation.reason IS DISTINCT FROM normalized_reason
       OR existing_reconciliation."providerInspectedAt"
            IS DISTINCT FROM provider_inspected_at
       OR existing_reconciliation."providerDisposition"
            IS DISTINCT FROM p_provider_disposition THEN
      RAISE EXCEPTION 'Order refund reconciliation replay is inconsistent'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'reconciliationId', existing_reconciliation.id,
      'orderId', existing_reconciliation."orderId",
      'claimId', existing_reconciliation."claimId",
      'claimGeneration', existing_reconciliation."claimGeneration",
      'status', existing_reconciliation.action,
      'action', 'replay'
    );
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders."refundClaimId" = p_claim_id
     AND orders."refundClaimGeneration" = p_claim_generation
   FOR UPDATE;
  IF NOT FOUND
     OR locked_order."refundClaimProviderAuthorizedAt" IS NULL
     OR locked_order."sellerRefundId" NOT IN (
       'pending',
       'ambiguous_refund_pending_reconciliation'
     ) THEN
    RAISE EXCEPTION 'Order refund reconciliation claim is not active'
      USING ERRCODE = 'serialization_failure';
  END IF;

  claim_amount :=
      locked_order."itemsSubtotalCents"
    + locked_order."shippingAmountCents"
    + COALESCE(locked_order."giftWrappingPriceCents", 0)
    + locked_order."taxAmountCents";
  IF claim_amount <= 0
     OR p_provider_inspected_at_seconds < pg_catalog.floor(
       EXTRACT(EPOCH FROM (
         locked_order."refundClaimProviderAuthorizedAt" AT TIME ZONE 'UTC'
       ))
     )::bigint
     OR (
       locked_order."refundClaimSource" = 'SELLER'
       AND (
         locked_order."refundClaimSourceGeneration" IS NOT NULL
         OR locked_order."refundClaimIdempotencyScope" IS DISTINCT FROM
           'seller-refund:' || p_claim_id || ':FULL:' || claim_amount::text
       )
     )
     OR (
       locked_order."refundClaimSource" = 'BLOCKED_CHECKOUT'
       AND (
         locked_order."refundClaimSourceGeneration" IS NULL
         OR locked_order."refundClaimSourceGeneration" < 1
         OR locked_order."refundClaimIdempotencyScope" IS DISTINCT FROM
           'blocked-checkout-refund:' || p_claim_id || ':FULL:'
           || claim_amount::text
       )
     )
     OR locked_order."refundClaimSource" NOT IN (
       'SELLER',
       'BLOCKED_CHECKOUT'
     )
     OR EXISTS (
       SELECT 1
         FROM public."OrderPaymentEvent" AS payment_event
        WHERE payment_event."orderId" = locked_order.id
          AND payment_event.metadata->>'refundClaimId' = p_claim_id
     ) THEN
    RAISE EXCEPTION 'Order refund reconciliation claim evidence is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  retry_deadline :=
    locked_order."refundClaimProviderAuthorizedAt" + INTERVAL '23 hours';
  release_not_before :=
    locked_order."refundClaimProviderAuthorizedAt" + INTERVAL '25 hours';

  IF p_action = 'RETRY_EXISTING_SCOPE' THEN
    IF p_provider_disposition <> 'ABSENT'
       OR source_now >= retry_deadline THEN
      RAISE EXCEPTION 'Order refund claim is not eligible for safe retry'
        USING ERRCODE = 'check_violation';
    END IF;
    result_action := 'retry_authorized';
  ELSIF p_action = 'CONFIRMED_PROVIDER_EFFECT' THEN
    IF p_provider_disposition <> 'USABLE_REFUND' THEN
      RAISE EXCEPTION 'Order refund claim has no confirmed provider effect'
        USING ERRCODE = 'check_violation';
    END IF;
    result_action := 'provider_effect_authorized';
  ELSE
    IF p_provider_disposition NOT IN ('ABSENT', 'TERMINAL_NO_EFFECT')
       OR source_now < release_not_before THEN
      RAISE EXCEPTION 'Order refund claim cannot be released as no-effect'
        USING ERRCODE = 'check_violation';
    END IF;
    result_action := 'released_no_provider_effect';
  END IF;

  reconciliation_id :=
    'order-refund-reconcile:' || pg_catalog.gen_random_uuid()::text;
  audit_id :=
    'order-refund-reconcile-audit:' || pg_catalog.gen_random_uuid()::text;

  INSERT INTO public."AdminAuditLog" (
    id,
    "adminId",
    action,
    "targetType",
    "targetId",
    reason,
    metadata,
    undone,
    "createdAt"
  ) VALUES (
    audit_id,
    source_actor.id,
    p_action,
    'ORDER_REFUND_CLAIM',
    p_claim_id,
    normalized_reason,
    pg_catalog.jsonb_build_object(
      'orderId', locked_order.id,
      'claimGeneration', p_claim_generation::text,
      'claimSource', locked_order."refundClaimSource",
      'providerDisposition', p_provider_disposition,
      'providerEvidenceSha256', p_provider_evidence_sha256
    ),
    false,
    source_now
  );

  INSERT INTO public."OrderRefundReconciliation" (
    id,
    "orderId",
    "claimId",
    "claimGeneration",
    "claimSource",
    "claimSourceId",
    "claimSourceGeneration",
    "idempotencyScope",
    action,
    "actorUserId",
    "providerInspectedAt",
    "providerDisposition",
    "providerEvidenceSha256",
    reason,
    "auditLogId",
    "createdAt"
  ) VALUES (
    reconciliation_id,
    locked_order.id,
    p_claim_id,
    p_claim_generation,
    locked_order."refundClaimSource",
    locked_order."refundClaimSourceId",
    locked_order."refundClaimSourceGeneration",
    locked_order."refundClaimIdempotencyScope",
    p_action,
    source_actor.id,
    provider_inspected_at,
    p_provider_disposition,
    p_provider_evidence_sha256,
    normalized_reason,
    audit_id,
    source_now
  );

  IF p_action IN ('RETRY_EXISTING_SCOPE', 'CONFIRMED_PROVIDER_EFFECT') THEN
    UPDATE public."Order" AS orders
       SET "sellerRefundId" = 'pending',
           "sellerRefundLockedAt" = source_now,
           "reviewNeeded" = true,
           "reviewNote" = CASE p_action
             WHEN 'RETRY_EXISTING_SCOPE' THEN
               'An administrator approved one retry with the existing Stripe refund idempotency scope.'
             ELSE
               'An administrator confirmed an existing Stripe refund effect; the exact provider object must be recorded without creating another refund.'
           END
     WHERE orders.id = locked_order.id
       AND orders."refundClaimId" = p_claim_id
       AND orders."refundClaimGeneration" = p_claim_generation
       AND orders."sellerRefundId" IN (
         'pending',
         'ambiguous_refund_pending_reconciliation'
       );
  ELSE
    UPDATE public."Order" AS orders
       SET "sellerRefundId" = NULL,
           "sellerRefundLockedAt" = NULL,
           "refundClaimId" = NULL,
           "refundClaimSource" = NULL,
           "refundClaimSourceId" = NULL,
           "refundClaimSourceGeneration" = NULL,
           "refundClaimIdempotencyScope" = NULL,
           "refundClaimProviderAuthorizedAt" = NULL,
           "reviewNeeded" = true,
           "reviewNote" =
             'An administrator confirmed no effective Stripe refund for the staged claim; the claim was released.'
     WHERE orders.id = locked_order.id
       AND orders."refundClaimId" = p_claim_id
       AND orders."refundClaimGeneration" = p_claim_generation
       AND orders."sellerRefundId" IN (
         'pending',
         'ambiguous_refund_pending_reconciliation'
       );
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order refund reconciliation transition raced'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'reconciliationId', reconciliation_id,
    'orderId', locked_order.id,
    'claimId', p_claim_id,
    'claimGeneration', p_claim_generation,
    'status', p_action,
    'action', result_action
  );
END
$grainline_order_refund_reconcile$;

-- A failed webhook clears processingStartedAt before an administrator can
-- inspect Stripe. Bind the recovery finalizer to the immutable ADMIN
-- reconciliation record instead of pretending that the old webhook lease is
-- still active. The source event, generation and Order remain database-derived.
CREATE FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
  p_reconciliation_id text,
  p_claim_id text,
  p_claim_generation bigint,
  p_refund_id text,
  p_refund_status text,
  p_transfer_reversal_id text,
  p_transfer_reversal_amount_cents integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_blocked_checkout_refund_reconciliation_record$
DECLARE
  source_reconciliation public."OrderRefundReconciliation"%ROWTYPE;
  source_actor public."User"%ROWTYPE;
  locked_event public."StripeWebhookEvent"%ROWTYPE;
  record_result jsonb;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_reconciliation_id IS NULL
     OR p_reconciliation_id !~ '^order-refund-reconcile:[0-9a-f-]{36}$'
     OR p_claim_id IS NULL
     OR p_claim_id !~ '^order_refund_claim_[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1 THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation record input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT reconciliation.*
    INTO source_reconciliation
    FROM public."OrderRefundReconciliation" AS reconciliation
   WHERE reconciliation.id = p_reconciliation_id
     AND reconciliation."claimId" = p_claim_id
     AND reconciliation."claimGeneration" = p_claim_generation
   FOR SHARE;
  IF NOT FOUND
     OR source_reconciliation."claimSource" <> 'BLOCKED_CHECKOUT'
     OR source_reconciliation."claimSourceGeneration" IS NULL
     OR source_reconciliation.action NOT IN (
       'RETRY_EXISTING_SCOPE',
       'CONFIRMED_PROVIDER_EFFECT'
     ) THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation authority is invalid'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT actor.*
    INTO source_actor
    FROM public."User" AS actor
   WHERE actor.id = source_reconciliation."actorUserId"
   FOR SHARE;
  IF NOT FOUND
     OR source_actor.role <> 'ADMIN'::public."Role"
     OR source_actor.banned
     OR source_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation requires a current ADMIN'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT source_event.*
    INTO locked_event
    FROM public."StripeWebhookEvent" AS source_event
   WHERE source_event.id = source_reconciliation."claimSourceId"
   FOR UPDATE;
  IF NOT FOUND
     OR locked_event.type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR locked_event."claimGeneration" IS DISTINCT FROM
          source_reconciliation."claimSourceGeneration"
     OR locked_event."processingStartedAt" IS NOT NULL
     OR locked_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation source event is not recoverable'
      USING ERRCODE = 'serialization_failure';
  END IF;

  record_result := public.grainline_blocked_checkout_refund_record_core(
    source_reconciliation."claimSourceId",
    source_reconciliation."claimSourceGeneration",
    p_claim_id,
    p_claim_generation,
    p_refund_id,
    p_refund_status,
    p_transfer_reversal_id,
    p_transfer_reversal_amount_cents
  );

  UPDATE public."StripeWebhookEvent" AS source_event
     SET "processedAt" = source_now,
         "processingStartedAt" = NULL,
         "lastError" = NULL,
         "updatedAt" = source_now
   WHERE source_event.id = source_reconciliation."claimSourceId"
     AND source_event."claimGeneration"
          = source_reconciliation."claimSourceGeneration"
     AND source_event."processedAt" IS NULL
     AND source_event."processingStartedAt" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation completion raced'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN record_result;
END
$grainline_blocked_checkout_refund_reconciliation_record$;

REVOKE ALL ON FUNCTION
  public.grainline_order_refund_reconciliation_prepare(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_order_refund_claim_mark_ambiguous(text, bigint, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_order_refund_reconcile(
    text,
    text,
    bigint,
    text,
    text,
    bigint,
    text,
    text
  )
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_blocked_checkout_refund_reconciliation_record(
    text,
    text,
    bigint,
    text,
    text,
    text,
    integer
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_refund_reconciliation_prepare(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_refund_claim_mark_ambiguous(text, bigint, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_refund_reconcile(
    text,
    text,
    bigint,
    text,
    text,
    bigint,
    text,
    text
  )
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_blocked_checkout_refund_reconciliation_record(
    text,
    text,
    bigint,
    text,
    text,
    text,
    integer
  )
  TO grainline_app_runtime;

COMMENT ON TABLE public."OrderRefundReconciliation" IS
  'Private immutable evidence for generation-fenced Order refund reconciliation.';
COMMENT ON FUNCTION
  public.grainline_order_refund_reconciliation_prepare(text, text) IS
  'Returns one ADMIN-authorized active Order refund claim for bounded provider inspection.';
COMMENT ON FUNCTION
  public.grainline_order_refund_claim_mark_ambiguous(text, bigint, text) IS
  'Moves one exact active Order refund claim to the closed reconciliation sentinel.';
COMMENT ON FUNCTION
  public.grainline_order_refund_reconcile(
    text,
    text,
    bigint,
    text,
    text,
    bigint,
    text,
    text
  ) IS
  'Transitions one exact ambiguous Order refund claim using fresh provider-inspection evidence.';
COMMENT ON FUNCTION
  public.grainline_blocked_checkout_refund_reconciliation_record(
    text,
    text,
    bigint,
    text,
    text,
    text,
    integer
  ) IS
  'Finalizes one failed-lease blocked-checkout refund only through its exact immutable ADMIN reconciliation record.';

DO $grainline_order_refund_reconciliation_postflight$
DECLARE
  runtime_table_acl boolean;
  runtime_function_count integer;
BEGIN
  SELECT pg_catalog.has_table_privilege(
    'grainline_app_runtime',
    'public."OrderRefundReconciliation"',
    'SELECT,INSERT,UPDATE,DELETE'
  ) INTO runtime_table_acl;
  IF runtime_table_acl THEN
    RAISE EXCEPTION 'Runtime retained Order refund reconciliation table authority';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO runtime_function_count
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
   WHERE namespace.nspname = 'public'
     AND routine.proname IN (
       'grainline_order_refund_reconciliation_prepare',
       'grainline_order_refund_claim_mark_ambiguous',
       'grainline_order_refund_reconcile',
       'grainline_blocked_checkout_refund_reconciliation_record'
     )
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       routine.oid,
       'EXECUTE'
     );
  IF runtime_function_count <> 4 THEN
    RAISE EXCEPTION 'Order refund reconciliation function ACL drifted';
  END IF;
END
$grainline_order_refund_reconciliation_postflight$;

COMMIT;
