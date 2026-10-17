-- Correct the Case resolution/refund state machine without changing tables,
-- triggers, constraints, grants, or function signatures.
-- Findings: #659 #660 #676 #677 #678 #655 #657 #665 #679 #680 (+ #602 listing order, #624, #15)
-- The eleven predecessor bodies were verified unchanged on main b85043ae;
-- their hashes match the independently exercised prototype from a343fd9c.
--
-- Shape of the forward migration: one transaction, run as the function owner.
--   1. preflight: every target's prosrc SHA-256 must equal the reviewed predecessor;
--      snapshot owner/SECURITY DEFINER/proconfig/ACL.
--   2. CREATE OR REPLACE (same signatures, owner, SECURITY DEFINER, search_path; ACLs are
--      preserved by CREATE OR REPLACE).
--   3. postflight: owner/secdef/proconfig/ACL unchanged; successor SHA-256 pinned.
-- No table, trigger, constraint or grant changes. grainline_case_resolution_claim_immutable
-- (whose md5 is pinned by two production inspectors) is NOT modified.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.case.refund-recovery-core.correction',
    0
  )
);

CREATE TEMP TABLE _case_batch_fn_snapshot (
  sig text PRIMARY KEY, owner text, secdef boolean, cfg text[], acl text
);

DO $preflight$
DECLARE
  expected jsonb := '{"public.grainline_case_staff_resolution_provider_recovery_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)":"c65c22a3ae2555c8044de22177320194abdbdc35af70b8177ce02d7f044c5e96","public.grainline_case_staff_resolution_recovery_finalize(text,text)":"35b2e895782f4e620282670cc519c8e2fb05cc8310145db45a2d3a040abd0275","public.grainline_case_staff_resolution_finalize(text,text)":"7b7ff76969a059f6bd4a947a790dc3482d6c1aaabfb14eaf3bafc953b51782c8","public.grainline_case_staff_resolution_prepare(text,text,public.\"CaseResolution\",integer,jsonb)":"1f2786a3676e23af23848fab06e829a69bc7cd51bc25274e5569d9f5bc21c5a9","public.grainline_case_staff_resolution_provider_recover(text,text,text,bigint,text)":"3e41e7d53e75bcc8c6b0fc1803282d96014c87d2c96618695b9bef591c8501a9","public.grainline_case_staff_resolution_provider_recovery_load(text,text,public.\"CaseResolution\",integer)":"02ec90e1eb5c04c6e2430b842a99ea269e740c016c46a0dfe5c51ef9d4a0d040","public.grainline_case_staff_resolution_reconcile(text,text,text,text)":"2b70cb728df1471f68ebf63b98489d33c4b3de56a9250ad3b87e01a1133851d6","public.grainline_case_mark_resolved(text,text)":"68c98591e93b82738c29286c1ad9e31b870176445a035fe8313f4119bff451b9","public.grainline_case_reply(text,text,text,text[])":"2e7adeaccf4dc803aa0d286a095f186eed2f8d6ba81cb8a508c3e57f5a02e094","public.grainline_seller_refund_claim(text,text)":"e21af7fd6526eee32b382b131e09fe34e6116b973a89a5509919899265568821","public.grainline_seller_refund_preflight(text,text)":"ffbacd294ec5475bcd4155dc88f5275e17e05e80b5cd1fdc727cba6638521619"}'::jsonb;
  item record;
  fn regprocedure;
  actual text;
BEGIN
  FOR item IN SELECT key, value #>> '{}' AS sha FROM pg_catalog.jsonb_each(expected) LOOP
    fn := pg_catalog.to_regprocedure(item.key);
    IF fn IS NULL THEN
      RAISE EXCEPTION 'case batch preflight: % is missing', item.key;
    END IF;
    SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex')
      INTO actual FROM pg_catalog.pg_proc AS p WHERE p.oid = fn;
    IF actual IS DISTINCT FROM item.sha THEN
      RAISE EXCEPTION 'case batch preflight: % drifted (prosrc sha256 %)', item.key, actual;
    END IF;
    INSERT INTO _case_batch_fn_snapshot
    SELECT item.key, pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, COALESCE(p.proacl::text, '')
      FROM pg_catalog.pg_proc AS p WHERE p.oid = fn;
  END LOOP;
END
$preflight$;

