#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CASE_REFUND_PROVIDER_RECOVERY_MIGRATION =
  "20261001070000_prepare_case_refund_provider_recovery";
const CASE_FUNCTION_PREDECESSOR =
  "20260901160000_correct_case_order_invariants";
const CLAIM_TRIGGER_PREDECESSOR =
  "20260729024500_prepare_case_resolution_claim_schema";
const PROVIDER_RECORD = "grainline_case_staff_resolution_provider_record";
const PROVIDER_RECOVERY_RECORD =
  "grainline_case_staff_resolution_provider_recovery_record";
const FINALIZE = "grainline_case_staff_resolution_finalize";
const RECOVERY_FINALIZE =
  "grainline_case_staff_resolution_recovery_finalize";
const CLAIM_TRIGGER = "grainline_case_resolution_claim_immutable";

const PREDECESSOR_HASHES = Object.freeze({
  [PROVIDER_RECORD]:
    "721ab18d24daa5e9c65f77a33c132dc9f5ad5096d366f5fadb5758d301c74af5",
  [FINALIZE]:
    "7b7ff76969a059f6bd4a947a790dc3482d6c1aaabfb14eaf3bafc953b51782c8",
  [CLAIM_TRIGGER]:
    "9406e1a0df5e860711603f4882622d5c4d95cc1274dfd74ed9a8d48f8038a0a8",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stripPatchMarkers(value) {
  return value.replaceAll("\n+", "\n");
}

function replaceExactlyOnce(source, before, after, label) {
  before = stripPatchMarkers(before);
  after = stripPatchMarkers(after);
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label} predecessor text is missing`);
  assert.equal(
    source.indexOf(before, first + before.length),
    -1,
    `${label} predecessor text is ambiguous`,
  );
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceCount(source, before, after, count, label) {
  before = stripPatchMarkers(before);
  after = stripPatchMarkers(after);
  const actual = source.split(before).length - 1;
  assert.equal(actual, count, `${label} predecessor count drifted`);
  return source.replaceAll(before, after);
}

function extractFunctionDefinition(sql, functionName) {
  const marker = `public.${functionName}(`;
  let markerIndex = -1;
  let start = -1;
  while (true) {
    markerIndex = sql.indexOf(marker, markerIndex + 1);
    assert.ok(markerIndex >= 0, `${functionName} marker is missing`);
    start = sql.lastIndexOf("CREATE OR REPLACE FUNCTION", markerIndex);
    if (start >= 0 && markerIndex - start < 160) break;
  }
  assert.ok(start >= 0, `${functionName} definition is missing`);
  const closing = `$${functionName}$;`;
  const end = sql.indexOf(closing, start);
  assert.ok(end >= 0, `${functionName} closing delimiter is missing`);
  return sql.slice(start, end + closing.length);
}

export function extractFunctionSource(definition, functionName) {
  const opening = `AS $${functionName}$`;
  const closing = `$${functionName}$;`;
  const start = definition.indexOf(opening);
  const end = definition.indexOf(closing, start + opening.length);
  assert.ok(start >= 0 && end >= 0, `${functionName} source is missing`);
  return definition.slice(start + opening.length, end);
}

function readPredecessor(rootDirectory, migration) {
  return fs.readFileSync(
    path.join(rootDirectory, "prisma/migrations", migration, "migration.sql"),
    "utf8",
  );
}

function recoveryProviderRecordDefinition(caseSql) {
  let definition = extractFunctionDefinition(caseSql, PROVIDER_RECORD);
  assert.equal(
    sha256(extractFunctionSource(definition, PROVIDER_RECORD)),
    PREDECESSOR_HASHES[PROVIDER_RECORD],
    "Case provider-record predecessor source drifted",
  );
  definition = replaceCount(
    definition,
    PROVIDER_RECORD,
    PROVIDER_RECOVERY_RECORD,
    3,
    "Case provider-record function identity",
  );
  definition = replaceExactlyOnce(
    definition,
    `  locked_claim record;\n  existing_event record;`,
    `  locked_claim record;\n  existing_event record;\n  recovery_audit_id text;`,
    "Case provider-record declarations",
  );
  definition = replaceExactlyOnce(
    definition,
    `     OR p_provider_outcome IS NULL\n     OR p_provider_outcome NOT IN ('RECORDED', 'AMBIGUOUS') THEN`,
    `     OR p_provider_outcome IS DISTINCT FROM 'RECORDED' THEN`,
    "Case recovery provider outcome restriction",
  );
  definition = replaceExactlyOnce(
    definition,
    `     OR locked_actor.role NOT IN (\n       'EMPLOYEE'::public."Role",\n       'ADMIN'::public."Role"\n     ) THEN`,
    `     OR locked_actor.role <> 'ADMIN'::public."Role" THEN`,
    "Case recovery provider ADMIN restriction",
  );
  definition = replaceExactlyOnce(
    definition,
    `    claim."idempotencyScope",\n    claim."orderPaymentEventId"`,
    `    claim."idempotencyScope",\n    claim."orderPaymentEventId",\n    claim."providerRecoveryActorId",\n    claim."providerRecoveryAction",\n    claim."providerRecoveryEvidenceSha256",\n    claim."providerRecoveryInspectedAt",\n    claim."providerRecoveryAuthorizedAt",\n    claim."providerRecoveryRecordedAt",\n    claim."providerRecoveryFinalizedAt"`,
    "Case recovery provider claim projection",
  );
  definition = replaceExactlyOnce(
    definition,
    `     OR locked_claim."staffActorId" IS DISTINCT FROM locked_actor.id\n     OR locked_claim.resolution NOT IN (`,
    `     OR locked_claim."providerRecoveryActorId"\n+          IS DISTINCT FROM locked_actor.id\n+     OR locked_claim."providerRecoveryAuthorizedAt" IS NULL\n+     OR locked_claim."providerRecoveryFinalizedAt" IS NOT NULL\n+     OR locked_claim.resolution NOT IN (`,
    "Case recovery provider delegated authority",
  );
  definition = replaceCount(
    definition,
    "    locked_actor.id,",
    `    locked_claim."staffActorId",`,
    2,
    "Case recovery provider original attribution",
  );
  const finalReturn = definition.lastIndexOf(
    "  RETURN pg_catalog.jsonb_build_object(",
  );
  assert.ok(finalReturn >= 0, "Case provider-record final return is missing");
  const completion = `  UPDATE public."CaseResolutionClaim" AS claim\n+     SET "providerRecoveryRecordedAt" = transition_at,\n+         "updatedAt" = transition_at\n+   WHERE claim.id = locked_claim.id\n+     AND claim."providerRecoveryActorId" = locked_actor.id\n+     AND claim."providerRecoveryRecordedAt" IS NULL\n+     AND claim."providerRecoveryFinalizedAt" IS NULL;\n+  IF NOT FOUND THEN\n+    RAISE EXCEPTION 'Case recovery provider-record lease was lost'\n+      USING ERRCODE = '40001';\n+  END IF;\n+\n+  recovery_audit_id :=\n+    'case-resolution-provider-recovery-record-audit:'\n+    || pg_catalog.gen_random_uuid()::text;\n+  INSERT INTO public."AdminAuditLog" (\n+    id, "adminId", action, "targetType", "targetId", reason,\n+    metadata, undone, "createdAt"\n+  )\n+  VALUES (\n+    recovery_audit_id,\n+    locked_actor.id,\n+    'RECOVER_CASE_RESOLUTION_PROVIDER_RECORD',\n+    'CASE_RESOLUTION_CLAIM',\n+    locked_claim.id,\n+    locked_claim."providerRecoveryAction",\n+    pg_catalog.jsonb_build_object(\n+      'caseId', locked_case.id,\n+      'orderId', locked_order.id,\n+      'originalStaffActorId', locked_claim."staffActorId",\n+      'providerEvidenceSha256',\n+        locked_claim."providerRecoveryEvidenceSha256",\n+      'providerInspectedAt', locked_claim."providerRecoveryInspectedAt",\n+      'stripeRefundId', p_primary_refund_id\n+    ),\n+    false,\n+    transition_at\n+  );\n+\n+`;
  return definition.slice(0, finalReturn) + stripPatchMarkers(completion)
    + definition.slice(finalReturn);
}

function recoveryFinalizeDefinition(caseSql) {
  let definition = extractFunctionDefinition(caseSql, FINALIZE);
  assert.equal(
    sha256(extractFunctionSource(definition, FINALIZE)),
    PREDECESSOR_HASHES[FINALIZE],
    "Case finalization predecessor source drifted",
  );
  definition = replaceCount(
    definition,
    FINALIZE,
    RECOVERY_FINALIZE,
    3,
    "Case finalization function identity",
  );
  definition = replaceExactlyOnce(
    definition,
    `  changed_count integer;`,
    `  changed_count integer;\n  recovery_audit_id text;`,
    "Case recovery finalization declarations",
  );
  definition = replaceExactlyOnce(
    definition,
    `     OR locked_actor.role NOT IN (\n       'EMPLOYEE'::public."Role",\n       'ADMIN'::public."Role"\n     ) THEN`,
    `     OR locked_actor.role <> 'ADMIN'::public."Role" THEN`,
    "Case recovery finalization ADMIN restriction",
  );
  definition = replaceExactlyOnce(
    definition,
    `    claim.status,\n    claim."orderPaymentEventId"`,
    `    claim.status,\n    claim."orderPaymentEventId",\n    claim."providerRecoveryActorId",\n    claim."providerRecoveryAction",\n    claim."providerRecoveryEvidenceSha256",\n    claim."providerRecoveryInspectedAt",\n    claim."providerRecoveryAuthorizedAt",\n    claim."providerRecoveryRecordedAt",\n    claim."providerRecoveryFinalizedAt"`,
    "Case recovery finalization claim projection",
  );
  definition = replaceExactlyOnce(
    definition,
    `     OR locked_claim."staffActorId" IS DISTINCT FROM locked_actor.id THEN`,
    `     OR locked_claim."providerRecoveryActorId"\n+          IS DISTINCT FROM locked_actor.id\n+     OR locked_claim."providerRecoveryAuthorizedAt" IS NULL\n+     OR locked_claim."providerRecoveryRecordedAt" IS NULL THEN`,
    "Case recovery finalization delegated authority",
  );
  definition = replaceExactlyOnce(
    definition,
    `"resolvedById" = locked_actor.id,`,
    `"resolvedById" = locked_claim."staffActorId",`,
    "Case recovery resolved-by attribution",
  );
  definition = replaceCount(
    definition,
    "    locked_actor.id,",
    `    locked_claim."staffActorId",`,
    2,
    "Case recovery finalization original attribution",
  );
  const finalReturn = definition.lastIndexOf(
    "  RETURN pg_catalog.jsonb_build_object(",
  );
  assert.ok(finalReturn >= 0, "Case finalization final return is missing");
  const completion = `  UPDATE public."CaseResolutionClaim" AS claim\n+     SET "providerRecoveryFinalizedAt" = transition_at,\n+         "updatedAt" = transition_at\n+   WHERE claim.id = locked_claim.id\n+     AND claim."providerRecoveryActorId" = locked_actor.id\n+     AND claim."providerRecoveryRecordedAt" IS NOT NULL\n+     AND claim."providerRecoveryFinalizedAt" IS NULL;\n+  IF NOT FOUND THEN\n+    RAISE EXCEPTION 'Case recovery finalization lease was lost'\n+      USING ERRCODE = '40001';\n+  END IF;\n+\n+  recovery_audit_id :=\n+    'case-resolution-provider-recovery-finalize-audit:'\n+    || pg_catalog.gen_random_uuid()::text;\n+  INSERT INTO public."AdminAuditLog" (\n+    id, "adminId", action, "targetType", "targetId", reason,\n+    metadata, undone, "createdAt"\n+  )\n+  VALUES (\n+    recovery_audit_id,\n+    locked_actor.id,\n+    'RECOVER_CASE_RESOLUTION_FINALIZE',\n+    'CASE_RESOLUTION_CLAIM',\n+    locked_claim.id,\n+    locked_claim."providerRecoveryAction",\n+    pg_catalog.jsonb_build_object(\n+      'caseId', locked_case.id,\n+      'orderId', locked_order.id,\n+      'originalStaffActorId', locked_claim."staffActorId",\n+      'providerEvidenceSha256',\n+        locked_claim."providerRecoveryEvidenceSha256",\n+      'providerInspectedAt', locked_claim."providerRecoveryInspectedAt"\n+    ),\n+    false,\n+    transition_at\n+  );\n+\n+`;
  return definition.slice(0, finalReturn) + stripPatchMarkers(completion)
    + definition.slice(finalReturn);
}

function recoveryClaimTriggerDefinition(claimSql) {
  let definition = extractFunctionDefinition(claimSql, CLAIM_TRIGGER);
  assert.equal(
    sha256(extractFunctionSource(definition, CLAIM_TRIGGER)),
    PREDECESSOR_HASHES[CLAIM_TRIGGER],
    "Case claim trigger predecessor source drifted",
  );
  definition = replaceExactlyOnce(
    definition,
    `  IF (\n       OLD."orderPaymentEventId" IS NOT NULL`,
    `  IF OLD."providerRecoveryActorId" IS NOT NULL\n+     AND (\n+       NEW."providerRecoveryActorId"\n+         IS DISTINCT FROM OLD."providerRecoveryActorId"\n+       OR NEW."providerRecoveryAction"\n+         IS DISTINCT FROM OLD."providerRecoveryAction"\n+       OR NEW."providerRecoveryEvidenceSha256"\n+         IS DISTINCT FROM OLD."providerRecoveryEvidenceSha256"\n+       OR NEW."providerRecoveryInspectedAt"\n+         IS DISTINCT FROM OLD."providerRecoveryInspectedAt"\n+       OR NEW."providerRecoveryAuthorizedAt"\n+         IS DISTINCT FROM OLD."providerRecoveryAuthorizedAt"\n+     ) THEN\n+    RAISE EXCEPTION 'CaseResolutionClaim recovery authority is immutable'\n+      USING ERRCODE = '23514';\n+  END IF;\n+\n+  IF OLD."providerRecoveryRecordedAt" IS NOT NULL\n+     AND NEW."providerRecoveryRecordedAt"\n+       IS DISTINCT FROM OLD."providerRecoveryRecordedAt" THEN\n+    RAISE EXCEPTION 'CaseResolutionClaim recovery record is immutable'\n+      USING ERRCODE = '23514';\n+  END IF;\n+  IF OLD."providerRecoveryFinalizedAt" IS NOT NULL\n+     AND NEW."providerRecoveryFinalizedAt"\n+       IS DISTINCT FROM OLD."providerRecoveryFinalizedAt" THEN\n+    RAISE EXCEPTION 'CaseResolutionClaim recovery finalization is immutable'\n+      USING ERRCODE = '23514';\n+  END IF;\n+\n+  IF (\n+       OLD."orderPaymentEventId" IS NOT NULL`,
    "Case recovery claim immutability",
  );
  definition = replaceExactlyOnce(
    definition,
    `    (\n+      OLD.status =\n+        'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"\n+      AND NEW.status IN (\n+        'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",\n+        'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus",\n+        'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"\n+      )\n+    )\n+  ) THEN`,
    `    (\n+      OLD.status =\n+        'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"\n+      AND NEW.status IN (\n+        'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",\n+        'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus",\n+        'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"\n+      )\n+    )\n+    OR\n+    (\n+      OLD.status = NEW.status\n+      AND OLD."providerRecoveryActorId" IS NULL\n+      AND NEW."providerRecoveryActorId" IS NOT NULL\n+      AND NEW."providerRecoveryAction" IS NOT NULL\n+      AND NEW."providerRecoveryEvidenceSha256" IS NOT NULL\n+      AND NEW."providerRecoveryInspectedAt" IS NOT NULL\n+      AND NEW."providerRecoveryAuthorizedAt" IS NOT NULL\n+    )\n+  ) THEN`,
    "Case recovery same-status authorization transition",
  );
  return definition;
}

function recoveryLoadDefinition() {
  return `CREATE OR REPLACE FUNCTION
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
$grainline_case_staff_resolution_provider_recovery_load$;`;
}

function providerClockDefinition() {
  return `CREATE OR REPLACE FUNCTION
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
$grainline_case_staff_resolution_provider_clock$;`;
}

function providerRecoverDefinition() {
  return `CREATE OR REPLACE FUNCTION
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
$grainline_case_staff_resolution_provider_recover$;`;
}

export function buildCaseRefundProviderRecovery(rootDirectory = ROOT) {
  const caseSql = readPredecessor(rootDirectory, CASE_FUNCTION_PREDECESSOR);
  const claimSql = readPredecessor(rootDirectory, CLAIM_TRIGGER_PREDECESSOR);
  const triggerDefinition = recoveryClaimTriggerDefinition(claimSql);
  const loadDefinition = recoveryLoadDefinition();
  const clockDefinition = providerClockDefinition();
  const recoverDefinition = providerRecoverDefinition();
  const recordDefinition = recoveryProviderRecordDefinition(caseSql);
  const finalizeDefinition = recoveryFinalizeDefinition(caseSql);
  const expected = [
    [
      'public.grainline_case_resolution_claim_immutable()',
      sha256(extractFunctionSource(triggerDefinition, CLAIM_TRIGGER)),
      false,
      false,
      'v',
      'u',
    ],
    [
      'public.grainline_case_staff_resolution_provider_recovery_load(text,text,public."CaseResolution",integer)',
      sha256(extractFunctionSource(
        loadDefinition,
        "grainline_case_staff_resolution_provider_recovery_load",
      )),
      true,
      true,
      'v',
      'u',
    ],
    [
      'public.grainline_case_staff_resolution_provider_clock(text,text,text,text,text)',
      sha256(extractFunctionSource(
        clockDefinition,
        "grainline_case_staff_resolution_provider_clock",
      )),
      true,
      true,
      's',
      's',
    ],
    [
      'public.grainline_case_staff_resolution_provider_recover(text,text,text,bigint,text)',
      sha256(extractFunctionSource(
        recoverDefinition,
        "grainline_case_staff_resolution_provider_recover",
      )),
      true,
      true,
      'v',
      'u',
    ],
    [
      'public.grainline_case_staff_resolution_provider_recovery_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)',
      sha256(extractFunctionSource(
        recordDefinition,
        PROVIDER_RECOVERY_RECORD,
      )),
      true,
      true,
      'v',
      'u',
    ],
    [
      'public.grainline_case_staff_resolution_recovery_finalize(text,text)',
      sha256(extractFunctionSource(
        finalizeDefinition,
        RECOVERY_FINALIZE,
      )),
      true,
      true,
      'v',
      'u',
    ],
  ];
  const expectedRows = expected.map(([
    identity,
    hash,
    runtime,
    securityDefiner,
    volatility,
    parallel,
  ]) =>
    `          ('${identity}', '${hash}', ${runtime}, ${securityDefiner}, '${volatility}', '${parallel}')`
  ).join(",\n");

  return `-- Add evidence-bound, cross-admin recovery for an exact staged Case
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
          ('public.${PROVIDER_RECORD}(text,text,text,text,text[],text[],text,integer,boolean,boolean)',
           '${PREDECESSOR_HASHES[PROVIDER_RECORD]}', true, true),
          ('public.${FINALIZE}(text,text)',
           '${PREDECESSOR_HASHES[FINALIZE]}', true, true),
          ('public.${CLAIM_TRIGGER}()',
           '${PREDECESSOR_HASHES[CLAIM_TRIGGER]}', false, false)
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

${triggerDefinition}

${loadDefinition}

${clockDefinition}

${recoverDefinition}

${recordDefinition}

${finalizeDefinition}

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
${expectedRows}
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
`;
}

export function verifyCaseRefundProviderRecoveryBytes(
  rootDirectory = ROOT,
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    CASE_REFUND_PROVIDER_RECOVERY_MIGRATION,
    "migration.sql",
  );
  const expected = buildCaseRefundProviderRecovery(rootDirectory);
  const actual = fs.readFileSync(migrationPath, "utf8");
  assert.equal(actual, expected, "Case refund provider recovery bytes drifted");
  return Object.freeze({
    migration: CASE_REFUND_PROVIDER_RECOVERY_MIGRATION,
    migrationSha256: sha256(actual),
  });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const output = buildCaseRefundProviderRecovery();
  if (process.argv[2] === "--write" && process.argv.length === 3) {
    const directory = path.join(
      ROOT,
      "prisma/migrations",
      CASE_REFUND_PROVIDER_RECOVERY_MIGRATION,
    );
    fs.mkdirSync(directory, { recursive: false });
    fs.writeFileSync(path.join(directory, "migration.sql"), output, {
      encoding: "utf8",
      flag: "wx",
    });
  } else if (process.argv.length === 2) {
    process.stdout.write(output);
  } else {
    throw new Error("Use no arguments or --write");
  }
}
