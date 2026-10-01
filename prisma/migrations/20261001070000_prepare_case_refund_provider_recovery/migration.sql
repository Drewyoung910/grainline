-- Add evidence-bound, cross-admin recovery for an exact staged Case
-- refund. The original resolver remains the attributed actor; the recovering
-- ADMIN is persisted and audited separately. Runtime receives only five exact
-- functions and no direct access to the private claim ledger.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.case.refund-provider-recovery.prepare',
    0
  )
);

DO $grainline_case_refund_provider_recovery_preflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (
        VALUES
          ('public.grainline_case_staff_resolution_provider_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)',
           '721ab18d24daa5e9c65f77a33c132dc9f5ad5096d366f5fadb5758d301c74af5', true, true),
          ('public.grainline_case_staff_resolution_finalize(text,text)',
           '7b7ff76969a059f6bd4a947a790dc3482d6c1aaabfb14eaf3bafc953b51782c8', true, true),
          ('public.grainline_case_resolution_claim_immutable()',
           '9406e1a0df5e860711603f4882622d5c4d95cc1274dfd74ed9a8d48f8038a0a8', false, false)
      ) AS expected_functions(
        identity, source_sha256, runtime_execute, security_definer
      )
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Case recovery predecessor function % is missing',
        expected.identity;
    END IF;
    SELECT pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(routine.prosrc, 'UTF8')
             ),
             'hex'
           )
      INTO actual_hash
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = function_oid
       AND routine.prosecdef = expected.security_definer
       AND routine.provolatile = 'v'
       AND routine.proparallel = 'u'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];
    IF actual_hash IS DISTINCT FROM expected.source_sha256
       OR pg_catalog.has_function_privilege(
            'grainline_app_runtime', function_oid, 'EXECUTE'
          ) IS DISTINCT FROM expected.runtime_execute
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
      RAISE EXCEPTION 'Case recovery predecessor function % drifted',
        expected.identity;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
             'public."CaseResolutionClaim"'::pg_catalog.regclass
       AND attribute.attname IN (
         'providerRecoveryActorId',
         'providerRecoveryAction',
         'providerRecoveryEvidenceSha256',
         'providerRecoveryInspectedAt',
         'providerRecoveryAuthorizedAt',
         'providerRecoveryRecordedAt',
         'providerRecoveryFinalizedAt'
       )
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Case refund provider-recovery columns already exist';
  END IF;
END
$grainline_case_refund_provider_recovery_preflight$;

ALTER TABLE public."CaseResolutionClaim"
  ADD COLUMN "providerRecoveryActorId" TEXT,
  ADD COLUMN "providerRecoveryAction" VARCHAR(32),
  ADD COLUMN "providerRecoveryEvidenceSha256" VARCHAR(64),
  ADD COLUMN "providerRecoveryInspectedAt" TIMESTAMP(3),
  ADD COLUMN "providerRecoveryAuthorizedAt" TIMESTAMP(3),
  ADD COLUMN "providerRecoveryRecordedAt" TIMESTAMP(3),
  ADD COLUMN "providerRecoveryFinalizedAt" TIMESTAMP(3),
  ADD CONSTRAINT "CaseResolutionClaim_providerRecoveryActorId_fkey"
    FOREIGN KEY ("providerRecoveryActorId") REFERENCES public."User"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CaseResolutionClaim_providerRecovery_shape_check"
    CHECK (
      (
        "providerRecoveryActorId" IS NULL
        AND "providerRecoveryAction" IS NULL
        AND "providerRecoveryEvidenceSha256" IS NULL
        AND "providerRecoveryInspectedAt" IS NULL
        AND "providerRecoveryAuthorizedAt" IS NULL
        AND "providerRecoveryRecordedAt" IS NULL
        AND "providerRecoveryFinalizedAt" IS NULL
      )
      OR
      (
        "providerRecoveryActorId" IS NOT NULL
        AND pg_catalog.btrim("providerRecoveryActorId") <> ''
        AND pg_catalog.char_length("providerRecoveryActorId") <= 191
        AND "providerRecoveryAction" IN (
          'RETRY_EXISTING_SCOPE',
          'RECORD_DISCOVERED_EFFECT'
        )
        AND "providerRecoveryEvidenceSha256" ~ '^[0-9a-f]{64}$'
        AND "providerRecoveryInspectedAt" IS NOT NULL
        AND "providerRecoveryAuthorizedAt" IS NOT NULL
        AND "providerRecoveryInspectedAt" >=
              "createdAt" - INTERVAL '5 minutes'
        AND "providerRecoveryInspectedAt" <=
              "providerRecoveryAuthorizedAt" + INTERVAL '5 minutes'
        AND "providerRecoveryAuthorizedAt" >= "createdAt"
        AND (
          "providerRecoveryRecordedAt" IS NULL
          OR "providerRecoveryRecordedAt" >=
               "providerRecoveryAuthorizedAt"
        )
        AND (
          "providerRecoveryFinalizedAt" IS NULL
          OR (
            "providerRecoveryRecordedAt" IS NOT NULL
            AND "providerRecoveryFinalizedAt" >=
                  "providerRecoveryRecordedAt"
          )
        )
      )
    ) NOT VALID;

ALTER TABLE public."CaseResolutionClaim"
  VALIDATE CONSTRAINT "CaseResolutionClaim_providerRecovery_shape_check";

CREATE INDEX "CaseResolutionClaim_providerRecoveryActorId_status_idx"
  ON public."CaseResolutionClaim" (
    "providerRecoveryActorId", status, "providerRecoveryAuthorizedAt"
  )
  WHERE "providerRecoveryActorId" IS NOT NULL
    AND "providerRecoveryFinalizedAt" IS NULL;

CREATE OR REPLACE FUNCTION
  public.grainline_case_resolution_claim_immutable()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SET search_path = pg_catalog