-- ===================================================================
-- grainline_case_staff_resolution_provider_recovery_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)
-- #659: #659 set providerRecoveryRecordedAt in the PROVIDER_PENDING->PROVIDER_RECORDED update; #659 remove the second (same-status) recovery-record UPDATE
-- ===================================================================
CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_provider_recovery_record(p_actor_user_id text, p_resolution_claim_id text, p_provider_outcome text, p_primary_refund_id text, p_refund_ids text[], p_refund_statuses text[], p_transfer_reversal_id text, p_transfer_reversal_amount_cents integer, p_requires_manual_transfer_reconciliation boolean, p_requires_manual_follow_up boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    PERFORM public.grainline_seller_profile_reconciliation_required_compat(
      NULL::text,
      locked_case."sellerId",
      'Staff case refund used a platform-only Stripe refund; '
        || 'staff must reconcile the seller transfer manually.',
      transition_at
    );
  END IF;

  -- #659: the recovery record stamp is written in the same UPDATE as the
  -- status transition. grainline_case_resolution_claim_immutable rejects a
  -- second same-status UPDATE of a delegated claim.
  UPDATE public."CaseResolutionClaim" AS claim
     SET status =
           'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus",
         "orderPaymentEventId" = payment_event_id,
         "providerRecordedAt" = transition_at,
         "providerRecoveryRecordedAt" = transition_at,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim.status =
           'PROVIDER_PENDING'::public."CaseResolutionClaimStatus"
     AND claim."providerRecoveryActorId" = locked_actor.id
     AND claim."providerRecoveryRecordedAt" IS NULL
     AND claim."providerRecoveryFinalizedAt" IS NULL;
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
$function$
;

-- ===================================================================
-- grainline_case_staff_resolution_recovery_finalize(text,text)
-- #660 #676 #677 #602: #677 party guard; #602 lock listings in listing-id order (matches checkout reservation); #676 author the resolution message as the validated recovering ADMIN; #660 set providerRecoveryFinalizedAt in the FINALIZED update; #660 remove the post-terminal recovery-finalize UPDATE
-- ===================================================================
CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_recovery_finalize(p_actor_user_id text, p_resolution_claim_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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

  -- #605/#677 separation of duties: staff who are this Case's buyer or
  -- seller may not recover or finalize it. Runs before any provider call.
  IF locked_actor.id = locked_case."sellerId"
     OR locked_actor.id IS NOT DISTINCT FROM locked_case."buyerId" THEN
    RAISE EXCEPTION 'Case staff-resolution actor is a Case party'
      USING ERRCODE = '42501';
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
   ORDER BY listing.id, item.id
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
    -- #676: the original staffActorId may have been demoted, banned or
    -- deleted since the provider effect; it stays in claim + audit metadata.
    locked_actor.id,
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

  -- #660: the recovery finalization stamp is written with FINALIZED; the
  -- claim is terminal (immutable) after this statement.
  UPDATE public."CaseResolutionClaim" AS claim
     SET status = 'FINALIZED'::public."CaseResolutionClaimStatus",
         "finalizedAt" = transition_at,
         "providerRecoveryFinalizedAt" = transition_at,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim.status IN (
       'LOCAL_READY'::public."CaseResolutionClaimStatus",
       'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
     )
     AND claim."providerRecoveryActorId" = locked_actor.id
     AND claim."providerRecoveryRecordedAt" IS NOT NULL
     AND claim."providerRecoveryFinalizedAt" IS NULL;
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
$function$
;

-- ===================================================================
-- grainline_case_staff_resolution_finalize(text,text)
-- #678 #677 #602: #678 declare takeover flag; #677 party guard; #678 ADMIN takeover of a LOCAL_READY dismissal whose preparer is no longer active staff; #602 lock listings in listing-id order (matches checkout reservation); #678 record the takeover in the RESOLVE_CASE audit metadata
-- ===================================================================
CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_finalize(p_actor_user_id text, p_resolution_claim_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  staff_takeover boolean := false;
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
     OR locked_actor.role NOT IN (
       'EMPLOYEE'::public."Role",
       'ADMIN'::public."Role"
     ) THEN
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

  -- #605/#677 separation of duties: staff who are this Case's buyer or
  -- seller may not finalize it. Runs before any provider call.
  IF locked_actor.id = locked_case."sellerId"
     OR locked_actor.id IS NOT DISTINCT FROM locked_case."buyerId" THEN
    RAISE EXCEPTION 'Case staff-resolution actor is a Case party'
      USING ERRCODE = '42501';
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
    claim."orderPaymentEventId"
    INTO locked_claim
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id
     AND claim."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_claim."caseId" IS DISTINCT FROM locked_case.id THEN
    RAISE EXCEPTION 'Case finalization claim authority is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF locked_claim."staffActorId" IS DISTINCT FROM locked_actor.id THEN
    -- #678: a current ADMIN may finish a staged dismissal (no provider
    -- effect) whose preparing staff member is no longer active staff, or was
    -- a party of the Case (a pre-#677 claim the preparer can no longer
    -- finalize). Refund claims keep using the ADMIN provider-recovery path.
    IF locked_actor.role <> 'ADMIN'::public."Role"
       OR locked_claim.resolution <> 'DISMISSED'::public."CaseResolution"
       OR locked_claim.status <>
            'LOCAL_READY'::public."CaseResolutionClaimStatus"
       OR (
         -- the preparer is still active, non-party staff: no takeover
         locked_claim."staffActorId" IS DISTINCT FROM locked_case."sellerId"
         AND locked_claim."staffActorId" IS DISTINCT FROM locked_case."buyerId"
         AND EXISTS (
           SELECT 1
             FROM public."User" AS original_staff
            WHERE original_staff.id = locked_claim."staffActorId"
              AND NOT original_staff.banned
              AND original_staff."deletedAt" IS NULL
              AND original_staff.role IN (
                'EMPLOYEE'::public."Role",
                'ADMIN'::public."Role"
              )
         )
       ) THEN
      RAISE EXCEPTION 'Case finalization claim authority is invalid'
        USING ERRCODE = '42501';
    END IF;
    staff_takeover := true;
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
   ORDER BY listing.id, item.id
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
         "resolvedById" = locked_actor.id,
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
    locked_actor.id,
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
    locked_actor.id,
    'RESOLVE_CASE',
    'CASE',
    locked_case.id,
    locked_claim.resolution::text,
    pg_catalog.jsonb_build_object(
      'orderId', locked_order.id,
      'resolutionClaimId', locked_claim.id,
      'originalStaffActorId', locked_claim."staffActorId",
      'staffTakeover', staff_takeover,
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
$function$
;

-- ===================================================================
-- grainline_case_staff_resolution_prepare(text,text,"CaseResolution",integer,jsonb)
-- #677 #678: #678 declarations; #677 party guard before any claim or provider work; #678 identical-DISMISSED takeover by a current ADMIN
-- ===================================================================
CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_prepare(p_actor_user_id text, p_case_id text, p_resolution "CaseResolution", p_partial_refund_amount_cents integer, p_stock_restore_decision jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  existing_claim record;
  existing_found boolean := false;
  dismissal_takeover boolean := false;
  seller_count integer;
  only_seller_user_id text;
  order_total_cents bigint;
  refund_amount_cents integer;
  stock_restore_plan jsonb := '[]'::jsonb;
  decision_entry jsonb;
  claim_id text;
  claim_status public."CaseResolutionClaimStatus";
  idempotency_scope text;
  transition_at timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_case_id IS NULL
     OR pg_catalog.btrim(p_case_id) = ''
     OR pg_catalog.char_length(p_case_id) > 191
     OR p_resolution IS NULL
     OR p_stock_restore_decision IS NULL
     OR pg_catalog.jsonb_typeof(p_stock_restore_decision) <> 'array'
     OR pg_catalog.jsonb_array_length(p_stock_restore_decision) > 50
     OR pg_catalog.octet_length(p_stock_restore_decision::text) > 32768 THEN
    RAISE EXCEPTION 'Case staff-resolution preparation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  FOR decision_entry IN
    SELECT input.value
      FROM pg_catalog.jsonb_array_elements(p_stock_restore_decision) AS input(value)
  LOOP
    IF pg_catalog.jsonb_typeof(decision_entry) <> 'object'
       OR (decision_entry - 'listingId' - 'quantity') <> '{}'::jsonb
       OR NOT (decision_entry ? 'listingId')
       OR NOT (decision_entry ? 'quantity')
       OR pg_catalog.btrim(decision_entry->>'listingId') = ''
       OR pg_catalog.char_length(decision_entry->>'listingId') > 191
       OR COALESCE(decision_entry->>'quantity', '') !~ '^[1-9][0-9]?$' THEN
      RAISE EXCEPTION 'Case stock-restoration decision is invalid'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

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
     OR locked_actor.role NOT IN (
       'EMPLOYEE'::public."Role",
       'ADMIN'::public."Role"
     ) THEN
    RAISE EXCEPTION 'Case staff-resolution actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT case_row."orderId"
    INTO source_order_id
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case staff-resolution Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."buyerId",
    orders.currency,
    orders."itemsSubtotalCents",
    orders."shippingAmountCents",
    orders."giftWrappingPriceCents",
    orders."taxAmountCents",
    orders."stripePaymentIntentId",
    orders."stripeTransferId",
    orders."sellerRefundId",
    orders."sellerRefundAmountCents",
    orders."sellerRefundLockedAt",
    orders."labelStatus",
    orders."labelClaimStatus",
    orders."fulfillmentStatus",
    orders."paymentOpenDisputeBlocked",
    orders."caseResolutionClaimId"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case staff-resolution Order does not exist'
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
   WHERE case_row.id = p_case_id
     AND case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case staff-resolution Case changed Order'
      USING ERRCODE = '40001';
  END IF;

  IF locked_case.status IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     OR locked_case."resolvedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case is already terminal'
      USING ERRCODE = '23514';
  END IF;

  -- #605/#677 separation of duties: staff who are this Case's buyer or
  -- seller may not resolve it. Runs before any provider call.
  IF locked_actor.id = locked_case."sellerId"
     OR locked_actor.id IS NOT DISTINCT FROM locked_case."buyerId" THEN
    RAISE EXCEPTION 'Case staff-resolution actor is a Case party'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the complete Order-item/listing/seller graph before deriving parties
  -- or stock authority. Finalization revalidates the immutable stored plan.
  PERFORM item.id
    FROM public."OrderItem" AS item
    JOIN public."Listing" AS listing ON listing.id = item."listingId"
    JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
   WHERE item."orderId" = locked_order.id
   ORDER BY item.id, listing.id, seller.id
   FOR SHARE OF item, listing, seller;

  SELECT
    pg_catalog.count(DISTINCT seller."userId")::integer,
    pg_catalog.min(seller."userId")
    INTO seller_count, only_seller_user_id
    FROM public."OrderItem" AS item
    JOIN public."Listing" AS listing ON listing.id = item."listingId"
    JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
   WHERE item."orderId" = locked_order.id;

  IF seller_count <> 1
     OR only_seller_user_id IS NULL
     OR locked_case."sellerId" IS DISTINCT FROM only_seller_user_id
     OR locked_case."buyerId" IS DISTINCT FROM locked_order."buyerId"
     OR (
       locked_case."buyerId" IS NOT NULL
       AND locked_case."buyerId" = only_seller_user_id
     ) THEN
    RAISE EXCEPTION 'Case staff-resolution parties are invalid'
      USING ERRCODE = '23514';
  END IF;

  order_total_cents :=
      COALESCE(locked_order."itemsSubtotalCents", 0)::bigint
    + COALESCE(locked_order."shippingAmountCents", 0)::bigint
    + COALESCE(locked_order."giftWrappingPriceCents", 0)::bigint
    + COALESCE(locked_order."taxAmountCents", 0)::bigint;

  IF order_total_cents <= 0
     OR order_total_cents > 2147483647 THEN
    RAISE EXCEPTION 'Case staff-resolution Order total is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF p_resolution = 'REFUND_FULL'::public."CaseResolution" THEN
    IF p_partial_refund_amount_cents IS NOT NULL
       OR p_stock_restore_decision <> '[]'::jsonb THEN
      RAISE EXCEPTION 'Full refund inputs are not canonical'
        USING ERRCODE = '22023';
    END IF;
    refund_amount_cents := order_total_cents::integer;
    IF locked_order."fulfillmentStatus" NOT IN (
         'SHIPPED'::public."FulfillmentStatus",
         'DELIVERED'::public."FulfillmentStatus",
         'PICKED_UP'::public."FulfillmentStatus"
       ) THEN
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'listingId', restorable."listingId",
            'quantity', restorable.quantity
          )
          ORDER BY restorable."listingId"
        ),
        '[]'::jsonb
      )
        INTO stock_restore_plan
        FROM (
          SELECT
            item."listingId",
            pg_catalog.sum(item.quantity)::integer AS quantity
          FROM public."OrderItem" AS item
          JOIN public."Listing" AS listing ON listing.id = item."listingId"
          WHERE item."orderId" = locked_order.id
            AND listing."listingType" = 'IN_STOCK'::public."ListingType"
            AND item.quantity > 0
          GROUP BY item."listingId"
        ) AS restorable;
    END IF;
  ELSIF p_resolution = 'REFUND_PARTIAL'::public."CaseResolution" THEN
    IF p_partial_refund_amount_cents IS NULL
       OR p_partial_refund_amount_cents <= 0
       OR p_partial_refund_amount_cents::bigint > order_total_cents THEN
      RAISE EXCEPTION 'Partial refund amount is invalid'
        USING ERRCODE = '22023';
    END IF;
    refund_amount_cents := p_partial_refund_amount_cents;
    IF p_stock_restore_decision <> '[]'::jsonb
       AND locked_order."fulfillmentStatus" IN (
         'SHIPPED'::public."FulfillmentStatus",
         'DELIVERED'::public."FulfillmentStatus",
         'PICKED_UP'::public."FulfillmentStatus"
       ) THEN
      RAISE EXCEPTION 'Stock cannot be restored after fulfillment'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      WITH requested AS (
        SELECT
          input.value->>'listingId' AS listing_id,
          pg_catalog.sum((input.value->>'quantity')::integer)::integer
            AS quantity
        FROM pg_catalog.jsonb_array_elements(
          p_stock_restore_decision
        ) AS input(value)
        GROUP BY input.value->>'listingId'
      ),
      available AS (
        SELECT
          item."listingId" AS listing_id,
          pg_catalog.sum(item.quantity)::integer AS quantity
        FROM public."OrderItem" AS item
        JOIN public."Listing" AS listing ON listing.id = item."listingId"
        WHERE item."orderId" = locked_order.id
          AND listing."listingType" = 'IN_STOCK'::public."ListingType"
          AND item.quantity > 0
        GROUP BY item."listingId"
      )
      SELECT 1
        FROM requested
        LEFT JOIN available USING (listing_id)
       WHERE available.listing_id IS NULL
          OR requested.quantity > available.quantity
    ) THEN
      RAISE EXCEPTION 'Stock-restoration target or quantity is invalid'
        USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'listingId', requested.listing_id,
          'quantity', requested.quantity
        )
        ORDER BY requested.listing_id
      ),
      '[]'::jsonb
    )
      INTO stock_restore_plan
      FROM (
        SELECT
          input.value->>'listingId' AS listing_id,
          pg_catalog.sum((input.value->>'quantity')::integer)::integer
            AS quantity
        FROM pg_catalog.jsonb_array_elements(
          p_stock_restore_decision
        ) AS input(value)
        GROUP BY input.value->>'listingId'
      ) AS requested;
  ELSE
    IF p_partial_refund_amount_cents IS NOT NULL
       OR p_stock_restore_decision <> '[]'::jsonb THEN
      RAISE EXCEPTION 'Dismissal inputs are not canonical'
        USING ERRCODE = '22023';
    END IF;
    refund_amount_cents := NULL;
  END IF;

  IF locked_order."caseResolutionClaimId" IS NOT NULL THEN
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
      claim."orderPaymentEventId"
      INTO existing_claim
      FROM public."CaseResolutionClaim" AS claim
     WHERE claim.id = locked_order."caseResolutionClaimId"
     FOR SHARE;
    existing_found := FOUND;
    -- #678: a current ADMIN may take over a staged dismissal (no provider
    -- effect) whose preparing staff member is no longer active staff or is a
    -- party of the Case (pre-#677 claim). Only the identical DISMISSED
    -- request is accepted; the claim itself stays immutable.
    IF existing_found
       AND existing_claim."staffActorId" IS DISTINCT FROM locked_actor.id
       AND locked_actor.role = 'ADMIN'::public."Role"
       AND existing_claim.resolution = 'DISMISSED'::public."CaseResolution"
       AND existing_claim.status =
             'LOCAL_READY'::public."CaseResolutionClaimStatus"
       AND p_resolution = 'DISMISSED'::public."CaseResolution" THEN
      dismissal_takeover :=
        existing_claim."staffActorId" IS NOT DISTINCT FROM locked_case."sellerId"
        OR existing_claim."staffActorId" IS NOT DISTINCT FROM locked_case."buyerId"
        OR NOT EXISTS (
          SELECT 1
            FROM public."User" AS original_staff
           WHERE original_staff.id = existing_claim."staffActorId"
             AND NOT original_staff.banned
             AND original_staff."deletedAt" IS NULL
             AND original_staff.role IN (
               'EMPLOYEE'::public."Role",
               'ADMIN'::public."Role"
             )
        );
    END IF;
    IF NOT existing_found
       OR existing_claim."caseId" IS DISTINCT FROM locked_case.id
       OR existing_claim."orderId" IS DISTINCT FROM locked_order.id
       OR (
         existing_claim."staffActorId" IS DISTINCT FROM locked_actor.id
         AND NOT dismissal_takeover
       )
       OR existing_claim.resolution IS DISTINCT FROM p_resolution
       OR existing_claim."refundAmountCents"
            IS DISTINCT FROM refund_amount_cents
       OR existing_claim.currency
            IS DISTINCT FROM pg_catalog.lower(locked_order.currency)
       OR existing_claim."stockRestorePlan"
            IS DISTINCT FROM stock_restore_plan THEN
      RAISE EXCEPTION 'A different Case resolution claim is active'
        USING ERRCODE = '23505';
    END IF;

    IF existing_claim.status =
         'PROVIDER_PENDING'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution NOT IN (
           'REFUND_FULL'::public."CaseResolution",
           'REFUND_PARTIAL'::public."CaseResolution"
         )
         OR locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
         OR locked_order."sellerRefundLockedAt" IS NULL
         OR existing_claim."orderPaymentEventId" IS NOT NULL
         OR locked_order."stripePaymentIntentId" IS NULL
         OR pg_catalog.btrim(locked_order."stripePaymentIntentId") = ''
         OR locked_order."labelStatus" = 'PURCHASED'::public."LabelStatus"
         OR locked_order."labelClaimStatus" IN (
           'PROVIDER_PENDING',
           'PROVIDER_AMBIGUOUS',
           'PROVIDER_RECORDED'
         )
         OR locked_order."paymentOpenDisputeBlocked"
         OR EXISTS (
           SELECT 1
             FROM public."OrderPaymentEvent" AS refund_event
            WHERE refund_event."orderId" = locked_order.id
              AND refund_event."eventType" = 'REFUND'
              AND (
                refund_event.status IS NULL
                OR pg_catalog.lower(refund_event.status)
                     NOT IN ('failed', 'canceled', 'cancelled')
              )
         ) THEN
        RAISE EXCEPTION
          'Case staff-resolution replay is no longer refund-eligible'
          USING ERRCODE = '23514';
      END IF;
    ELSIF existing_claim.status =
            'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution NOT IN (
           'REFUND_FULL'::public."CaseResolution",
           'REFUND_PARTIAL'::public."CaseResolution"
         )
         OR existing_claim."orderPaymentEventId" IS NULL
         OR locked_order."sellerRefundId" IS NULL
         OR locked_order."sellerRefundId" = 'pending'
         OR locked_order."sellerRefundLockedAt" IS NOT NULL THEN
        RAISE EXCEPTION
          'Case staff-resolution recorded replay evidence is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSIF existing_claim.status =
            'LOCAL_READY'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution <>
           'DISMISSED'::public."CaseResolution"
         OR existing_claim."orderPaymentEventId" IS NOT NULL
         OR locked_order."sellerRefundId" IS NOT NULL
         OR locked_order."sellerRefundLockedAt" IS NOT NULL THEN
        RAISE EXCEPTION
          'Case staff-resolution local replay evidence is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSIF existing_claim.status =
            'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution NOT IN (
           'REFUND_FULL'::public."CaseResolution",
           'REFUND_PARTIAL'::public."CaseResolution"
         )
         OR existing_claim."orderPaymentEventId" IS NOT NULL
         OR locked_order."sellerRefundId" IS DISTINCT FROM
              'ambiguous_refund_pending_reconciliation'
         OR locked_order."sellerRefundLockedAt" IS NOT NULL THEN
        RAISE EXCEPTION
          'Case staff-resolution reconciliation replay evidence is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Case staff-resolution replay status is invalid'
        USING ERRCODE = '23514';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'claimId', existing_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'buyerUserId', locked_case."buyerId",
      'sellerUserId', locked_case."sellerId",
      'resolution', existing_claim.resolution::text,
      'refundAmountCents', existing_claim."refundAmountCents",
      'currency', existing_claim.currency,
      'stockRestorePlan', existing_claim."stockRestorePlan",
      'status', existing_claim.status::text,
      'idempotencyScope', existing_claim."idempotencyScope",
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
     OR EXISTS (
       SELECT 1
         FROM public."OrderPaymentEvent" AS refund_event
        WHERE refund_event."orderId" = locked_order.id
          AND refund_event."eventType" = 'REFUND'
          AND (
            refund_event.status IS NULL
            OR pg_catalog.lower(refund_event.status)
                 NOT IN ('failed', 'canceled', 'cancelled')
          )
     ) THEN
    RAISE EXCEPTION 'Case staff-resolution Order has refund activity'
      USING ERRCODE = '23514';
  END IF;

  IF p_resolution IN (
       'REFUND_FULL'::public."CaseResolution",
       'REFUND_PARTIAL'::public."CaseResolution"
     ) THEN
    IF locked_order."stripePaymentIntentId" IS NULL
       OR pg_catalog.btrim(locked_order."stripePaymentIntentId") = ''
       OR locked_order."labelStatus" =
            'PURCHASED'::public."LabelStatus"
       OR locked_order."labelClaimStatus" IN (
         'PROVIDER_PENDING',
         'PROVIDER_AMBIGUOUS',
         'PROVIDER_RECORDED'
       )
       OR locked_order."paymentOpenDisputeBlocked"
       OR EXISTS (
         SELECT 1
           FROM (
             SELECT DISTINCT ON (
               COALESCE(dispute_event."stripeObjectId", dispute_event.id)
             )
               dispute_event.status
             FROM public."OrderPaymentEvent" AS dispute_event
             WHERE dispute_event."orderId" = locked_order.id
               AND dispute_event."eventType" = 'DISPUTE'
             ORDER BY
               COALESCE(dispute_event."stripeObjectId", dispute_event.id),
               COALESCE(
                 NULLIF(
                   dispute_event.metadata->>'stripeEventCreated',
                   ''
                 )::bigint,
                 EXTRACT(
                   epoch FROM dispute_event."createdAt"
                 )::bigint
               ) DESC,
               dispute_event."createdAt" DESC,
               dispute_event.id DESC
           ) AS latest_dispute
          WHERE latest_dispute.status IS NULL
             OR pg_catalog.lower(latest_dispute.status) NOT IN (
               'won',
               'lost',
               'prevented',
               'warning_closed'
             )
       ) THEN
      RAISE EXCEPTION 'Case staff-resolution refund is not eligible'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
  claim_id :=
    'case_resolution_claim_' || pg_catalog.gen_random_uuid()::text;
  IF refund_amount_cents IS NULL THEN
    claim_status := 'LOCAL_READY'::public."CaseResolutionClaimStatus";
    idempotency_scope := NULL;
  ELSE
    claim_status := 'PROVIDER_PENDING'::public."CaseResolutionClaimStatus";
    idempotency_scope :=
      'case-resolve:' || claim_id || ':' || p_resolution::text || ':'
      || refund_amount_cents::text;
  END IF;

  INSERT INTO public."CaseResolutionClaim" (
    id,
    "caseId",
    "orderId",
    "staffActorId",
    resolution,
    "refundAmountCents",
    currency,
    "stockRestorePlan",
    status,
    "idempotencyScope",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    claim_id,
    locked_case.id,
    locked_order.id,
    locked_actor.id,
    p_resolution,
    refund_amount_cents,
    pg_catalog.lower(locked_order.currency),
    stock_restore_plan,
    claim_status,
    idempotency_scope,
    transition_at,
    transition_at
  );

  UPDATE public."Order" AS orders
     SET "caseResolutionClaimId" = claim_id,
         "sellerRefundId" = CASE
           WHEN refund_amount_cents IS NULL THEN orders."sellerRefundId"
           ELSE 'pending'
         END,
         "sellerRefundLockedAt" = CASE
           WHEN refund_amount_cents IS NULL THEN orders."sellerRefundLockedAt"
           ELSE transition_at
         END
   WHERE orders.id = locked_order.id
     AND orders."caseResolutionClaimId" IS NULL
     AND orders."sellerRefundId" IS NULL
     AND orders."sellerRefundLockedAt" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case staff-resolution lease acquisition failed'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'claimId', claim_id,
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'resolution', p_resolution::text,
    'refundAmountCents', refund_amount_cents,
    'currency', pg_catalog.lower(locked_order.currency),
    'stockRestorePlan', stock_restore_plan,
    'status', claim_status::text,
    'idempotencyScope', idempotency_scope,
    'paymentIntentId', locked_order."stripePaymentIntentId",
    'itemsSubtotalCents', locked_order."itemsSubtotalCents",
    'shippingAmountCents', locked_order."shippingAmountCents",
    'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
    'taxAmountCents', locked_order."taxAmountCents",
    'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
    'action', 'prepared'
  );
