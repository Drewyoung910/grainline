import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729024500_prepare_case_resolution_claim_schema/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");

test("CaseResolutionClaim preparation is additive and coexistence-safe", () => {
  assert.equal(fs.existsSync(MIGRATION_PATH), true);
  assert.match(
    sql,
    /Coexistence-safe Case resolution preparation/,
  );
  assert.doesNotMatch(sql, /DRAFT ONLY/);
  assert.doesNotMatch(
    normalizedSql,
    /CREATE POLICY .* ON public\."(?:Case|CaseMessage|CaseMessageAttachment)"/i,
  );
  assert.doesNotMatch(
    normalizedSql,
    /grainline_case_relationship_valid|grainline_case_message_author_valid/,
  );
});

test("Case claim preparation remains a reviewed predecessor but not production-authorized", () => {
  const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const productionWorkflow = fs.readFileSync(
    ".github/workflows/production-migrations.yml",
    "utf8",
  );
  assert.match(
    ciWorkflow,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE: case-open-authority-reviewed/,
  );
  assert.match(
    productionWorkflow,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE: direct-upload-legacy-repair-reviewed/,
  );
  assert.doesNotMatch(
    productionWorkflow,
    /case-resolution-claim-preparation-reviewed/,
  );
});

test("Stripe-dispute source is nullable and bound to the exact Order", () => {
  assert.match(
    normalizedSql,
    /ALTER TABLE public\."OrderPaymentEvent" ADD CONSTRAINT "OrderPaymentEvent_id_orderId_key" UNIQUE \(id, "orderId"\)/,
  );
  assert.match(
    normalizedSql,
    /ALTER TABLE public\."Case" ADD COLUMN "openedByPaymentEventId" TEXT/,
  );
  assert.match(
    normalizedSql,
    /FOREIGN KEY \("openedByPaymentEventId", "orderId"\) REFERENCES public\."OrderPaymentEvent"\(id, "orderId"\)/,
  );
});

test("CaseResolutionClaim is private FORCE RLS with no user policy", () => {
  assert.match(
    normalizedSql,
    /ALTER TABLE public\."CaseResolutionClaim" ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    normalizedSql,
    /ALTER TABLE public\."CaseResolutionClaim" FORCE ROW LEVEL SECURITY/,
  );
  assert.match(
    normalizedSql,
    /REVOKE ALL ON TABLE public\."CaseResolutionClaim" FROM PUBLIC, grainline_app_runtime/,
  );
  assert.doesNotMatch(
    normalizedSql,
    /CREATE POLICY .*CaseResolutionClaim/i,
  );
  assert.match(
    normalizedSql,
    /policy_count <> 0/,
  );
  assert.match(
    normalizedSql,
    /REVOKE ALL ON TYPE public\."CaseResolutionClaimStatus" FROM PUBLIC/,
  );
  assert.match(
    normalizedSql,
    /GRANT USAGE ON TYPE public\."CaseResolutionClaimStatus" TO grainline_app_runtime/,
  );
});

test("CaseResolutionClaim binds Case, Order, actor and payment evidence", () => {
  assert.match(
    normalizedSql,
    /FOREIGN KEY \("caseId", "orderId"\) REFERENCES public\."Case"\(id, "orderId"\)/,
  );
  assert.match(
    normalizedSql,
    /FOREIGN KEY \("staffActorId"\) REFERENCES public\."User"\(id\)/,
  );
  assert.match(
    normalizedSql,
    /FOREIGN KEY \("orderPaymentEventId", "orderId"\) REFERENCES public\."OrderPaymentEvent"\(id, "orderId"\)/,
  );
  assert.match(
    normalizedSql,
    /ALTER TABLE public\."Order" ADD COLUMN "caseResolutionClaimId" TEXT/,
  );
  assert.match(
    normalizedSql,
    /FOREIGN KEY \("caseResolutionClaimId"\) REFERENCES public\."CaseResolutionClaim"\(id\)/,
  );
  assert.match(
    normalizedSql,
    /CREATE CONSTRAINT TRIGGER grainline_case_resolution_claim_lease_valid .* DEFERRABLE INITIALLY DEFERRED/s,
  );
  assert.match(
    normalizedSql,
    /CREATE CONSTRAINT TRIGGER grainline_order_case_resolution_claim_lease_valid .* DEFERRABLE INITIALLY DEFERRED/s,
  );
  assert.match(
    normalizedSql,
    /order_claim_id IS DISTINCT FROM active_claim_id/,
  );
  assert.match(
    normalizedSql,
    /TG_RELID = 'public\."Order"'::pg_catalog\.regclass/,
  );
  assert.doesNotMatch(normalizedSql, /TG_TABLE_NAME = 'Order'/);
});