AS $grainline_case_resolution_claim_immutable$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW."caseId" IS DISTINCT FROM OLD."caseId"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."staffActorId" IS DISTINCT FROM OLD."staffActorId"
     OR NEW.resolution IS DISTINCT FROM OLD.resolution
     OR NEW."refundAmountCents" IS DISTINCT FROM OLD."refundAmountCents"
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW."stockRestorePlan" IS DISTINCT FROM OLD."stockRestorePlan"
     OR NEW."idempotencyScope" IS DISTINCT FROM OLD."idempotencyScope"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'CaseResolutionClaim authority fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."providerRecoveryActorId" IS NOT NULL
     AND (
       NEW."providerRecoveryActorId"
         IS DISTINCT FROM OLD."providerRecoveryActorId"
       OR NEW."providerRecoveryAction"
         IS DISTINCT FROM OLD."providerRecoveryAction"
       OR NEW."providerRecoveryEvidenceSha256"
         IS DISTINCT FROM OLD."providerRecoveryEvidenceSha256"
       OR NEW."providerRecoveryInspectedAt"
         IS DISTINCT FROM OLD."providerRecoveryInspectedAt"
       OR NEW."providerRecoveryAuthorizedAt"
         IS DISTINCT FROM OLD."providerRecoveryAuthorizedAt"
     ) THEN
    RAISE EXCEPTION 'CaseResolutionClaim recovery authority is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."providerRecoveryRecordedAt" IS NOT NULL
     AND NEW."providerRecoveryRecordedAt"
       IS DISTINCT FROM OLD."providerRecoveryRecordedAt" THEN
    RAISE EXCEPTION 'CaseResolutionClaim recovery record is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."providerRecoveryFinalizedAt" IS NOT NULL
     AND NEW."providerRecoveryFinalizedAt"
       IS DISTINCT FROM OLD."providerRecoveryFinalizedAt" THEN
    RAISE EXCEPTION 'CaseResolutionClaim recovery finalization is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF (
       OLD."orderPaymentEventId" IS NOT NULL
       AND NEW."orderPaymentEventId"
         IS DISTINCT FROM OLD."orderPaymentEventId"
     )
     OR (
       OLD."providerRecordedAt" IS NOT NULL
       AND NEW."providerRecordedAt"
         IS DISTINCT FROM OLD."providerRecordedAt"
     ) THEN
    RAISE EXCEPTION 'CaseResolutionClaim provider evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN (
       'FINALIZED'::public."CaseResolutionClaimStatus",
       'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
     ) THEN
    RAISE EXCEPTION 'Terminal CaseResolutionClaim is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (
      OLD.status = 'LOCAL_READY'::public."CaseResolutionClaimStatus"
      AND NEW.status = 'FINALIZED'::public."CaseResolutionClaimStatus"
    )
    OR
    (
      OLD.status = 'PROVIDER_PENDING'::public."CaseResolutionClaimStatus"
      AND NEW.status IN (
        'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus",
        'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus",
        'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
      )
    )
    OR
    (
      OLD.status =
        'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
      AND NEW.status IN (
        'FINALIZED'::public."CaseResolutionClaimStatus",
        'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
      )
    )
    OR
    (
      OLD.status =
        'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
      AND NEW.status IN (
        'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
        'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus",
        'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
      )
    )
    OR
    (
      OLD.status = NEW.status
      AND OLD."providerRecoveryActorId" IS NULL
      AND NEW."providerRecoveryActorId" IS NOT NULL
      AND NEW."providerRecoveryAction" IS NOT NULL
      AND NEW."providerRecoveryEvidenceSha256" IS NOT NULL
      AND NEW."providerRecoveryInspectedAt" IS NOT NULL
      AND NEW."providerRecoveryAuthorizedAt" IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'Invalid CaseResolutionClaim status transition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$grainline_case_resolution_claim_immutable$;

CREATE OR REPLACE FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_load(
    p_actor_user_id text,
    p_case_id text,
    p_resolution public."CaseResolution",
    p_partial_refund_amount_cents integer
  )
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_staff_resolution_provider_recovery_load$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  locked_claim record;
  recovery_action text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_case_id IS NULL
     OR pg_catalog.btrim(p_case_id) = ''
     OR pg_catalog.char_length(p_case_id) > 191
     OR p_resolution NOT IN (
       'REFUND_FULL'::public."CaseResolution",
       'REFUND_PARTIAL'::public."CaseResolution"
     )
     OR (
       p_resolution = 'REFUND_FULL'::public."CaseResolution"
       AND p_partial_refund_amount_cents IS NOT NULL
     )
     OR (
       p_resolution = 'REFUND_PARTIAL'::public."CaseResolution"
       AND (
         p_partial_refund_amount_cents IS NULL
         OR p_partial_refund_amount_cents <= 0
       )
     ) THEN
    RAISE EXCEPTION 'Case provider-recovery load input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.id, actor.role, actor.banned, actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL
     OR locked_actor.role NOT IN (
       'EMPLOYEE'::public."Role",
       'ADMIN'::public."Role"
     ) THEN
    RAISE EXCEPTION 'Case provider-recovery actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT case_row."orderId"
    INTO source_order_id
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-recovery Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."caseResolutionClaimId",
    orders.currency,
    orders."itemsSubtotalCents",
    orders."shippingAmountCents",
    orders."giftWrappingPriceCents",
    orders."taxAmountCents",
    orders."stripePaymentIntentId",
    orders."stripeTransferId",
    orders."sellerRefundId",
    orders."sellerRefundLockedAt",
    orders."labelStatus",
    orders."labelClaimStatus",
    orders."paymentOpenDisputeBlocked"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-recovery Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row."resolvedAt"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_case.id IS DISTINCT FROM p_case_id
     OR locked_case.status IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     OR locked_case."resolvedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case provider-recovery Case is not active'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    claim.id,
    claim."caseId",
    claim."orderId",
    claim."staffActorId",
    claim.resolution,
    claim."refundAmountCents",
    claim.currency,
    claim."stockRestorePlan",
    claim.status,
    claim."idempotencyScope",
    claim."orderPaymentEventId",
    claim."providerRecoveryActorId",
    claim."providerRecoveryAuthorizedAt",
    claim."providerRecoveryRecordedAt",
    claim."providerRecoveryFinalizedAt"
    INTO locked_claim
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = locked_order."caseResolutionClaimId"
     AND claim."caseId" = locked_case.id
     AND claim."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_claim.resolution IS DISTINCT FROM p_resolution
     OR (
       p_resolution = 'REFUND_PARTIAL'::public."CaseResolution"
       AND locked_claim."refundAmountCents"
             IS DISTINCT FROM p_partial_refund_amount_cents
     )
     OR locked_claim."refundAmountCents" IS NULL
     OR locked_claim."idempotencyScope" IS NULL
     OR locked_order."stripePaymentIntentId" IS NULL
     OR pg_catalog.btrim(locked_order."stripePaymentIntentId") = '' THEN
    RAISE EXCEPTION 'Case provider-recovery claim identity is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF locked_claim."providerRecoveryActorId" IS NOT NULL THEN
    IF locked_claim."providerRecoveryActorId" IS DISTINCT FROM locked_actor.id
       OR locked_claim."providerRecoveryAuthorizedAt" IS NULL
       OR locked_claim."providerRecoveryFinalizedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Case provider-recovery claim is already delegated'
        USING ERRCODE = '42501';
    END IF;
    recovery_action := 'recovered';
  ELSIF locked_claim."staffActorId" = locked_actor.id THEN
    recovery_action := 'replay';
  ELSIF locked_actor.role = 'ADMIN'::public."Role" THEN
    recovery_action := 'recovery_required';
  ELSE
    RAISE EXCEPTION 'Case provider-recovery requires the original actor or an ADMIN'
      USING ERRCODE = '42501';
  END IF;

  IF locked_claim.status =
       'PROVIDER_PENDING'::public."CaseResolutionClaimStatus" THEN
    IF locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
       OR locked_order."sellerRefundLockedAt" IS NULL
       OR locked_claim."orderPaymentEventId" IS NOT NULL
       OR locked_order."labelStatus" = 'PURCHASED'::public."LabelStatus"
       OR locked_order."labelClaimStatus" IN (
         'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
       )
       OR locked_order."paymentOpenDisputeBlocked" THEN
      RAISE EXCEPTION 'Case provider-recovery pending evidence is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF locked_claim.status =
          'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus" THEN
    IF locked_order."sellerRefundId" IS DISTINCT FROM
         'ambiguous_refund_pending_reconciliation'
       OR locked_order."sellerRefundLockedAt" IS NOT NULL
       OR locked_claim."orderPaymentEventId" IS NOT NULL THEN
      RAISE EXCEPTION 'Case provider-recovery reconciliation evidence is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF locked_claim.status =
          'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus" THEN
    IF locked_order."sellerRefundId" IS NULL
       OR locked_order."sellerRefundId" = 'pending'
       OR locked_order."sellerRefundLockedAt" IS NOT NULL
       OR locked_claim."orderPaymentEventId" IS NULL THEN
      RAISE EXCEPTION 'Case provider-recovery recorded evidence is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Case provider-recovery status is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'claimId', locked_claim.id,
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'resolution', locked_claim.resolution::text,
    'refundAmountCents', locked_claim."refundAmountCents",
    'currency', locked_claim.currency,
    'stockRestorePlan', locked_claim."stockRestorePlan",
    'status', locked_claim.status::text,
    'idempotencyScope', locked_claim."idempotencyScope",
    'paymentIntentId', locked_order."stripePaymentIntentId",
    'itemsSubtotalCents', locked_order."itemsSubtotalCents",
    'shippingAmountCents', locked_order."shippingAmountCents",
    'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
    'taxAmountCents', locked_order."taxAmountCents",
    'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
    'action', recovery_action,
    'providerRecoveryAction', locked_claim."providerRecoveryAction"
  );