END
$function$
;

-- ===================================================================
-- grainline_case_staff_resolution_provider_recover(text,text,text,bigint,text)
-- #677: #677 party guard before the RETRY/DISCOVERED authorization (precedes the Stripe call)
-- ===================================================================
CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_provider_recover(p_actor_user_id text, p_resolution_claim_id text, p_recovery_action text, p_provider_inspected_at_seconds bigint, p_provider_evidence_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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

  -- #605/#677 separation of duties: staff who are this Case's buyer or
  -- seller may not recover it. Runs before any provider call.
  IF locked_actor.id = locked_case."sellerId"
     OR locked_actor.id IS NOT DISTINCT FROM locked_case."buyerId" THEN
    RAISE EXCEPTION 'Case staff-resolution actor is a Case party'
      USING ERRCODE = '42501';
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
$function$
;

-- ===================================================================
-- grainline_case_staff_resolution_provider_recovery_load(text,text,"CaseResolution",integer)
-- #677: #677 party guard (load precedes the route Stripe inspection/retry)
-- ===================================================================
CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_provider_recovery_load(p_actor_user_id text, p_case_id text, p_resolution "CaseResolution", p_partial_refund_amount_cents integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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

  -- #605/#677 separation of duties: staff who are this Case's buyer or
  -- seller may not recover it. Runs before any provider call.
  IF locked_actor.id = locked_case."sellerId"
     OR locked_actor.id IS NOT DISTINCT FROM locked_case."buyerId" THEN
    RAISE EXCEPTION 'Case staff-resolution actor is a Case party'
      USING ERRCODE = '42501';
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
$function$
;

-- ===================================================================
-- grainline_case_staff_resolution_reconcile(text,text,text,text)
-- #665 #677 #15: #677 read Case parties; #677 party guard; #665 read the claim provider clock; #665 retry only inside the 23-hour idempotency window; #665/#15 NULL-safe release predicate and 25-hour release floor
-- ===================================================================
CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_reconcile(p_actor_user_id text, p_resolution_claim_id text, p_reconciliation_action text, p_reconciliation_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  locked_claim record;
  transition_at timestamp(3);
  audit_id text;
  normalized_reason text;
BEGIN
  normalized_reason := pg_catalog.btrim(p_reconciliation_reason);
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_resolution_claim_id IS NULL
     OR pg_catalog.btrim(p_resolution_claim_id) = ''
     OR pg_catalog.char_length(p_resolution_claim_id) > 191
     OR p_reconciliation_action IS NULL
     OR p_reconciliation_action NOT IN (
       'RETRY_EXISTING_SCOPE',
       'CONFIRMED_NO_PROVIDER_EFFECT'
     )
     OR normalized_reason IS NULL
     OR normalized_reason = ''
     OR pg_catalog.char_length(normalized_reason) > 1000 THEN
    RAISE EXCEPTION 'Case reconciliation input is invalid'
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
    RAISE EXCEPTION 'Case reconciliation requires a current ADMIN'
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
    orders."sellerRefundLockedAt",
    orders."labelStatus",
    orders."labelClaimStatus"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case reconciliation Order does not exist'
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
    RAISE EXCEPTION 'Case reconciliation Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  -- #605/#677 separation of duties: staff who are this Case's buyer or
  -- seller may not reconcile it. Runs before any provider call.
  IF locked_actor.id = locked_case."sellerId"
     OR locked_actor.id IS NOT DISTINCT FROM locked_case."buyerId" THEN
    RAISE EXCEPTION 'Case staff-resolution actor is a Case party'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    claim.id,
    claim."caseId",
    claim."orderId",
    claim.status,
    claim."idempotencyScope",
    claim."orderPaymentEventId",
    claim."createdAt",
    claim."providerRecoveryAuthorizedAt"
    INTO locked_claim
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id
     AND claim."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_claim."caseId" IS DISTINCT FROM locked_case.id
     OR locked_order."caseResolutionClaimId"
          IS DISTINCT FROM locked_claim.id
     OR locked_claim."orderPaymentEventId" IS NOT NULL THEN
    RAISE EXCEPTION 'Case reconciliation claim authority is invalid'
      USING ERRCODE = '23514';
  END IF;

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
  audit_id :=
    'case-resolution-reconcile-audit:'
    || pg_catalog.gen_random_uuid()::text;

  IF p_reconciliation_action = 'RETRY_EXISTING_SCOPE' THEN
    IF locked_claim.status <>
         'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
       OR transition_at >= locked_claim."createdAt" + INTERVAL '23 hours'
       OR locked_order."sellerRefundId" <>
            'ambiguous_refund_pending_reconciliation'
       OR locked_case.status IN (
         'RESOLVED'::public."CaseStatus",
         'CLOSED'::public."CaseStatus"
       )
       OR locked_case."resolvedAt" IS NOT NULL
       OR locked_order."labelStatus" =
            'PURCHASED'::public."LabelStatus"
       OR locked_order."labelClaimStatus" IN (
         'PROVIDER_PENDING',
         'PROVIDER_AMBIGUOUS',
         'PROVIDER_RECORDED'
       ) THEN
      RAISE EXCEPTION 'Case reconciliation claim is not retryable'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public."Order" AS orders
       SET "sellerRefundId" = 'pending',
           "sellerRefundLockedAt" = transition_at,
           "reviewNeeded" = true,
           "reviewNote" =
             'Staff approved retry with the existing Case refund '
             || 'idempotency scope.'
     WHERE orders.id = locked_order.id
       AND orders."caseResolutionClaimId" = locked_claim.id
       AND orders."sellerRefundId" =
             'ambiguous_refund_pending_reconciliation';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case reconciliation retry lease was lost'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public."CaseResolutionClaim" AS claim
       SET status =
             'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
           "updatedAt" = transition_at
     WHERE claim.id = locked_claim.id
       AND claim.status =
             'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case reconciliation retry transition failed'
        USING ERRCODE = '40001';
    END IF;

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
      locked_actor.id,
      'RETRY_CASE_RESOLUTION_PROVIDER_SCOPE',
      'CASE_RESOLUTION_CLAIM',
      locked_claim.id,
      normalized_reason,
      pg_catalog.jsonb_build_object(
        'caseId', locked_case.id,
        'orderId', locked_order.id,
        'idempotencyScope', locked_claim."idempotencyScope"
      ),
      false,
      transition_at
    );

    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'idempotencyScope', locked_claim."idempotencyScope",
      'status', 'PROVIDER_PENDING',
      'action', 'retry'
    );
  END IF;

  IF locked_claim.status NOT IN (
       'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
       'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
     )
     OR COALESCE(locked_order."sellerRefundId", '') NOT IN (
       'pending',
       'ambiguous_refund_pending_reconciliation'
     ) THEN
    RAISE EXCEPTION 'Case reconciliation claim cannot be released'
      USING ERRCODE = '23514';
  END IF;

  -- #665: a no-effect release lets the next prepare mint a NEW idempotency
  -- scope. Mirror grainline_order_refund_reconcile: release only once the
  -- claim scope's last authorization is at least 25 hours old.
  IF transition_at < GREATEST(
       locked_claim."createdAt",
       COALESCE(
         locked_claim."providerRecoveryAuthorizedAt",
         locked_claim."createdAt"
       )
     ) + INTERVAL '25 hours' THEN
    RAISE EXCEPTION 'Case reconciliation release is not yet safe'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public."CaseResolutionClaim" AS claim
     SET status =
           'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus",
         "reconciledAt" = transition_at,
         "reconciledById" = locked_actor.id,
         "reconciliationAction" = 'CONFIRMED_NO_PROVIDER_EFFECT',
         "reconciliationReason" = normalized_reason,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim.status IN (
       'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
       'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
     )
     AND claim."orderPaymentEventId" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case reconciliation release transition failed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public."Order" AS orders
     SET "caseResolutionClaimId" = NULL,
         "sellerRefundId" = NULL,
         "sellerRefundLockedAt" = NULL,
         "reviewNeeded" = true,
         "reviewNote" =
           'An administrator confirmed that the staged Case refund had '
           || 'no provider effect; the claim was released.'
   WHERE orders.id = locked_order.id
     AND orders."caseResolutionClaimId" = locked_claim.id
     AND orders."sellerRefundId" IN (
       'pending',
       'ambiguous_refund_pending_reconciliation'
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case reconciliation Order release failed'
      USING ERRCODE = '40001';
  END IF;

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
    locked_actor.id,
    'RELEASE_CASE_RESOLUTION_NO_PROVIDER_EFFECT',
    'CASE_RESOLUTION_CLAIM',
    locked_claim.id,
    normalized_reason,
    pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'idempotencyScope', locked_claim."idempotencyScope"
    ),
    false,
    transition_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'claimId', locked_claim.id,
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'idempotencyScope', locked_claim."idempotencyScope",
    'status', 'RELEASED_NO_PROVIDER_EFFECT',
    'action', 'released'
  );
