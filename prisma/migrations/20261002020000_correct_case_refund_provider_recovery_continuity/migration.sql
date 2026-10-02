-- Keep recovered Case refunds retryable after a second ambiguous
-- provider result, return complete recovery state from the load function, and
-- permit an active ADMIN to take over only when the assigned recovery ADMIN
-- is no longer active. No RLS policy or table grant changes are made.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.case.refund-provider-recovery.continuity',
    0
  )
);

DO $grainline_case_refund_provider_continuity_preflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (
        VALUES
          ('public.grainline_case_resolution_claim_immutable()', 'a010dd797a770fdbb1c821f3e09c3717c5b517de315723e33d34f1c493f2bf7f', false, false),
          ('public.grainline_case_staff_resolution_provider_recovery_load(text,text,public."CaseResolution",integer)', '19b554741fce36f911cbba1dc771af88756ef02213ec9424e3ed4c8311a1ddca', true, true),
          ('public.grainline_case_staff_resolution_provider_recovery_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)', 'f2ff2bb23e2e0be1d35e6f4a0e91ae0575df10e7f7bcc844d50c1572a503f09d', true, true)
      ) AS expected_functions(
        identity, source_sha256, runtime_execute, security_definer
      )
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Case continuity predecessor function % is missing',
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
      RAISE EXCEPTION 'Case continuity predecessor function % drifted',
        expected.identity;
    END IF;
  END LOOP;
END
$grainline_case_refund_provider_continuity_preflight$;

CREATE OR REPLACE FUNCTION
  public.grainline_case_resolution_claim_immutable()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SET search_path = pg_catalog
AS $grainline_case_resolution_claim_immutable$
DECLARE
  recovery_redelegation boolean;
  recovery_reset boolean;