END
$grainline_case_staff_resolution_provider_recovery_load$;

CREATE OR REPLACE FUNCTION
  public.grainline_case_staff_resolution_provider_clock(
    p_actor_user_id text,
    p_resolution_claim_id text,
    p_case_id text,
    p_order_id text,
    p_idempotency_scope text
  )
RETURNS TABLE (provider_authorized_at timestamp(3))
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_staff_resolution_provider_clock$
DECLARE
  locked_actor record;
  source_claim record;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_resolution_claim_id IS NULL
     OR pg_catalog.btrim(p_resolution_claim_id) = ''
     OR pg_catalog.char_length(p_resolution_claim_id) > 191
     OR p_case_id IS NULL
     OR pg_catalog.btrim(p_case_id) = ''
     OR pg_catalog.char_length(p_case_id) > 191
     OR p_order_id IS NULL
     OR pg_catalog.btrim(p_order_id) = ''
     OR pg_catalog.char_length(p_order_id) > 191
     OR p_idempotency_scope IS NULL
     OR pg_catalog.btrim(p_idempotency_scope) = ''
     OR pg_catalog.char_length(p_idempotency_scope) > 191 THEN
    RAISE EXCEPTION 'Case provider clock input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.id, actor.role, actor.banned, actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL
     OR locked_actor.role NOT IN (
       'EMPLOYEE'::public."Role",
       'ADMIN'::public."Role"
     ) THEN
    RAISE EXCEPTION 'Case provider clock actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    claim."staffActorId",
    claim."providerRecoveryActorId",
    claim."createdAt"
    INTO source_claim
    FROM public."CaseResolutionClaim" AS claim
    JOIN public."Order" AS orders
      ON orders.id = claim."orderId"
     AND orders."caseResolutionClaimId" = claim.id
    JOIN public."Case" AS case_row
      ON case_row.id = claim."caseId"
     AND case_row."orderId" = claim."orderId"
   WHERE claim.id = p_resolution_claim_id
     AND claim."caseId" = p_case_id
     AND claim."orderId" = p_order_id
     AND claim."idempotencyScope" = p_idempotency_scope
     AND claim.status IN (
       'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
       'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus",
       'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
     )
     AND case_row.status NOT IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     AND case_row."resolvedAt" IS NULL;
  IF NOT FOUND
     OR (
       source_claim."providerRecoveryActorId" IS NOT NULL
       AND source_claim."providerRecoveryActorId"
             IS DISTINCT FROM locked_actor.id
     )
     OR (
       source_claim."providerRecoveryActorId" IS NULL
       AND source_claim."staffActorId" IS DISTINCT FROM locked_actor.id
       AND locked_actor.role <> 'ADMIN'::public."Role"
     ) THEN
    RAISE EXCEPTION 'Case provider clock authority is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT source_claim."createdAt";
END
$grainline_case_staff_resolution_provider_clock$;