END
$function$
;

-- ===================================================================
-- grainline_case_mark_resolved(text,text)
-- #655 #624: #655 declare audit prefix; #655/#624 unique audit id per mark (format accepted by caseParticipantResolutionResult.ts); #655 replay reads the actor's latest MARK_CASE_RESOLVED for this Case
-- ===================================================================
CREATE OR REPLACE FUNCTION public.grainline_case_mark_resolved(p_actor_user_id text, p_case_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  existing_audit record;
  actor_is_buyer boolean;
  actor_is_seller boolean;
  next_buyer_marked boolean;
  next_seller_marked boolean;
  next_status public."CaseStatus";
  audit_status text;
  audit_prefix text;
  audit_id text;
  transition_at timestamp(3);
  result_action text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_case_id IS NULL
     OR pg_catalog.btrim(p_case_id) = ''
     OR pg_catalog.char_length(p_case_id) > 191 THEN
    RAISE EXCEPTION 'Case resolution-mark input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.id,
    actor.banned,
    actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case resolution-mark actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT case_row."orderId"
    INTO source_order_id
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution-mark Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."sellerRefundId",
    orders."caseResolutionClaimId"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution-mark Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row.resolution,
    case_row."refundAmountCents",
    case_row."stripeRefundId",
    case_row."buyerMarkedResolved",
    case_row."sellerMarkedResolved",
    case_row."resolvedAt",
    case_row."resolvedById"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id
     AND case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution-mark Case changed Order'
      USING ERRCODE = '40001';
  END IF;

  -- buyerId is nullable for retained legacy Cases. Normalize both comparisons
  -- to strict booleans so NULL can never propagate into the persisted marks.
  actor_is_buyer := COALESCE(
    locked_case."buyerId" = locked_actor.id,
    false
  );
  actor_is_seller := COALESCE(
    locked_case."sellerId" = locked_actor.id,
    false
  );
  IF actor_is_buyer = actor_is_seller THEN
    RAISE EXCEPTION 'Case resolution-mark participant authority is invalid'
      USING ERRCODE = '42501';
  END IF;

  audit_prefix :=
    'case_resolution_mark_'
    || pg_catalog.md5(locked_case.id || ':' || locked_actor.id);
  -- #655: every fresh mark gets its own audit id (prefix:md5(random)), so a
  -- party can mark again after a reply reopened the Case. #624: the id is no
  -- longer predictable, so a planted row cannot block a fresh mark.
  audit_id :=
    audit_prefix || ':'
    || pg_catalog.md5(pg_catalog.gen_random_uuid()::text);

  -- A committed mark may be retried after the response or notification was
  -- lost. Reuse the exact source audit so Notification deduplication remains
  -- stable. During compatible coexistence, recover a legacy committed mark
  -- that predates this deterministic audit identity.
  IF (actor_is_buyer AND locked_case."buyerMarkedResolved")
     OR (actor_is_seller AND locked_case."sellerMarkedResolved") THEN
    SELECT
      audit.id,
      audit."adminId",
      audit.action,
      audit."targetType",
      audit."targetId",
      audit.reason,
      audit.metadata,
      audit.undone
      INTO existing_audit
      FROM public."AdminAuditLog" AS audit
     WHERE audit."targetType" = 'CASE'
       AND audit."targetId" = locked_case.id
       AND audit."adminId" = locked_actor.id
       AND audit.action = 'MARK_CASE_RESOLVED'
       AND (
         audit.id = audit_prefix
         OR pg_catalog.starts_with(audit.id, audit_prefix || ':')
       )
     ORDER BY audit."createdAt" DESC, audit.id DESC
     LIMIT 1
     FOR SHARE;

    IF FOUND THEN
      audit_id := existing_audit.id;
      IF existing_audit."adminId" IS DISTINCT FROM locked_actor.id
         OR existing_audit.action IS DISTINCT FROM 'MARK_CASE_RESOLVED'
         OR existing_audit."targetType" IS DISTINCT FROM 'CASE'
         OR existing_audit."targetId" IS DISTINCT FROM locked_case.id
         OR existing_audit.reason IS NOT NULL
         OR existing_audit.undone
         OR pg_catalog.jsonb_typeof(existing_audit.metadata) <> 'object'
         OR (
           existing_audit.metadata
             - 'actorKind'
             - 'orderId'
             - 'status'
             - 'at'
         ) <> '{}'::jsonb
         OR existing_audit.metadata->>'actorKind' IS DISTINCT FROM 'user'
         OR existing_audit.metadata->>'orderId'
              IS DISTINCT FROM locked_order.id
         OR existing_audit.metadata->>'status' IS NULL
         OR existing_audit.metadata->>'status' NOT IN (
              'PENDING_CLOSE',
              'RESOLVED'
            )
         OR pg_catalog.btrim(
              COALESCE(existing_audit.metadata->>'at', '')
            ) = '' THEN
        RAISE EXCEPTION 'Case resolution-mark replay audit is invalid'
          USING ERRCODE = '23505';
      END IF;
      audit_status := existing_audit.metadata->>'status';
      result_action := 'replay';
    ELSE
      IF locked_case.status = 'PENDING_CLOSE'::public."CaseStatus" THEN
        audit_status := 'PENDING_CLOSE';
      ELSIF locked_case.status = 'RESOLVED'::public."CaseStatus"
            AND locked_case.resolution =
                  'DISMISSED'::public."CaseResolution"
            AND locked_case."buyerMarkedResolved"
            AND locked_case."sellerMarkedResolved"
            AND locked_case."refundAmountCents" IS NULL
            AND locked_case."stripeRefundId" IS NULL
            AND locked_case."resolvedAt" IS NOT NULL THEN
        audit_status := 'RESOLVED';
      ELSE
        RAISE EXCEPTION 'Case resolution-mark replay state is invalid'
          USING ERRCODE = '23514';
      END IF;

      transition_at := pg_catalog.timezone(
        'UTC',
        pg_catalog.clock_timestamp()
      );
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
        locked_actor.id,
        'MARK_CASE_RESOLVED',
        'CASE',
        locked_case.id,
        NULL,
        pg_catalog.jsonb_build_object(
          'actorKind', 'user',
          'orderId', locked_order.id,
          'status', audit_status,
          'at', pg_catalog.to_char(
            transition_at,
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        ),
        false,
        transition_at
      );
      result_action := 'legacy_recovered';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'actorUserId', locked_actor.id,
      'buyerUserId', locked_case."buyerId",
      'sellerUserId', locked_case."sellerId",
      'status', audit_status,
      'buyerMarkedResolved', locked_case."buyerMarkedResolved",
      'sellerMarkedResolved', locked_case."sellerMarkedResolved",
      'auditLogId', audit_id,
      'action', result_action
    );
  END IF;

  IF locked_case.status NOT IN (
       'OPEN'::public."CaseStatus",
       'IN_DISCUSSION'::public."CaseStatus",
       'PENDING_CLOSE'::public."CaseStatus"
     )
     OR locked_case.resolution IS NOT NULL
     OR locked_case."refundAmountCents" IS NOT NULL
     OR locked_case."stripeRefundId" IS NOT NULL
     OR locked_case."resolvedAt" IS NOT NULL
     OR locked_case."resolvedById" IS NOT NULL THEN
    RAISE EXCEPTION 'Case is not eligible for a resolution mark'
      USING ERRCODE = '23514';
  END IF;

  -- A staff dismissal claim may be active without a refund sentinel, while a
  -- refund claim or seller refund also sets sellerRefundId. Both leases must
  -- fence participant state changes.
  IF locked_order."sellerRefundId" IS NOT NULL
     OR locked_order."caseResolutionClaimId" IS NOT NULL THEN
    RAISE EXCEPTION 'Case resolution-mark conflicts with refund or staff state'
      USING ERRCODE = '23505';
  END IF;

  next_buyer_marked :=
    locked_case."buyerMarkedResolved" OR actor_is_buyer;
  next_seller_marked :=
    locked_case."sellerMarkedResolved" OR actor_is_seller;
  next_status := CASE
    WHEN next_buyer_marked AND next_seller_marked
      THEN 'RESOLVED'::public."CaseStatus"
    ELSE 'PENDING_CLOSE'::public."CaseStatus"
  END;
  transition_at := pg_catalog.timezone(
    'UTC',
    pg_catalog.clock_timestamp()
  );

  UPDATE public."Case" AS case_row
     SET "buyerMarkedResolved" = next_buyer_marked,
         "sellerMarkedResolved" = next_seller_marked,
         status = next_status,
         resolution = CASE
           WHEN next_status = 'RESOLVED'::public."CaseStatus"
             THEN 'DISMISSED'::public."CaseResolution"
           ELSE NULL
         END,
         "resolvedAt" = CASE
           WHEN next_status = 'RESOLVED'::public."CaseStatus"
             THEN transition_at
           ELSE NULL
         END,
         "resolvedById" = CASE
           WHEN next_status = 'RESOLVED'::public."CaseStatus"
             THEN locked_actor.id
           ELSE NULL
         END,
         "updatedAt" = transition_at
   WHERE case_row.id = locked_case.id
     AND case_row."orderId" = locked_order.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution-mark update lost its locked target'
      USING ERRCODE = '40001';
  END IF;

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
    locked_actor.id,
    'MARK_CASE_RESOLVED',
    'CASE',
    locked_case.id,
    NULL,
    pg_catalog.jsonb_build_object(
      'actorKind', 'user',
      'orderId', locked_order.id,
      'status', next_status::text,
      'at', pg_catalog.to_char(
        transition_at,
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ),
    false,
    transition_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'actorUserId', locked_actor.id,
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'status', next_status::text,
    'buyerMarkedResolved', next_buyer_marked,
    'sellerMarkedResolved', next_seller_marked,
    'auditLogId', audit_id,
    'action', 'updated'
  );