BEGIN
  recovery_redelegation :=
    OLD."providerRecoveryActorId" IS NOT NULL
    AND NEW."providerRecoveryActorId" IS NOT NULL
    AND NEW."providerRecoveryActorId"
          IS DISTINCT FROM OLD."providerRecoveryActorId"
    AND NEW.status = OLD.status
    AND NEW."providerRecoveryAction"
          IS NOT DISTINCT FROM OLD."providerRecoveryAction"
    AND NEW."providerRecoveryEvidenceSha256"
          IS NOT DISTINCT FROM OLD."providerRecoveryEvidenceSha256"
    AND NEW."providerRecoveryInspectedAt"
          IS NOT DISTINCT FROM OLD."providerRecoveryInspectedAt"
    AND NEW."providerRecoveryAuthorizedAt"
          IS NOT DISTINCT FROM OLD."providerRecoveryAuthorizedAt"
    AND NEW."providerRecoveryRecordedAt"
          IS NOT DISTINCT FROM OLD."providerRecoveryRecordedAt"
    AND NEW."providerRecoveryFinalizedAt" IS NULL
    AND OLD."providerRecoveryFinalizedAt" IS NULL
    AND EXISTS (
      SELECT 1
        FROM public."User" AS replacement_actor
       WHERE replacement_actor.id = NEW."providerRecoveryActorId"
         AND replacement_actor.role = 'ADMIN'::public."Role"
         AND NOT replacement_actor.banned
         AND replacement_actor."deletedAt" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
        FROM public."User" AS prior_actor
       WHERE prior_actor.id = OLD."providerRecoveryActorId"
         AND prior_actor.role = 'ADMIN'::public."Role"
         AND NOT prior_actor.banned
         AND prior_actor."deletedAt" IS NULL
    );

  recovery_reset :=
    OLD.status = 'PROVIDER_PENDING'::public."CaseResolutionClaimStatus"
    AND NEW.status =
          'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
    AND OLD."providerRecoveryActorId" IS NOT NULL
    AND NEW."providerRecoveryActorId" IS NULL
    AND NEW."providerRecoveryAction" IS NULL
    AND NEW."providerRecoveryEvidenceSha256" IS NULL
    AND NEW."providerRecoveryInspectedAt" IS NULL
    AND NEW."providerRecoveryAuthorizedAt" IS NULL
    AND OLD."providerRecoveryRecordedAt" IS NULL
    AND NEW."providerRecoveryRecordedAt" IS NULL
    AND OLD."providerRecoveryFinalizedAt" IS NULL
    AND NEW."providerRecoveryFinalizedAt" IS NULL;
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
     )
     AND NOT recovery_redelegation
     AND NOT recovery_reset THEN
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
    OR recovery_redelegation
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
  prior_actor record;
  recovery_action text;
  transition_at timestamp(3);
  audit_id text;
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
    claim."providerRecoveryAction",
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
    IF locked_claim."providerRecoveryActorId" IS DISTINCT FROM locked_actor.id THEN
      SELECT actor.id, actor.role, actor.banned, actor."deletedAt"
        INTO prior_actor
        FROM public."User" AS actor
       WHERE actor.id = locked_claim."providerRecoveryActorId"
       FOR SHARE;
      IF NOT FOUND
         OR locked_actor.role <> 'ADMIN'::public."Role"
         OR locked_claim."providerRecoveryAuthorizedAt" IS NULL
         OR locked_claim."providerRecoveryFinalizedAt" IS NOT NULL
         OR (
           prior_actor.role = 'ADMIN'::public."Role"
           AND NOT prior_actor.banned
           AND prior_actor."deletedAt" IS NULL
         ) THEN
        RAISE EXCEPTION 'Case provider-recovery claim is already delegated'
          USING ERRCODE = '42501';
      END IF;

      transition_at :=
        pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
      UPDATE public."CaseResolutionClaim" AS claim
         SET "providerRecoveryActorId" = locked_actor.id,
             "updatedAt" = transition_at
       WHERE claim.id = locked_claim.id
         AND claim."providerRecoveryActorId" =
               locked_claim."providerRecoveryActorId"
         AND claim."providerRecoveryFinalizedAt" IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Case provider-recovery redelegation was lost'
          USING ERRCODE = '40001';
      END IF;

      audit_id :=
        'case-resolution-provider-recovery-redelegate-audit:'
        || pg_catalog.gen_random_uuid()::text;
      INSERT INTO public."AdminAuditLog" (
        id, "adminId", action, "targetType", "targetId", reason,
        metadata, undone, "createdAt"
      )
      VALUES (
        audit_id,
        locked_actor.id,
        'REDELEGATE_CASE_RESOLUTION_PROVIDER_RECOVERY',
        'CASE_RESOLUTION_CLAIM',
        locked_claim.id,
        'prior_recovery_actor_inactive',
        pg_catalog.jsonb_build_object(
          'caseId', locked_case.id,
          'orderId', locked_order.id,
          'originalStaffActorId', locked_claim."staffActorId",
          'priorRecoveryActorId', locked_claim."providerRecoveryActorId",
          'replacementRecoveryActorId', locked_actor.id
        ),
        false,
        transition_at
      );
      locked_claim."providerRecoveryActorId" := locked_actor.id;
    END IF;
    IF locked_claim."providerRecoveryAuthorizedAt" IS NULL
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
     OR p_provider_outcome IS NULL
     OR p_provider_outcome NOT IN ('RECORDED', 'AMBIGUOUS') THEN
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
           "providerRecoveryActorId" = NULL,
           "providerRecoveryAction" = NULL,
           "providerRecoveryEvidenceSha256" = NULL,
           "providerRecoveryInspectedAt" = NULL,
           "providerRecoveryAuthorizedAt" = NULL,
           "providerRecoveryRecordedAt" = NULL,
           "providerRecoveryFinalizedAt" = NULL,
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

    recovery_audit_id :=
      'case-resolution-provider-recovery-ambiguous-audit:'
      || pg_catalog.gen_random_uuid()::text;
    INSERT INTO public."AdminAuditLog" (
      id, "adminId", action, "targetType", "targetId", reason,
      metadata, undone, "createdAt"
    )
    VALUES (
      recovery_audit_id,
      locked_actor.id,
      'RECOVER_CASE_RESOLUTION_PROVIDER_AMBIGUOUS',
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
  public.grainline_case_staff_resolution_provider_recovery_record(
    text, text, text, text, text[], text[], text, integer, boolean, boolean
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_record(
    text, text, text, text, text[], text[], text, integer, boolean, boolean
  )
  TO grainline_app_runtime;

DO $grainline_case_refund_provider_continuity_postflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (
        VALUES
          ('public.grainline_case_resolution_claim_immutable()', '1e5913ce0903f4450b9b1353bba7bf00bc65d28ac22bdd5fb0ef73578c0f7d0b', false, false),
          ('public.grainline_case_staff_resolution_provider_recovery_load(text,text,public."CaseResolution",integer)', '02ec90e1eb5c04c6e2430b842a99ea269e740c016c46a0dfe5c51ef9d4a0d040', true, true),
          ('public.grainline_case_staff_resolution_provider_recovery_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)', '17b92868e2d3eca10291c601911d5f06da8d554fe9a3fef66401963533b7f3ca', true, true)
      ) AS expected_functions(
        identity, source_sha256, runtime_execute, security_definer
      )
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
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
    IF function_oid IS NULL
       OR actual_hash IS DISTINCT FROM expected.source_sha256
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
      RAISE EXCEPTION 'Case continuity function % drifted', expected.identity;
    END IF;
  END LOOP;
END
$grainline_case_refund_provider_continuity_postflight$;

COMMIT;