CREATE OR REPLACE FUNCTION
  public.grainline_case_staff_resolution_provider_recover(
    p_actor_user_id text,
    p_resolution_claim_id text,
    p_recovery_action text,
    p_provider_inspected_at_seconds bigint,
    p_provider_evidence_sha256 text
  )
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_staff_resolution_provider_recover$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  locked_claim record;
  transition_at timestamp(3);
  inspected_at timestamp(3);
  audit_id text;
  recovery_record_audit_id text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_resolution_claim_id IS NULL
     OR pg_catalog.btrim(p_resolution_claim_id) = ''
     OR pg_catalog.char_length(p_resolution_claim_id) > 191
     OR p_recovery_action NOT IN (
       'RETRY_EXISTING_SCOPE',
       'RECORD_DISCOVERED_EFFECT'
     )
     OR p_provider_inspected_at_seconds IS NULL
     OR p_provider_inspected_at_seconds < 1
     OR p_provider_evidence_sha256 IS NULL
     OR p_provider_evidence_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Case provider-recovery input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.id, actor.role, actor.banned, actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL
     OR locked_actor.role <> 'ADMIN'::public."Role" THEN
    RAISE EXCEPTION 'Case provider recovery requires a current ADMIN'
      USING ERRCODE = '42501';
  END IF;

  SELECT claim."orderId"
    INTO source_order_id
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-recovery claim does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."caseResolutionClaimId",
    orders."itemsSubtotalCents",
    orders."shippingAmountCents",
    orders."giftWrappingPriceCents",
    orders."taxAmountCents",
    orders."stripePaymentIntentId",
    orders."stripeTransferId",
    orders."sellerRefundId",
    orders."sellerRefundLockedAt",
    orders."labelStatus",
    orders."labelClaimStatus",
    orders."paymentOpenDisputeBlocked"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-recovery Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row."resolvedAt"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_case.status IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     OR locked_case."resolvedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case provider-recovery Case is not active'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    claim.id,
    claim."caseId",
    claim."orderId",
    claim."staffActorId",
    claim.resolution,
    claim."refundAmountCents",
    claim.currency,
    claim."stockRestorePlan",
    claim.status,
    claim."idempotencyScope",
    claim."orderPaymentEventId",
    claim."providerRecordedAt",
    claim."createdAt",
    claim."providerRecoveryActorId",
    claim."providerRecoveryAction",
    claim."providerRecoveryEvidenceSha256",
    claim."providerRecoveryInspectedAt",
    claim."providerRecoveryAuthorizedAt",
    claim."providerRecoveryRecordedAt",
    claim."providerRecoveryFinalizedAt"
    INTO locked_claim
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id
     AND claim."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_claim."caseId" IS DISTINCT FROM locked_case.id
     OR locked_order."caseResolutionClaimId"
          IS DISTINCT FROM locked_claim.id
     OR locked_claim.resolution NOT IN (
       'REFUND_FULL'::public."CaseResolution",
       'REFUND_PARTIAL'::public."CaseResolution"
     )
     OR locked_claim."refundAmountCents" IS NULL
     OR locked_claim."idempotencyScope" IS NULL
     OR locked_order."stripePaymentIntentId" IS NULL
     OR pg_catalog.btrim(locked_order."stripePaymentIntentId") = ''
     OR locked_claim."providerRecoveryFinalizedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case provider-recovery claim authority is invalid'
      USING ERRCODE = '23514';
  END IF;

  inspected_at := pg_catalog.timezone(
    'UTC',
    pg_catalog.to_timestamp(p_provider_inspected_at_seconds)
  );
  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
  IF inspected_at < locked_claim."createdAt" - INTERVAL '5 minutes'
     OR inspected_at > transition_at + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'Case provider-recovery evidence clock is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF locked_claim."providerRecoveryActorId" IS NOT NULL THEN
    IF locked_claim."providerRecoveryActorId" = locked_actor.id
       AND locked_claim."providerRecoveryAction" = p_recovery_action
       AND locked_claim."providerRecoveryEvidenceSha256" =
             p_provider_evidence_sha256
       AND locked_claim."providerRecoveryInspectedAt" = inspected_at THEN
      RETURN pg_catalog.jsonb_build_object(
        'claimId', locked_claim.id,
        'caseId', locked_case.id,
        'orderId', locked_order.id,
        'buyerUserId', locked_case."buyerId",
        'sellerUserId', locked_case."sellerId",
        'resolution', locked_claim.resolution::text,
        'refundAmountCents', locked_claim."refundAmountCents",
        'currency', locked_claim.currency,
        'stockRestorePlan', locked_claim."stockRestorePlan",
        'status', locked_claim.status::text,
        'idempotencyScope', locked_claim."idempotencyScope",
        'paymentIntentId', locked_order."stripePaymentIntentId",
        'itemsSubtotalCents', locked_order."itemsSubtotalCents",
        'shippingAmountCents', locked_order."shippingAmountCents",
        'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
        'taxAmountCents', locked_order."taxAmountCents",
        'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
        'action', 'recovered',
        'providerRecoveryAction', locked_claim."providerRecoveryAction"
      );
    END IF;
    RAISE EXCEPTION 'Case provider recovery is already delegated'
      USING ERRCODE = '42501';
  END IF;

  IF p_recovery_action = 'RETRY_EXISTING_SCOPE' THEN
    IF locked_claim.status NOT IN (
         'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
         'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
       )
       OR (
         locked_claim.status =
           'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
         AND (
           locked_order."sellerRefundId" <>
             'ambiguous_refund_pending_reconciliation'
           OR locked_order."sellerRefundLockedAt" IS NOT NULL
         )
       )
       OR (
         locked_claim.status =
           'PROVIDER_PENDING'::public."CaseResolutionClaimStatus"
         AND (
           locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
           OR locked_order."sellerRefundLockedAt" IS NULL
         )
       )
       OR locked_claim."orderPaymentEventId" IS NOT NULL
       OR transition_at - locked_claim."createdAt" >= INTERVAL '23 hours'
       OR locked_order."labelStatus" = 'PURCHASED'::public."LabelStatus"
       OR locked_order."labelClaimStatus" IN (
         'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
       )
       OR locked_order."paymentOpenDisputeBlocked" THEN
      RAISE EXCEPTION 'Case provider recovery is not safely retryable'
        USING ERRCODE = '23514';
    END IF;

    IF locked_claim.status =
         'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus" THEN
      UPDATE public."Order" AS orders
         SET "sellerRefundId" = 'pending',
             "sellerRefundLockedAt" = transition_at,
             "reviewNeeded" = true,
             "reviewNote" =
               'Stripe inspection found no Case refund; an administrator '
               || 'authorized the existing idempotency scope for retry.'
       WHERE orders.id = locked_order.id
         AND orders."caseResolutionClaimId" = locked_claim.id
         AND orders."sellerRefundId" =
               'ambiguous_refund_pending_reconciliation';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Case provider-recovery retry lease was lost'
          USING ERRCODE = '40001';
      END IF;
    END IF;

    UPDATE public."CaseResolutionClaim" AS claim
       SET status = 'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
           "providerRecoveryActorId" = locked_actor.id,
           "providerRecoveryAction" = p_recovery_action,
           "providerRecoveryEvidenceSha256" = p_provider_evidence_sha256,
           "providerRecoveryInspectedAt" = inspected_at,
           "providerRecoveryAuthorizedAt" = transition_at,
           "updatedAt" = transition_at
     WHERE claim.id = locked_claim.id
       AND claim.status = locked_claim.status
       AND claim."providerRecoveryActorId" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case provider-recovery retry transition failed'
        USING ERRCODE = '40001';
    END IF;
    locked_claim.status :=
      'PROVIDER_PENDING'::public."CaseResolutionClaimStatus";
  ELSE
    IF locked_claim.status =
         'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus" THEN
      IF locked_order."sellerRefundId" <>
           'ambiguous_refund_pending_reconciliation'
         OR locked_order."sellerRefundLockedAt" IS NOT NULL
         OR locked_claim."orderPaymentEventId" IS NOT NULL THEN
        RAISE EXCEPTION 'Case discovered-effect state is invalid'
          USING ERRCODE = '23514';
      END IF;
      UPDATE public."Order" AS orders
         SET "sellerRefundId" = 'pending',
             "sellerRefundLockedAt" = transition_at,
             "reviewNeeded" = true,
             "reviewNote" =
               'Stripe inspection found the exact Case refund; provider '
               || 'evidence is being recorded.'
       WHERE orders.id = locked_order.id
         AND orders."caseResolutionClaimId" = locked_claim.id
         AND orders."sellerRefundId" =
               'ambiguous_refund_pending_reconciliation';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Case discovered-effect lease was lost'
          USING ERRCODE = '40001';
      END IF;
      locked_claim.status :=
        'PROVIDER_PENDING'::public."CaseResolutionClaimStatus";
    ELSIF locked_claim.status =
            'PROVIDER_PENDING'::public."CaseResolutionClaimStatus" THEN
      IF locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
         OR locked_order."sellerRefundLockedAt" IS NULL
         OR locked_claim."orderPaymentEventId" IS NOT NULL THEN
        RAISE EXCEPTION 'Case pending discovered-effect state is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSIF locked_claim.status =
            'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus" THEN
      IF locked_order."sellerRefundId" IS NULL
         OR locked_order."sellerRefundId" = 'pending'
         OR locked_order."sellerRefundLockedAt" IS NOT NULL
         OR locked_claim."orderPaymentEventId" IS NULL
         OR locked_claim."providerRecordedAt" IS NULL THEN
        RAISE EXCEPTION 'Case recorded discovered-effect state is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Case discovered-effect status is invalid'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public."CaseResolutionClaim" AS claim
       SET status = locked_claim.status,
           "providerRecoveryActorId" = locked_actor.id,
           "providerRecoveryAction" = p_recovery_action,
           "providerRecoveryEvidenceSha256" = p_provider_evidence_sha256,
           "providerRecoveryInspectedAt" = inspected_at,
           "providerRecoveryAuthorizedAt" = transition_at,
           "providerRecoveryRecordedAt" = CASE
             WHEN locked_claim.status =
                    'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
               THEN transition_at
             ELSE NULL
           END,
           "updatedAt" = transition_at
     WHERE claim.id = locked_claim.id
       AND claim."providerRecoveryActorId" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case discovered-effect authorization failed'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  audit_id :=
    'case-resolution-provider-recovery-authorize-audit:'
    || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason,
    metadata, undone, "createdAt"
  )
  VALUES (
    audit_id,
    locked_actor.id,
    'AUTHORIZE_CASE_RESOLUTION_PROVIDER_RECOVERY',
    'CASE_RESOLUTION_CLAIM',
    locked_claim.id,
    p_recovery_action,
    pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'originalStaffActorId', locked_claim."staffActorId",
      'providerEvidenceSha256', p_provider_evidence_sha256,
      'providerInspectedAt', inspected_at
    ),
    false,
    transition_at
  );

  IF locked_claim.status =
       'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus" THEN
    recovery_record_audit_id :=
      'case-resolution-provider-recovery-record-audit:'
      || pg_catalog.gen_random_uuid()::text;
    INSERT INTO public."AdminAuditLog" (
      id, "adminId", action, "targetType", "targetId", reason,
      metadata, undone, "createdAt"
    )
    VALUES (
      recovery_record_audit_id,
      locked_actor.id,
      'RECOVER_CASE_RESOLUTION_PROVIDER_RECORD',
      'CASE_RESOLUTION_CLAIM',
      locked_claim.id,
      p_recovery_action,
      pg_catalog.jsonb_build_object(
        'caseId', locked_case.id,
        'orderId', locked_order.id,
        'originalStaffActorId', locked_claim."staffActorId",
        'providerEvidenceSha256', p_provider_evidence_sha256,
        'providerInspectedAt', inspected_at,
        'stripeRefundId', locked_order."sellerRefundId"
      ),
      false,
      transition_at
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'claimId', locked_claim.id,
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'resolution', locked_claim.resolution::text,
    'refundAmountCents', locked_claim."refundAmountCents",
    'currency', locked_claim.currency,
    'stockRestorePlan', locked_claim."stockRestorePlan",
    'status', locked_claim.status::text,
    'idempotencyScope', locked_claim."idempotencyScope",
    'paymentIntentId', locked_order."stripePaymentIntentId",
    'itemsSubtotalCents', locked_order."itemsSubtotalCents",
    'shippingAmountCents', locked_order."shippingAmountCents",
    'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
    'taxAmountCents', locked_order."taxAmountCents",
    'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
    'action', 'recovered',
    'providerRecoveryAction', p_recovery_action
  );
