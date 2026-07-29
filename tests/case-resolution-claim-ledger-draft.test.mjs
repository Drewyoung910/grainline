import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const DRAFT_PATH =
  "docs/rls-drafts/case-resolution-claim-ledger.sql";
const sql = fs.readFileSync(DRAFT_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");

test("CaseResolutionClaim remains a draft outside the migration tree", () => {
  assert.equal(
    fs.existsSync(
      "prisma/migrations/20260729000000_prepare_case_resolution_claim/migration.sql",
    ),
    false,
  );
  assert.match(sql, /DRAFT ONLY\. Do not apply to any persistent database/);
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
    /Invalid CaseResolutionClaim status transition/,
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
