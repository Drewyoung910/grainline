-- DRAFT ONLY: refund input validation; not a staged migration or production operator.
-- Preserve all legitimate branches, signatures, ACLs and table posture.
-- Release packaging must bind the exact database, role, migration ledger and catalog.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $refund_input_before$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_order_refund_claim_mark_ambiguous(text,bigint,text)')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND CURRENT_USER <> 'grainline_app_runtime'
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = '0378491226cccdaa0edb0ccd8d573093'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE') = true
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION 'refund input before authority drifted: grainline_order_refund_claim_mark_ambiguous';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND CURRENT_USER <> 'grainline_app_runtime'
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = '8f71265e548591a89822e303f3e38edc'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE') = true
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION 'refund input before authority drifted: grainline_order_refund_reconcile';
  END IF;
END
$refund_input_before$;

CREATE OR REPLACE FUNCTION public.grainline_order_refund_claim_mark_ambiguous(
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
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
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

CREATE OR REPLACE FUNCTION public.grainline_order_refund_reconcile(
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
     OR p_action IS NULL OR p_action NOT IN (
       'RETRY_EXISTING_SCOPE',
       'CONFIRMED_PROVIDER_EFFECT',
       'CONFIRMED_NO_PROVIDER_EFFECT'
     )
     OR normalized_reason IS NULL
     OR pg_catalog.char_length(normalized_reason) NOT BETWEEN 10 AND 1000
     OR p_provider_inspected_at_seconds IS NULL
     OR p_provider_inspected_at_seconds < 1
     OR p_provider_disposition IS NULL OR p_provider_disposition NOT IN (
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

DO $refund_input_after$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_order_refund_claim_mark_ambiguous(text,bigint,text)')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND CURRENT_USER <> 'grainline_app_runtime'
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = 'c21190d9072a3c46e803deea846369ff'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE') = true
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION 'refund input after authority drifted: grainline_order_refund_claim_mark_ambiguous';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND CURRENT_USER <> 'grainline_app_runtime'
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = 'b8e7a8fdaed9a7adbe091589876ddca8'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE') = true
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION 'refund input after authority drifted: grainline_order_refund_reconcile';
  END IF;
END
$refund_input_after$;

COMMIT;