END
$grainline_case_staff_resolution_provider_recover$;

CREATE OR REPLACE FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_record(
    p_actor_user_id text,
    p_resolution_claim_id text,
    p_provider_outcome text,
    p_primary_refund_id text,
    p_refund_ids text[],
    p_refund_statuses text[],
    p_transfer_reversal_id text,
    p_transfer_reversal_amount_cents integer,
    p_requires_manual_transfer_reconciliation boolean,
    p_requires_manual_follow_up boolean
  )
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_staff_resolution_provider_recovery_record$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  locked_claim record;
  existing_event record;
  recovery_audit_id text;
  primary_status text;
  payment_event_id text;
  transition_at timestamp(3);
  audit_id text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_resolution_claim_id IS NULL
     OR pg_catalog.btrim(p_resolution_claim_id) = ''
     OR pg_catalog.char_length(p_resolution_claim_id) > 191
     OR p_provider_outcome IS DISTINCT FROM 'RECORDED' THEN
    RAISE EXCEPTION 'Case provider-record input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_outcome = 'AMBIGUOUS'
     AND (
       p_primary_refund_id IS NOT NULL
       OR COALESCE(pg_catalog.cardinality(p_refund_ids), 0) <> 0
       OR COALESCE(pg_catalog.cardinality(p_refund_statuses), 0) <> 0
       OR p_transfer_reversal_id IS NOT NULL
       OR p_transfer_reversal_amount_cents IS NOT NULL
       OR COALESCE(p_requires_manual_transfer_reconciliation, false)
       OR COALESCE(p_requires_manual_follow_up, false)
     ) THEN
    RAISE EXCEPTION 'Ambiguous provider outcome cannot assert evidence'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.id,
    actor.role,
    actor.banned,
    actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL
     OR locked_actor.role <> 'ADMIN'::public."Role" THEN
    RAISE EXCEPTION 'Case provider-record actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT claim."orderId"
    INTO source_order_id
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution claim does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."caseResolutionClaimId",
    orders."sellerRefundId",
    orders."sellerRefundLockedAt"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-record Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row."resolvedAt"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-record Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    claim.id,
    claim."caseId",
    claim."orderId",
    claim."staffActorId",
    claim.resolution,
    claim."refundAmountCents",
    claim.currency,
    claim.status,
    claim."idempotencyScope",
    claim."orderPaymentEventId",
    claim."providerRecoveryActorId",
    claim."providerRecoveryAction",
    claim."providerRecoveryEvidenceSha256",
    claim."providerRecoveryInspectedAt",
    claim."providerRecoveryAuthorizedAt",
    claim."providerRecoveryRecordedAt",
    claim."providerRecoveryFinalizedAt"
    INTO locked_claim
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id
     AND claim."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_claim."caseId" IS DISTINCT FROM locked_case.id
     OR locked_claim."providerRecoveryActorId"
          IS DISTINCT FROM locked_actor.id
     OR locked_claim."providerRecoveryAuthorizedAt" IS NULL
     OR locked_claim."providerRecoveryFinalizedAt" IS NOT NULL
     OR locked_claim.resolution NOT IN (
       'REFUND_FULL'::public."CaseResolution",
       'REFUND_PARTIAL'::public."CaseResolution"
     )
     OR locked_claim."refundAmountCents" IS NULL
     OR locked_order."caseResolutionClaimId"
          IS DISTINCT FROM locked_claim.id THEN
    RAISE EXCEPTION 'Case provider-record claim authority is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF locked_claim.status =
       'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
     AND p_provider_outcome = 'RECORDED' THEN
    SELECT
      payment_event.id,
      payment_event."stripeObjectId"
      INTO existing_event
      FROM public."OrderPaymentEvent" AS payment_event
     WHERE payment_event.id = locked_claim."orderPaymentEventId"
       AND payment_event."orderId" = locked_order.id
     FOR SHARE;
    IF NOT FOUND
       OR existing_event."stripeObjectId"
            IS DISTINCT FROM p_primary_refund_id THEN
      RAISE EXCEPTION 'Case provider-record replay is inconsistent'
        USING ERRCODE = '23514';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'paymentEventId', existing_event.id,
      'status', locked_claim.status::text,
      'action', 'replay'
    );
  END IF;

  IF locked_claim.status =
       'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
     AND p_provider_outcome = 'AMBIGUOUS' THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'paymentEventId', NULL,
      'status', locked_claim.status::text,
      'action', 'ambiguous_replay'
    );
  END IF;

  IF locked_claim.status <>
       'PROVIDER_PENDING'::public."CaseResolutionClaimStatus"
     OR locked_case.status IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     OR locked_case."resolvedAt" IS NOT NULL
     OR locked_order."sellerRefundId" IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Case provider-record claim is not pending'
      USING ERRCODE = '23514';
  END IF;

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
  IF p_provider_outcome = 'AMBIGUOUS' THEN
    IF p_primary_refund_id IS NOT NULL
       OR COALESCE(pg_catalog.cardinality(p_refund_ids), 0) <> 0
       OR COALESCE(pg_catalog.cardinality(p_refund_statuses), 0) <> 0
       OR p_transfer_reversal_id IS NOT NULL
       OR p_transfer_reversal_amount_cents IS NOT NULL
       OR COALESCE(p_requires_manual_transfer_reconciliation, false)
       OR COALESCE(p_requires_manual_follow_up, false) THEN
      RAISE EXCEPTION 'Ambiguous provider outcome cannot assert evidence'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public."Order" AS orders
       SET "sellerRefundId" =
             'ambiguous_refund_pending_reconciliation',
           "sellerRefundLockedAt" = NULL,
           "reviewNeeded" = true,
           "reviewNote" =
             'Staff case refund has an ambiguous provider outcome; '
             || 'staff must reconcile Stripe before retrying.'
     WHERE orders.id = locked_order.id
       AND orders."caseResolutionClaimId" = locked_claim.id
       AND orders."sellerRefundId" = 'pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case provider-record ambiguous lease was lost'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public."CaseResolutionClaim" AS claim
       SET status =
             'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus",
           "updatedAt" = transition_at
     WHERE claim.id = locked_claim.id
       AND claim.status =
             'PROVIDER_PENDING'::public."CaseResolutionClaimStatus";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case provider-record ambiguous transition failed'
        USING ERRCODE = '40001';
    END IF;

    audit_id :=
      'case-resolution-ambiguous-audit:'
      || pg_catalog.gen_random_uuid()::text;
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
    )
    VALUES (
      audit_id,
      'staff',
      locked_claim."staffActorId",
      'CASE_RESOLUTION_PROVIDER_AMBIGUOUS',
      'CASE_RESOLUTION_CLAIM',
      locked_claim.id,
      'provider_outcome_ambiguous',
      pg_catalog.jsonb_build_object(
        'caseId', locked_case.id,
        'orderId', locked_order.id,
        'idempotencyScope', locked_claim."idempotencyScope"
      ),
      transition_at
    );

    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'paymentEventId', NULL,
      'status', 'RECONCILIATION_REQUIRED',
      'action', 'ambiguous'
    );
  END IF;

  IF p_primary_refund_id IS NULL
     OR p_primary_refund_id !~ '^re_[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_primary_refund_id) > 220
     OR p_refund_ids IS NULL
     OR p_refund_statuses IS NULL
     OR pg_catalog.cardinality(p_refund_ids) < 1
     OR pg_catalog.cardinality(p_refund_ids) > 5
     OR pg_catalog.cardinality(p_refund_statuses)
          <> pg_catalog.cardinality(p_refund_ids)
     OR NOT (p_primary_refund_id = ANY(p_refund_ids))
     OR (
       SELECT pg_catalog.count(DISTINCT refund_id)
       FROM pg_catalog.unnest(p_refund_ids) AS ids(refund_id)
     ) <> pg_catalog.cardinality(p_refund_ids)
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_refund_ids) AS ids(refund_id)
        WHERE ids.refund_id IS NULL
           OR ids.refund_id !~ '^re_[A-Za-z0-9]+$'
           OR pg_catalog.char_length(ids.refund_id) > 220
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_refund_statuses) AS statuses(refund_status)
        WHERE statuses.refund_status IS NOT NULL
          AND (
            pg_catalog.btrim(statuses.refund_status) = ''
            OR pg_catalog.char_length(statuses.refund_status) > 100
            OR pg_catalog.lower(statuses.refund_status)
                 IN ('failed', 'canceled', 'cancelled')
          )
     )
     OR (
       p_transfer_reversal_id IS NOT NULL
       AND (
         p_transfer_reversal_id !~ '^trr_[A-Za-z0-9]+$'
         OR pg_catalog.char_length(p_transfer_reversal_id) > 220
       )
     )
     OR (
       p_transfer_reversal_amount_cents IS NOT NULL
       AND (
         p_transfer_reversal_amount_cents < 0
         OR p_transfer_reversal_amount_cents
              > locked_claim."refundAmountCents"
       )
     ) THEN
    RAISE EXCEPTION 'Recorded provider evidence is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT statuses.refund_status
    INTO primary_status
    FROM unnest(
      p_refund_ids,
      p_refund_statuses
    ) AS statuses(refund_id, refund_status)
   WHERE statuses.refund_id = p_primary_refund_id;

  payment_event_id :=
    'case-resolution-payment:' || pg_catalog.gen_random_uuid()::text;
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
    "createdAt",
    "updatedAt"
  )
  VALUES (
    payment_event_id,
    locked_order.id,
    'local:case_refund_recorded:' || p_primary_refund_id,
    p_primary_refund_id,
    'refund',
    'REFUND',
    locked_claim."refundAmountCents",
    locked_claim.currency,
    primary_status,
    'case_resolution_refund',
    'Provider refund recorded for staged Case resolution claim.',
    pg_catalog.jsonb_build_object(
      'localAction', 'CASE_REFUND_RECORDED',
      'caseId', locked_case.id,
      'resolutionClaimId', locked_claim.id,
      'resolution', locked_claim.resolution::text,
      'refundIds', pg_catalog.to_jsonb(p_refund_ids),
      'refundStatuses', pg_catalog.to_jsonb(p_refund_statuses),
      'transferReversalId', p_transfer_reversal_id,
      'transferReversalAmountCents',
        p_transfer_reversal_amount_cents,
      'requiresManualTransferReconciliation',
        COALESCE(p_requires_manual_transfer_reconciliation, false),
      'requiresManualFollowUp',
        COALESCE(p_requires_manual_follow_up, false)
    ),
    transition_at,
    transition_at
  );

  UPDATE public."Order" AS orders
     SET "sellerRefundId" = p_primary_refund_id,
         "sellerRefundAmountCents" = locked_claim."refundAmountCents",
         "sellerRefundLockedAt" = NULL,
         "reviewNeeded" = true,
         "reviewNote" =
           'Stripe refund recorded for staged staff Case resolution claim '
           || locked_claim.id || '.'
   WHERE orders.id = locked_order.id
     AND orders."caseResolutionClaimId" = locked_claim.id
     AND orders."sellerRefundId" = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-record refund lease was lost'
      USING ERRCODE = '40001';
  END IF;

  IF COALESCE(p_requires_manual_transfer_reconciliation, false) THEN
    UPDATE public."SellerProfile" AS seller
       SET "manualStripeReconciliationNeeded" = true,
           "manualStripeReconciliationNote" =
             'Staff case refund used a platform-only Stripe refund; '
             || 'staff must reconcile the seller transfer manually.',
           "updatedAt" = transition_at
     WHERE seller."userId" = locked_case."sellerId";
  END IF;

  UPDATE public."CaseResolutionClaim" AS claim
     SET status =
           'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus",
         "orderPaymentEventId" = payment_event_id,
         "providerRecordedAt" = transition_at,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim.status =
           'PROVIDER_PENDING'::public."CaseResolutionClaimStatus";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-record transition failed'
      USING ERRCODE = '40001';
  END IF;

  audit_id :=
    'case-resolution-provider-audit:'
    || pg_catalog.gen_random_uuid()::text;
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
  )
  VALUES (
    audit_id,
    'staff',
    locked_claim."staffActorId",
    'CASE_REFUND_RECORDED',
    'ORDER',
    locked_order.id,
    'case_resolution_refund',
    pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'resolutionClaimId', locked_claim.id,
      'orderPaymentEventId', payment_event_id,
      'stripeRefundId', p_primary_refund_id,
      'refundIds', pg_catalog.to_jsonb(p_refund_ids),
      'amountCents', locked_claim."refundAmountCents",
      'currency', locked_claim.currency
    ),
    transition_at
  );

  UPDATE public."CaseResolutionClaim" AS claim
     SET "providerRecoveryRecordedAt" = transition_at,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim."providerRecoveryActorId" = locked_actor.id
     AND claim."providerRecoveryRecordedAt" IS NULL
     AND claim."providerRecoveryFinalizedAt" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case recovery provider-record lease was lost'
      USING ERRCODE = '40001';
  END IF;

  recovery_audit_id :=
    'case-resolution-provider-recovery-record-audit:'
    || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason,
    metadata, undone, "createdAt"
  )
  VALUES (
    recovery_audit_id,
    locked_actor.id,
    'RECOVER_CASE_RESOLUTION_PROVIDER_RECORD',
    'CASE_RESOLUTION_CLAIM',
    locked_claim.id,
    locked_claim."providerRecoveryAction",
    pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'originalStaffActorId', locked_claim."staffActorId",
      'providerEvidenceSha256',
        locked_claim."providerRecoveryEvidenceSha256",
      'providerInspectedAt', locked_claim."providerRecoveryInspectedAt",
      'stripeRefundId', p_primary_refund_id
    ),
    false,
    transition_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'claimId', locked_claim.id,
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'paymentEventId', payment_event_id,
    'status', 'PROVIDER_RECORDED',
    'action', 'recorded'
  );