test("CaseResolutionClaim has distinct truthful terminal states", () => {
  for (const status of [
    "LOCAL_READY",
    "PROVIDER_PENDING",
    "PROVIDER_RECORDED",
    "RECONCILIATION_REQUIRED",
    "FINALIZED",
    "RELEASED_NO_PROVIDER_EFFECT",
  ]) {
    assert.match(sql, new RegExp(`'${status}'`), status);
  }
  assert.match(
    normalizedSql,
    /status = 'RELEASED_NO_PROVIDER_EFFECT'.*AND "orderPaymentEventId" IS NULL.*AND "providerRecordedAt" IS NULL.*AND "finalizedAt" IS NULL.*AND "reconciledAt" IS NOT NULL/s,
  );
  assert.match(
    normalizedSql,
    /"reconciliationAction" = 'CONFIRMED_NO_PROVIDER_EFFECT'/,
  );
  assert.match(
    normalizedSql,
    /status NOT IN \( 'FINALIZED'.*'RELEASED_NO_PROVIDER_EFFECT'/s,
  );
  assert.match(
    normalizedSql,
    /status IN \( 'LOCAL_READY'.*'PROVIDER_PENDING'.*AND "orderPaymentEventId" IS NULL.*AND "providerRecordedAt" IS NULL.*AND "finalizedAt" IS NULL/s,
  );
  assert.match(
    normalizedSql,
    /status = 'RECONCILIATION_REQUIRED'.*AND "finalizedAt" IS NULL/s,
  );
});

test("CaseResolutionClaim evidence and authority fields are immutable", () => {
  assert.match(
    normalizedSql,
    /CREATE OR REPLACE FUNCTION public\.grainline_case_resolution_claim_immutable\(\)/,
  );
  for (const field of [
    '"caseId"',
    '"orderId"',
    '"staffActorId"',
    "resolution",
    '"refundAmountCents"',
    "currency",
    '"stockRestorePlan"',
    '"idempotencyScope"',
    '"createdAt"',
  ]) {
    assert.match(
      normalizedSql,
      new RegExp(
        `NEW\\.${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} IS DISTINCT FROM OLD\\.${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
      field,
    );
  }
  assert.match(
    normalizedSql,
    /Terminal CaseResolutionClaim is immutable/,
  );
  assert.match(
    normalizedSql,
    /OLD\."orderPaymentEventId" IS NOT NULL.*NEW\."orderPaymentEventId" IS DISTINCT FROM OLD\."orderPaymentEventId".*OLD\."providerRecordedAt" IS NOT NULL.*NEW\."providerRecordedAt" IS DISTINCT FROM OLD\."providerRecordedAt"/s,
  );
  assert.match(
    normalizedSql,
    /CaseResolutionClaim provider evidence is immutable/,
  );
  assert.match(
    normalizedSql,
    /"providerRecordedAt" <= "finalizedAt"/,
  );
  assert.match(
    normalizedSql,
    /Invalid CaseResolutionClaim status transition/,
  );
  assert.match(
    normalizedSql,
    /CaseResolutionClaim Order lease is inconsistent/,
  );
  assert.match(
    normalizedSql,
    /SET search_path = pg_catalog/,
  );
  assert.doesNotMatch(sql, /\bEXECUTE\s+(?!FUNCTION\b)/i);
  assert.doesNotMatch(sql, /\bformat\s*\(/i);
});

test("CaseResolutionClaim cannot be released by elapsed time or cleanup", () => {
  assert.doesNotMatch(
    normalizedSql,
    /\bexpiresAt\b|\bcleanupAfter\b|\bleaseAt\b|\bINTERVAL\b/i,
  );
  assert.doesNotMatch(
    normalizedSql,
    /DELETE FROM public\."CaseResolutionClaim"/i,
  );
});