END
$function$
;

-- ===================================================================
-- grainline_case_reply(text,text,text,text[])
-- #680 #657: #680 declare source order; #680 take Order KEY SHARE before the Case (canonical User -> Order -> Case); #680 bind the locked Case to the locked Order; #657 a party duplicate cannot replay into PENDING_CLOSE
-- ===================================================================
CREATE OR REPLACE FUNCTION public.grainline_case_reply(p_actor_user_id text, p_case_id text, p_body text, p_direct_upload_ids text[] DEFAULT ARRAY[]::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  locked_actor record;
  locked_case record;
  duplicate_message record;
  upload record;
  attachment record;
  normalized_upload_ids text[];
  attachment_results jsonb := '[]'::jsonb;
  transition_at timestamp(3);
  duplicate_cutoff timestamp(3);
  target_message_id text;
  target_attachment_id text;
  actor_kind public."CaseMessageAuthorKind";
  actor_is_party boolean;
  actor_acts_as_staff boolean;
  resulting_status public."CaseStatus";
  duplicate_key text;
  source_order_id text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_case_id IS NULL
     OR pg_catalog.btrim(p_case_id) = ''
     OR pg_catalog.char_length(p_case_id) > 191
     OR p_body IS NULL
     OR p_body IS DISTINCT FROM pg_catalog.btrim(p_body)
     OR pg_catalog.char_length(p_body) < 1
     OR pg_catalog.char_length(p_body) > 5000
     OR pg_catalog.octet_length(p_body) > 20000
     OR p_direct_upload_ids IS NULL
     OR pg_catalog.array_ndims(p_direct_upload_ids) > 1
     OR COALESCE(
          pg_catalog.array_length(p_direct_upload_ids, 1),
          0
        ) > 4 THEN
    RAISE EXCEPTION 'Case-reply input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(value ORDER BY value),
           ARRAY[]::text[]
         )
    INTO normalized_upload_ids
    FROM pg_catalog.unnest(p_direct_upload_ids) AS value;
  IF EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(normalized_upload_ids) AS value
        WHERE value IS NULL
           OR value = ''
           OR pg_catalog.char_length(value) > 191
     )
     OR COALESCE(
          pg_catalog.array_length(normalized_upload_ids, 1),
          0
        ) <> (
          SELECT pg_catalog.count(DISTINCT value)::integer
            FROM pg_catalog.unnest(normalized_upload_ids) AS value
        ) THEN
    RAISE EXCEPTION 'Case-reply upload identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.id,
    actor.role,
    actor.banned,
    actor."deletedAt",
    actor."clerkId"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case-reply actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  -- #680: the CaseMessage thread trigger re-updates this Case row, whose
  -- foreign-key re-check takes KEY SHARE on the Order. Take it first so the
  -- order matches mark-resolved, escalation and staff finalization.
  SELECT case_row."orderId"
    INTO source_order_id
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case-reply Case does not exist'
      USING ERRCODE = '23503';
  END IF;
  PERFORM 1
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR KEY SHARE;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row."discussionStartedAt",
    case_row."escalateUnlocksAt",
    case_row."buyerMarkedResolved",
    case_row."sellerMarkedResolved",
    buyer.banned AS buyer_banned,
    buyer."deletedAt" AS buyer_deleted_at,
    seller.banned AS seller_banned,
    seller."deletedAt" AS seller_deleted_at
    INTO locked_case
    FROM public."Case" AS case_row
    LEFT JOIN public."User" AS buyer ON buyer.id = case_row."buyerId"
    LEFT JOIN public."User" AS seller ON seller.id = case_row."sellerId"
   WHERE case_row.id = p_case_id
     AND case_row."orderId" = source_order_id
   FOR UPDATE OF case_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case-reply Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  actor_is_party :=
    locked_actor.id = locked_case."buyerId"
    OR locked_actor.id = locked_case."sellerId";
  actor_acts_as_staff :=
    NOT actor_is_party
    AND locked_actor.role IN (
      'EMPLOYEE'::public."Role",
      'ADMIN'::public."Role"
    );
  IF NOT actor_is_party AND NOT actor_acts_as_staff THEN
    RAISE EXCEPTION 'Case-reply actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF (
       actor_acts_as_staff
       AND locked_case.status NOT IN (
         'OPEN'::public."CaseStatus",
         'IN_DISCUSSION'::public."CaseStatus",
         'PENDING_CLOSE'::public."CaseStatus",
         'UNDER_REVIEW'::public."CaseStatus"
       )
     )
     OR (
       NOT actor_acts_as_staff
       AND locked_case.status NOT IN (
         'OPEN'::public."CaseStatus",
         'IN_DISCUSSION'::public."CaseStatus",
         'PENDING_CLOSE'::public."CaseStatus"
       )
     ) THEN
    RAISE EXCEPTION 'Case-reply Case is closed'
      USING ERRCODE = '23514';
  END IF;

  IF NOT actor_acts_as_staff THEN
    IF locked_actor.id = locked_case."buyerId" THEN
      IF locked_case."sellerId" IS NULL THEN
        RAISE EXCEPTION 'Case-reply recipient is missing'
          USING ERRCODE = '23514';
      ELSIF locked_case.seller_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Case-reply recipient is deleted'
          USING ERRCODE = '23514';
      ELSIF locked_case.seller_banned THEN
        RAISE EXCEPTION 'Case-reply recipient is suspended'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF locked_case."buyerId" IS NULL THEN
        RAISE EXCEPTION 'Case-reply recipient is missing'
          USING ERRCODE = '23514';
      ELSIF locked_case.buyer_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Case-reply recipient is deleted'
          USING ERRCODE = '23514';
      ELSIF locked_case.buyer_banned THEN
        RAISE EXCEPTION 'Case-reply recipient is suspended'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  actor_kind := CASE
    WHEN locked_actor.id = locked_case."buyerId"
      THEN 'BUYER'::public."CaseMessageAuthorKind"
    WHEN locked_actor.id = locked_case."sellerId"
      THEN 'SELLER'::public."CaseMessageAuthorKind"
    ELSE 'STAFF'::public."CaseMessageAuthorKind"
  END;
  transition_at := pg_catalog.timezone(
    'UTC',
    pg_catalog.clock_timestamp()
  );
  duplicate_cutoff := transition_at - INTERVAL '30 seconds';
  duplicate_key := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        locked_case.id
          || ':' || locked_actor.id
          || ':' || p_body
          || ':' || pg_catalog.array_to_string(
            normalized_upload_ids,
            ','
          ),
        'UTF8'
      )
    ),
    'hex'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-reply:' || duplicate_key,
      0
    )
  );

  SELECT
    message.id,
    message."createdAt",
    message."authorKind"
    INTO duplicate_message
    FROM public."CaseMessage" AS message
   WHERE message."caseId" = locked_case.id
     AND message."authorId" = locked_actor.id
     AND message.body = p_body
     AND message."createdAt" >= duplicate_cutoff
     -- #657: a party reply always leaves the Case OPEN/IN_DISCUSSION, so a
     -- duplicate seen while the Case is PENDING_CLOSE predates the other
     -- party's mark. Record the retry as a new reply that reopens the Case.
     AND NOT (
       COALESCE(actor_is_party, false)
       AND locked_case.status = 'PENDING_CLOSE'::public."CaseStatus"
     )
     AND (
       SELECT COALESCE(
                pg_catalog.array_agg(
                  row."directUploadId"
                  ORDER BY row."directUploadId"
                ),
                ARRAY[]::text[]
              )
         FROM public."CaseMessageAttachment" AS row
        WHERE row."caseMessageId" = message.id
     ) = normalized_upload_ids
   ORDER BY message."createdAt" DESC, message.id DESC
   LIMIT 1
   FOR SHARE OF message;

  IF FOUND THEN
    SELECT COALESCE(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'id', row.id,
                 'contentType', row."contentType",
                 'byteSize', row."byteSize",
                 'createdAt', pg_catalog.to_char(
                   row."createdAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 )
               )
               ORDER BY row."createdAt", row.id
             ),
             '[]'::jsonb
           )
      INTO attachment_results
      FROM public."CaseMessageAttachment" AS row
     WHERE row."caseMessageId" = duplicate_message.id;
    RETURN pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'orderId', locked_case."orderId",
      'buyerUserId', locked_case."buyerId",
      'sellerUserId', locked_case."sellerId",
      'messageId', duplicate_message.id,
      'authorUserId', locked_actor.id,
      'authorKind', duplicate_message."authorKind"::text,
      'status', locked_case.status::text,
      'actsAsStaff', actor_acts_as_staff,
      'createdAt', pg_catalog.to_char(
        duplicate_message."createdAt",
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'attachments', attachment_results,
      'action', 'replay'
    );
  END IF;

  IF COALESCE(
       pg_catalog.array_length(normalized_upload_ids, 1),
       0
     ) > 0 THEN
    FOR upload IN
      SELECT
        row.id,
        row.key,
        row."userId",
        row.endpoint,
        row."publicUrl",
        row."storageClass",
        row."contentType",
        row."expectedSize",
        row.status,
        row."verifiedAt"
        FROM public."DirectUpload" AS row
       WHERE row.id = ANY (normalized_upload_ids)
       ORDER BY row.id
       FOR UPDATE
    LOOP
      IF upload."userId" IS DISTINCT FROM locked_actor.id
         OR upload.endpoint IS DISTINCT FROM 'caseEvidenceImage'
         OR upload."publicUrl" IS NOT NULL
         OR upload."storageClass" IS DISTINCT FROM 'PRIVATE'
         OR upload.status IS DISTINCT FROM 'VERIFIED'
         OR upload."verifiedAt" IS NULL
         OR upload."contentType" NOT IN (
           'image/jpeg',
           'image/png',
           'image/webp'
         )
         OR upload."expectedSize" <= 0
         OR upload."expectedSize" > 8388608
         OR pg_catalog.split_part(upload.key, '/', 1)
              IS DISTINCT FROM 'caseEvidenceImage'
         OR pg_catalog.split_part(upload.key, '/', 3)
              IS DISTINCT FROM locked_case.id
         OR pg_catalog.split_part(upload.key, '/', 4) = ''
         OR pg_catalog.split_part(upload.key, '/', 5) <> '' THEN
        RAISE EXCEPTION 'Case-reply upload authority is invalid'
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
    IF (
      SELECT pg_catalog.count(*)::integer
        FROM public."DirectUpload" AS row
       WHERE row.id = ANY (normalized_upload_ids)
    ) <> pg_catalog.array_length(normalized_upload_ids, 1) THEN
      RAISE EXCEPTION 'Case-reply upload does not exist'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  resulting_status := locked_case.status;
  IF locked_case.status = 'OPEN'::public."CaseStatus"
     AND locked_actor.id = locked_case."sellerId" THEN
    resulting_status := 'IN_DISCUSSION'::public."CaseStatus";
    UPDATE public."Case"
       SET status = resulting_status,
           "discussionStartedAt" = transition_at,
           "escalateUnlocksAt" =
             transition_at + INTERVAL '48 hours',
           "updatedAt" = transition_at
     WHERE id = locked_case.id;
  ELSIF locked_case.status = 'PENDING_CLOSE'::public."CaseStatus"
        AND actor_is_party THEN
    resulting_status := 'IN_DISCUSSION'::public."CaseStatus";
    UPDATE public."Case"
       SET status = resulting_status,
           "buyerMarkedResolved" = false,
           "sellerMarkedResolved" = false,
           "updatedAt" = transition_at
     WHERE id = locked_case.id;
  ELSE
    UPDATE public."Case"
       SET "updatedAt" = transition_at
     WHERE id = locked_case.id;
  END IF;

  target_message_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."CaseMessage" (
    id,
    "caseId",
    "authorId",
    "authorKind",
    body,
    "createdAt"
  )
  VALUES (
    target_message_id,
    locked_case.id,
    locked_actor.id,
    actor_kind,
    p_body,
    transition_at
  );

  FOR upload IN
    SELECT
      row.id,
      row.key,
      row."contentType",
      row."expectedSize"
      FROM public."DirectUpload" AS row
     WHERE row.id = ANY (normalized_upload_ids)
     ORDER BY row.id
  LOOP
    target_attachment_id := pg_catalog.gen_random_uuid()::text;
    INSERT INTO public."CaseMessageAttachment" (
      id,
      "caseMessageId",
      "uploaderId",
      "directUploadId",
      "contentType",
      "byteSize",
      "createdAt"
    )
    VALUES (
      target_attachment_id,
      target_message_id,
      locked_actor.id,
      upload.id,
      upload."contentType",
      upload."expectedSize",
      transition_at
    );
    attachment_results := attachment_results
      || pg_catalog.jsonb_build_array(
           pg_catalog.jsonb_build_object(
             'id', target_attachment_id,
             'contentType', upload."contentType",
             'byteSize', upload."expectedSize",
             'createdAt', pg_catalog.to_char(
               transition_at,
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           )
         );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'caseId', locked_case.id,
    'orderId', locked_case."orderId",
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'messageId', target_message_id,
    'authorUserId', locked_actor.id,
    'authorKind', actor_kind::text,
    'status', resulting_status::text,
    'actsAsStaff', actor_acts_as_staff,
    'createdAt', pg_catalog.to_char(
      transition_at,
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'attachments', attachment_results,
    'action', 'created'
  );
END
$function$
;

-- ===================================================================
-- grainline_seller_refund_claim(text,text)
-- #679: #679 User row lock NO KEY UPDATE (foreign-key KEY SHARE checks no longer wait on it); #679 no SellerProfile row lock (ownership is revalidated under the Order lock)
-- ===================================================================
CREATE OR REPLACE FUNCTION public.grainline_seller_refund_claim(p_actor_user_id text, p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
   FOR NO KEY UPDATE;
  IF NOT FOUND OR locked_actor."deletedAt" IS NOT NULL OR locked_actor.banned THEN
    RAISE EXCEPTION 'Seller refund actor is not active'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT seller.*
    INTO locked_seller
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = locked_actor.id;
  -- #679: no SellerProfile row lock. Case prepare, dispute apply, case open
  -- and Case provider record lock Order before SellerProfile; holding a
  -- SellerProfile lock here while waiting on the Order deadlocked with them.
  -- Ownership (Order.sellerProfileId) is checked under the Order lock below.
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

  transition_at := (
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3);
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
$function$
;

-- ===================================================================
-- grainline_seller_refund_preflight(text,text)
-- #679: #679 User row lock NO KEY UPDATE; #679 no SellerProfile row lock
-- ===================================================================
CREATE OR REPLACE FUNCTION public.grainline_seller_refund_preflight(p_actor_user_id text, p_order_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  locked_actor public."User"%ROWTYPE;
  locked_seller public."SellerProfile"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(p_actor_user_id) NOT BETWEEN 1 AND 191
     OR p_actor_user_id IS DISTINCT FROM pg_catalog.btrim(p_actor_user_id)
     OR p_order_id IS NULL
     OR pg_catalog.char_length(p_order_id) NOT BETWEEN 1 AND 191
     OR p_order_id IS DISTINCT FROM pg_catalog.btrim(p_order_id) THEN
    RAISE EXCEPTION 'Seller refund preflight input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT actor.*
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR NO KEY UPDATE;
  IF NOT FOUND OR locked_actor."deletedAt" IS NOT NULL OR locked_actor.banned THEN
    RETURN 'FORBIDDEN';
  END IF;

  SELECT seller.*
    INTO locked_seller
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = locked_actor.id;
  -- #679: see grainline_seller_refund_claim; ownership is checked under the
  -- Order lock below.
  IF NOT FOUND THEN
    RETURN 'FORBIDDEN';
  END IF;

  SELECT source_order.*
    INTO locked_order
    FROM public."Order" AS source_order
   WHERE source_order.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_order."sellerProfileId" IS DISTINCT FROM locked_seller.id THEN
    RETURN 'NOT_FOUND';
  END IF;

  -- This is the exact predecessor cleanup formerly performed through broad
  -- runtime UPDATE. Modern generation-fenced and Case claims are never aged
  -- out by wall-clock time.
  IF locked_order."sellerRefundId" = 'pending'
     AND locked_order."caseResolutionClaimId" IS NULL
     AND locked_order."refundClaimId" IS NULL
     AND (
       locked_order."sellerRefundLockedAt" IS NULL
       OR locked_order."sellerRefundLockedAt" < source_now - interval '15 minutes'
     ) THEN
    UPDATE public."Order" AS source_order
       SET "sellerRefundId" = NULL,
           "sellerRefundLockedAt" = NULL
     WHERE source_order.id = locked_order.id
       AND source_order."sellerRefundId" = 'pending'
       AND source_order."caseResolutionClaimId" IS NULL
       AND source_order."refundClaimId" IS NULL
       AND (
         source_order."sellerRefundLockedAt" IS NULL
         OR source_order."sellerRefundLockedAt" < source_now - interval '15 minutes'
       )
    RETURNING source_order.* INTO locked_order;
  END IF;

  IF locked_order."paymentOpenDisputeBlocked" THEN
    RETURN 'OPEN_DISPUTE';
  ELSIF locked_order."sellerRefundId" = 'pending' THEN
    RETURN 'PROCESSING';
  ELSIF locked_order."sellerRefundId" =
        'ambiguous_refund_pending_reconciliation' THEN
    RETURN 'AMBIGUOUS';
  ELSIF locked_order."sellerRefundId" IS NOT NULL
        OR locked_order."paymentRefundBlocked" THEN
    RETURN 'RECORDED';
  ELSIF locked_order."labelStatus"::text = 'PURCHASED'
        OR locked_order."labelClaimStatus" IN (
          'PROVIDER_PENDING',
          'PROVIDER_AMBIGUOUS',
          'PROVIDER_RECORDED'
        ) THEN
    RETURN 'LABEL_BLOCKED';
  ELSIF locked_order."stripePaymentIntentId" IS NULL THEN
    RETURN 'NO_PAYMENT';
  ELSIF locked_order."paidAt" IS NULL
        OR locked_order."sellerRefundLockedAt" IS NOT NULL
        OR locked_order."caseResolutionClaimId" IS NOT NULL
        OR locked_order."refundClaimId" IS NOT NULL THEN
    RETURN 'STATE_CHANGED';
  END IF;

  RETURN 'READY';
END
$function$
;

DO $postflight$
DECLARE
  expected jsonb := '{"public.grainline_case_staff_resolution_provider_recovery_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)":"57c98610c90e8fddfed5316a43a1421efc793eb2f4f1e491e0fc27dc64a2f442","public.grainline_case_staff_resolution_recovery_finalize(text,text)":"3fa0b657266a91846b0dd2294d289c8162248ca2a6b6ec07c09be1683fde86b3","public.grainline_case_staff_resolution_finalize(text,text)":"7c0033c9bc26e7f42ebec452e808e4aa8ac1a339710a2f25393ba34173fbd7de","public.grainline_case_staff_resolution_prepare(text,text,public.\"CaseResolution\",integer,jsonb)":"151ee58a079a31f106d43d449d22836fda92183cbe338df3a0f733c80f0ab4b6","public.grainline_case_staff_resolution_provider_recover(text,text,text,bigint,text)":"7ce6bef8ca6bfad7c50918c2905e8bd54aa7b9d872c20015b78cbbfb350b5634","public.grainline_case_staff_resolution_provider_recovery_load(text,text,public.\"CaseResolution\",integer)":"e7a810360957b526a2cbc3e3af74d9bde4dca2bc658fccc4c58008b8c34c7ce5","public.grainline_case_staff_resolution_reconcile(text,text,text,text)":"85f4c1d30b6f2007c68aa97fe79cb89b418cfab94bd710f0f1cffb7c74ac7dc0","public.grainline_case_mark_resolved(text,text)":"c680b8d71d3b5373a93a9b7032b9e181ff79bc6f33ab653ec9360ec724f15ba5","public.grainline_case_reply(text,text,text,text[])":"e98afb35734ea43fe5cdd282c2a2d741d74527ec1c832d8602ffc69d4ae966bb","public.grainline_seller_refund_claim(text,text)":"fe2f69107f70d3fe0a7cac273c3ee422a5957435b19de47d247f730f5d5cdddc","public.grainline_seller_refund_preflight(text,text)":"2e4191c3ed30b6d49c5549a30854d84d5c8fb07626e1dff27bf87f699c3aab66"}'::jsonb;
  item record;
  snap record;
  cur record;
BEGIN
  FOR item IN SELECT key, value #>> '{}' AS sha FROM pg_catalog.jsonb_each(expected) LOOP
    SELECT * INTO snap FROM _case_batch_fn_snapshot WHERE sig = item.key;
    SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS secdef, p.proconfig AS cfg,
           COALESCE(p.proacl::text, '') AS acl,
           pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') AS sha
      INTO cur FROM pg_catalog.pg_proc AS p WHERE p.oid = pg_catalog.to_regprocedure(item.key);
    IF snap.sig IS NULL OR cur.owner IS DISTINCT FROM snap.owner OR cur.secdef IS DISTINCT FROM snap.secdef
       OR cur.cfg IS DISTINCT FROM snap.cfg OR cur.acl IS DISTINCT FROM snap.acl THEN
      RAISE EXCEPTION 'case batch postflight: % owner/definer/config/ACL drifted', item.key;
    END IF;
    IF cur.sha IS DISTINCT FROM item.sha THEN
      RAISE EXCEPTION 'case batch postflight: % successor sha256 % unexpected', item.key, cur.sha;
    END IF;
  END LOOP;
END
$postflight$;

DROP TABLE _case_batch_fn_snapshot;

COMMIT;