END
$grainline_case_staff_resolution_provider_recovery_record$;

CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_recovery_finalize(
  p_actor_user_id text,
  p_resolution_claim_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_staff_resolution_recovery_finalize$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  locked_claim record;
  linked_event record;
  plan_entry jsonb;
  plan_listing_id text;
  plan_quantity integer;
  message_id text;
  audit_id text;
  transition_at timestamp(3);
  resolution_message text;
  stripe_refund_id text := NULL;
  restored_active_count integer := 0;
  changed_count integer;
  recovery_audit_id text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_resolution_claim_id IS NULL
     OR pg_catalog.btrim(p_resolution_claim_id) = ''
     OR pg_catalog.char_length(p_resolution_claim_id) > 191 THEN
    RAISE EXCEPTION 'Case staff-resolution finalization input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.id,
    actor.role,
    actor.banned,
    actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL
     OR locked_actor.role <> 'ADMIN'::public."Role" THEN
    RAISE EXCEPTION 'Case staff-resolution finalizer is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT claim."orderId"
    INTO source_order_id
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution claim does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."buyerId",
    orders."caseResolutionClaimId",
    orders."sellerRefundId",
    orders."sellerRefundAmountCents",
    orders."fulfillmentStatus"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case finalization Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row.resolution,
    case_row."resolvedAt"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case finalization Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    claim.id,
    claim."caseId",
    claim."orderId",
    claim."staffActorId",
    claim.resolution,
    claim."refundAmountCents",
    claim.currency,
    claim."stockRestorePlan",
    claim.status,
    claim."orderPaymentEventId",
    claim."providerRecoveryActorId",
    claim."providerRecoveryAction",
    claim."providerRecoveryEvidenceSha256",
    claim."providerRecoveryInspectedAt",
    claim."providerRecoveryAuthorizedAt",
    claim."providerRecoveryRecordedAt",
    claim."providerRecoveryFinalizedAt"
    INTO locked_claim
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id
     AND claim."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_claim."caseId" IS DISTINCT FROM locked_case.id
     OR locked_claim."providerRecoveryActorId"
          IS DISTINCT FROM locked_actor.id
     OR locked_claim."providerRecoveryAuthorizedAt" IS NULL
     OR locked_claim."providerRecoveryRecordedAt" IS NULL THEN
    RAISE EXCEPTION 'Case finalization claim authority is invalid'
      USING ERRCODE = '42501';
  END IF;

  message_id := 'case_resolution_message_' || locked_claim.id;
  IF locked_claim.status =
       'FINALIZED'::public."CaseResolutionClaimStatus" THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'buyerUserId', locked_case."buyerId",
      'sellerUserId', locked_case."sellerId",
      'resolution', locked_claim.resolution::text,
      'refundAmountCents', locked_claim."refundAmountCents",
      'currency', locked_claim.currency,
      'resolutionMessageId', message_id,
      'stockStatusRestoredCount', 0,
      'status', 'FINALIZED',
      'action', 'replay'
    );
  END IF;

  IF locked_order."caseResolutionClaimId"
       IS DISTINCT FROM locked_claim.id
     OR locked_case.status IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     OR locked_case."resolvedAt" IS NOT NULL
     OR (
       locked_claim.resolution = 'DISMISSED'::public."CaseResolution"
       AND locked_claim.status <>
             'LOCAL_READY'::public."CaseResolutionClaimStatus"
     )
     OR (
       locked_claim.resolution IN (
         'REFUND_FULL'::public."CaseResolution",
         'REFUND_PARTIAL'::public."CaseResolution"
       )
       AND locked_claim.status <>
             'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
     ) THEN
    RAISE EXCEPTION 'Case resolution claim is not finalizable'
      USING ERRCODE = '23514';
  END IF;

  IF locked_claim."orderPaymentEventId" IS NOT NULL THEN
    SELECT
      payment_event.id,
      payment_event."orderId",
      payment_event."stripeObjectId",
      payment_event."stripeObjectType",
      payment_event."eventType",
      payment_event."amountCents",
      payment_event.currency,
      payment_event.reason,
      payment_event.metadata
      INTO linked_event
      FROM public."OrderPaymentEvent" AS payment_event
     WHERE payment_event.id = locked_claim."orderPaymentEventId"
       AND payment_event."orderId" = locked_order.id
     FOR SHARE;
    IF NOT FOUND
       OR linked_event."eventType" <> 'REFUND'
       OR linked_event."stripeObjectType" IS DISTINCT FROM 'refund'
       OR linked_event."stripeObjectId"
            IS DISTINCT FROM locked_order."sellerRefundId"
       OR linked_event."amountCents"
            IS DISTINCT FROM locked_claim."refundAmountCents"
       OR linked_event.currency IS DISTINCT FROM locked_claim.currency
       OR linked_event.reason IS DISTINCT FROM 'case_resolution_refund'
       OR linked_event.metadata->>'localAction'
            IS DISTINCT FROM 'CASE_REFUND_RECORDED'
       OR linked_event.metadata->>'resolutionClaimId'
            IS DISTINCT FROM locked_claim.id
       OR locked_order."sellerRefundAmountCents"
            IS DISTINCT FROM locked_claim."refundAmountCents" THEN
      RAISE EXCEPTION 'Case finalization payment evidence is invalid'
        USING ERRCODE = '23514';
    END IF;
    stripe_refund_id := linked_event."stripeObjectId";
  ELSIF locked_claim.resolution <>
          'DISMISSED'::public."CaseResolution" THEN
    RAISE EXCEPTION 'Case finalization refund evidence is absent'
      USING ERRCODE = '23514';
  END IF;

  -- Lock and revalidate the complete current Order-item/listing source graph
  -- before applying any Case transition. The Order lock alone does not stop a
  -- caller with direct OrderItem authority from racing the stock derivation.
  PERFORM item.id
    FROM public."OrderItem" AS item
    JOIN public."Listing" AS listing ON listing.id = item."listingId"
   WHERE item."orderId" = locked_order.id
   ORDER BY item.id, listing.id
   FOR SHARE OF item
   FOR UPDATE OF listing;

  IF pg_catalog.jsonb_array_length(locked_claim."stockRestorePlan") > 0
     AND locked_order."fulfillmentStatus" IN (
       'SHIPPED'::public."FulfillmentStatus",
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
     ) THEN
    RAISE EXCEPTION 'Case finalization cannot restore fulfilled stock'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH plan AS (
      SELECT
        input.value->>'listingId' AS listing_id,
        (input.value->>'quantity')::integer AS quantity
      FROM pg_catalog.jsonb_array_elements(
        locked_claim."stockRestorePlan"
      ) AS input(value)
    ),
    purchased AS (
      SELECT
        item."listingId" AS listing_id,
        pg_catalog.sum(item.quantity)::integer AS quantity
      FROM public."OrderItem" AS item
      JOIN public."Listing" AS listing ON listing.id = item."listingId"
      WHERE item."orderId" = locked_order.id
        AND listing."listingType" = 'IN_STOCK'::public."ListingType"
      GROUP BY item."listingId"
    )
    SELECT 1
      FROM plan
      LEFT JOIN purchased USING (listing_id)
     WHERE purchased.listing_id IS NULL
        OR plan.quantity <= 0
        OR plan.quantity > purchased.quantity
  ) THEN
    RAISE EXCEPTION 'Case finalization stock plan no longer validates'
      USING ERRCODE = '23514';
  END IF;

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
  resolution_message :=
    CASE locked_claim.resolution
      WHEN 'REFUND_FULL'::public."CaseResolution"
        THEN 'Grainline resolved this case with a full refund to the buyer.'
      WHEN 'REFUND_PARTIAL'::public."CaseResolution"
        THEN 'Grainline resolved this case with a partial refund to the buyer.'
      ELSE 'Grainline reviewed this case and dismissed it.'
    END;

  UPDATE public."Case" AS case_row
     SET status = 'RESOLVED'::public."CaseStatus",
         resolution = locked_claim.resolution,
         "refundAmountCents" = locked_claim."refundAmountCents",
         "stripeRefundId" = stripe_refund_id,
         "resolvedAt" = transition_at,
         "resolvedById" = locked_claim."staffActorId",
         "buyerMarkedResolved" = false,
         "sellerMarkedResolved" = false,
         "updatedAt" = transition_at
   WHERE case_row.id = locked_case.id
     AND case_row.status NOT IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     AND case_row."resolvedAt" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case finalization transition lost'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public."CaseMessage" (
    id,
    "caseId",
    "authorId",
    "authorKind",
    body,
    "createdAt"
  )
  VALUES (
    message_id,
    locked_case.id,
    locked_claim."staffActorId",
    'STAFF'::public."CaseMessageAuthorKind",
    resolution_message,
    transition_at
  );

  FOR plan_entry IN
    SELECT input.value
      FROM pg_catalog.jsonb_array_elements(
        locked_claim."stockRestorePlan"
      ) AS input(value)
     ORDER BY input.value->>'listingId'
  LOOP
    plan_listing_id := plan_entry->>'listingId';
    plan_quantity := (plan_entry->>'quantity')::integer;
    UPDATE public."Listing" AS listing
       SET "stockQuantity" =
             COALESCE(listing."stockQuantity", 0) + plan_quantity,
           status = CASE
             WHEN listing.status =
                    'SOLD_OUT'::public."ListingStatus"
                  AND NOT listing."isPrivate"
               THEN 'ACTIVE'::public."ListingStatus"
             ELSE listing.status
           END,
           "updatedAt" = transition_at
     WHERE listing.id = plan_listing_id
       AND listing."listingType" =
             'IN_STOCK'::public."ListingType";
    GET DIAGNOSTICS changed_count = ROW_COUNT;
    IF changed_count <> 1 THEN
      RAISE EXCEPTION 'Case finalization stock target disappeared'
        USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public."Listing" AS listing
       WHERE listing.id = plan_listing_id
         AND listing.status = 'ACTIVE'::public."ListingStatus"
         AND NOT listing."isPrivate"
    ) THEN
      restored_active_count := restored_active_count + 1;
    END IF;
  END LOOP;

  UPDATE public."Order" AS orders
     SET "reviewNeeded" = true,
         "reviewNote" =
           'Case resolved by fixed staff authority: '
           || locked_claim.resolution::text || '.'
   WHERE orders.id = locked_order.id
     AND orders."caseResolutionClaimId" = locked_claim.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case finalization Order lease was lost'
      USING ERRCODE = '40001';
  END IF;

  audit_id :=
    'case-resolution-admin-audit:'
    || pg_catalog.gen_random_uuid()::text;
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
  )
  VALUES (
    audit_id,
    locked_claim."staffActorId",
    'RESOLVE_CASE',
    'CASE',
    locked_case.id,
    locked_claim.resolution::text,
    pg_catalog.jsonb_build_object(
      'orderId', locked_order.id,
      'resolutionClaimId', locked_claim.id,
      'resolution', locked_claim.resolution::text,
      'refundAmountCents', locked_claim."refundAmountCents",
      'stripeRefundId', stripe_refund_id,
      'resolutionMessageId', message_id,
      'at', transition_at
    ),
    false,
    transition_at
  );

  UPDATE public."CaseResolutionClaim" AS claim
     SET status = 'FINALIZED'::public."CaseResolutionClaimStatus",
         "finalizedAt" = transition_at,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim.status IN (
       'LOCAL_READY'::public."CaseResolutionClaimStatus",
       'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution claim finalization failed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public."Order" AS orders
     SET "caseResolutionClaimId" = NULL
   WHERE orders.id = locked_order.id
     AND orders."caseResolutionClaimId" = locked_claim.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution claim lease release failed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public."CaseResolutionClaim" AS claim
     SET "providerRecoveryFinalizedAt" = transition_at,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim."providerRecoveryActorId" = locked_actor.id
     AND claim."providerRecoveryRecordedAt" IS NOT NULL
     AND claim."providerRecoveryFinalizedAt" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case recovery finalization lease was lost'
      USING ERRCODE = '40001';
  END IF;

  recovery_audit_id :=
    'case-resolution-provider-recovery-finalize-audit:'
    || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason,
    metadata, undone, "createdAt"
  )
  VALUES (
    recovery_audit_id,
    locked_actor.id,
    'RECOVER_CASE_RESOLUTION_FINALIZE',
    'CASE_RESOLUTION_CLAIM',
    locked_claim.id,
    locked_claim."providerRecoveryAction",
    pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'originalStaffActorId', locked_claim."staffActorId",
      'providerEvidenceSha256',
        locked_claim."providerRecoveryEvidenceSha256",
      'providerInspectedAt', locked_claim."providerRecoveryInspectedAt"
    ),
    false,
    transition_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'claimId', locked_claim.id,
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'resolution', locked_claim.resolution::text,
    'refundAmountCents', locked_claim."refundAmountCents",
    'currency', locked_claim.currency,
    'resolutionMessageId', message_id,
    'stockStatusRestoredCount', restored_active_count,
    'status', 'FINALIZED',
    'action', 'finalized'
  );
END
$grainline_case_staff_resolution_recovery_finalize$;

REVOKE ALL ON FUNCTION
  public.grainline_case_resolution_claim_immutable()
  FROM PUBLIC, grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_load(
    text, text, public."CaseResolution", integer
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_load(
    text, text, public."CaseResolution", integer
  )
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_provider_clock(
    text, text, text, text, text
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_provider_clock(
    text, text, text, text, text
  )
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_provider_recover(
    text, text, text, bigint, text
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_provider_recover(
    text, text, text, bigint, text
  )
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_record(
    text, text, text, text, text[], text[], text, integer, boolean, boolean
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_record(
    text, text, text, text, text[], text[], text, integer, boolean, boolean
  )
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_recovery_finalize(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_recovery_finalize(text, text)
  TO grainline_app_runtime;

DO $grainline_case_refund_provider_recovery_postflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (
        VALUES
          ('public.grainline_case_resolution_claim_immutable()', 'a010dd797a770fdbb1c821f3e09c3717c5b517de315723e33d34f1c493f2bf7f', false, false, 'v', 'u'),
          ('public.grainline_case_staff_resolution_provider_recovery_load(text,text,public."CaseResolution",integer)', '19b554741fce36f911cbba1dc771af88756ef02213ec9424e3ed4c8311a1ddca', true, true, 'v', 'u'),
          ('public.grainline_case_staff_resolution_provider_clock(text,text,text,text,text)', '97a26d9f282dfbfc804cc775ce53c3ce3fd4b12db3c6a33be4d92387622e9e16', true, true, 's', 's'),
          ('public.grainline_case_staff_resolution_provider_recover(text,text,text,bigint,text)', '3e41e7d53e75bcc8c6b0fc1803282d96014c87d2c96618695b9bef591c8501a9', true, true, 'v', 'u'),
          ('public.grainline_case_staff_resolution_provider_recovery_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)', 'f2ff2bb23e2e0be1d35e6f4a0e91ae0575df10e7f7bcc844d50c1572a503f09d', true, true, 'v', 'u'),
          ('public.grainline_case_staff_resolution_recovery_finalize(text,text)', '35b2e895782f4e620282670cc519c8e2fb05cc8310145db45a2d3a040abd0275', true, true, 'v', 'u')
      ) AS expected_functions(
        identity, source_sha256, runtime_execute, security_definer,
        volatility, parallel_safety
      )
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Case recovery function % is missing', expected.identity;
    END IF;
    SELECT pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(routine.prosrc, 'UTF8')
             ),
             'hex'
           )
      INTO actual_hash
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = function_oid
       AND routine.prosecdef = expected.security_definer
       AND routine.provolatile = expected.volatility::"char"
       AND routine.proparallel = expected.parallel_safety::"char"
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];
    IF actual_hash IS DISTINCT FROM expected.source_sha256
       OR pg_catalog.has_function_privilege(
            'grainline_app_runtime', function_oid, 'EXECUTE'
          ) IS DISTINCT FROM expected.runtime_execute
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
      RAISE EXCEPTION 'Case recovery function % drifted', expected.identity;
    END IF;
  END LOOP;

  IF pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."CaseResolutionClaim"',
       'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     ) THEN
    RAISE EXCEPTION 'Runtime gained direct CaseResolutionClaim authority';
  END IF;
END
$grainline_case_refund_provider_recovery_postflight$;

COMMIT;
