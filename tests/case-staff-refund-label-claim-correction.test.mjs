import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildCaseStaffRefundLabelClaimCorrection,
  CASE_STAFF_REFUND_LABEL_CLAIM_CORRECTION_MIGRATION,
  CASE_STAFF_REFUND_LABEL_CLAIM_PREDECESSOR_SOURCE_SHA256,
  CASE_STAFF_REFUND_LABEL_CLAIM_RECONCILE_PREDECESSOR_SOURCE_SHA256,
  extractFunctionSource,
  verifyCaseStaffRefundLabelClaimCorrectionBytes,
} from "../scripts/build-case-staff-refund-label-claim-correction.mjs";

const migrationPath = `prisma/migrations/${CASE_STAFF_REFUND_LABEL_CLAIM_CORRECTION_MIGRATION}/migration.sql`;
const migration = fs.readFileSync(migrationPath, "utf8");
const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");

function count(pattern) {
  return migration.match(pattern)?.length ?? 0;
}

function functionDefinition(
  functionName = "grainline_case_staff_resolution_prepare",
) {
  const start = migration.indexOf(
    `CREATE OR REPLACE FUNCTION public.${functionName}(`,
  );
  const closing = `$${functionName}$;`;
  const end = migration.indexOf(closing, start);
  assert.ok(start >= 0 && end > start);
  return migration.slice(start, end + closing.length);
}

test("staff Case refund label-claim correction is deterministic and additive", () => {
  assert.equal(migration, buildCaseStaffRefundLabelClaimCorrection());
  assert.deepEqual(verifyCaseStaffRefundLabelClaimCorrectionBytes(), {
    migration: CASE_STAFF_REFUND_LABEL_CLAIM_CORRECTION_MIGRATION,
    migrationSha256:
      "49741a79b470b22bb236510795bf0659be32f6a2dfb88b81fa9106cf3b8c31bf",
    functionSourceSha256:
      "1f2786a3676e23af23848fab06e829a69bc7cd51bc25274e5569d9f5bc21c5a9",
    reconciliationSourceSha256:
      "2b70cb728df1471f68ebf63b98489d33c4b3de56a9250ad3b87e01a1133851d6",
  });
  assert.equal(count(/^BEGIN;$/gmu), 1);
  assert.equal(count(/^COMMIT;$/gmu), 1);
  assert.equal(count(/CREATE OR REPLACE FUNCTION public\./gu), 2);
  assert.equal(count(/REVOKE ALL ON FUNCTION/gu), 2);
  assert.equal(count(/GRANT EXECUTE ON FUNCTION/gu), 2);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY/iu);
  assert.doesNotMatch(
    migration,
    /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON/iu,
  );
});

test("correction pins the exact predecessor body and label-claim schema", () => {
  assert.match(
    migration,
    new RegExp(CASE_STAFF_REFUND_LABEL_CLAIM_PREDECESSOR_SOURCE_SHA256, "u"),
  );
  assert.match(
    migration,
    new RegExp(
      CASE_STAFF_REFUND_LABEL_CLAIM_RECONCILE_PREDECESSOR_SOURCE_SHA256,
      "u",
    ),
  );
  assert.match(
    migration,
    /attribute\.attname = 'labelClaimStatus'[\s\S]*character varying\(32\)/u,
  );
  assert.match(
    migration,
    /constraint_state\.conname = 'Order_labelClaimStatus_check'[\s\S]*constraint_state\.convalidated/u,
  );
  assert.match(migration, /Case predecessor function % drifted/u);
  assert.match(migration, /Corrected Case function % drifted/u);
});

test("locked label-claim state fences both new and replayed provider refunds", () => {
  const definition = functionDefinition();
  const source = extractFunctionSource(
    definition,
    "grainline_case_staff_resolution_prepare",
  );
  const orderLock = source.indexOf('FROM public."Order" AS orders');
  const labelProjection = source.indexOf('orders."labelClaimStatus"');
  const replayFailure = source.indexOf(
    "Case staff-resolution replay is no longer refund-eligible",
  );
  const newRefundFailure = source.indexOf(
    "Case staff-resolution refund is not eligible",
  );
  assert.ok(labelProjection >= 0 && labelProjection < orderLock);
  assert.match(source.slice(orderLock, orderLock + 180), /FOR UPDATE/u);
  assert.ok(replayFailure > orderLock);
  assert.ok(newRefundFailure > replayFailure);

  const blockingSet =
    /locked_order\."labelClaimStatus" IN \(\s*'PROVIDER_PENDING',\s*'PROVIDER_AMBIGUOUS',\s*'PROVIDER_RECORDED'\s*\)/gu;
  assert.equal(source.match(blockingSet)?.length, 2);
  assert.doesNotMatch(
    source,
    /"labelClaimStatus" IN \([\s\S]{0,160}'FINALIZED'/u,
  );
});

test("dismissals and terminal provider evidence retain their existing paths", () => {
  const source = extractFunctionSource(
    functionDefinition(),
    "grainline_case_staff_resolution_prepare",
  );
  const resolutionBranch = source.indexOf(
    "IF p_resolution IN (\n       'REFUND_FULL'",
  );
  const newLabelFence = source.indexOf(
    'locked_order."labelClaimStatus" IN (',
    source.indexOf("Case staff-resolution replay is no longer refund-eligible"),
  );
  assert.ok(resolutionBranch > 0 && newLabelFence > resolutionBranch);
  assert.match(
    source,
    /ELSIF existing_claim\.status =\s*'PROVIDER_RECORDED'[\s\S]*Case staff-resolution recorded replay evidence is invalid/u,
  );
  assert.match(
    source,
    /claim_status := 'LOCAL_READY'::public\."CaseResolutionClaimStatus"/u,
  );
});

test("reconciliation retries fence label authority without blocking releases", () => {
  const functionName = "grainline_case_staff_resolution_reconcile";
  const source = extractFunctionSource(
    functionDefinition(functionName),
    functionName,
  );
  const orderLock = source.indexOf('FROM public."Order" AS orders');
  const labelStatusProjection = source.indexOf('orders."labelStatus"');
  const labelClaimProjection = source.indexOf('orders."labelClaimStatus"');
  const retryBranch = source.indexOf(
    "IF p_reconciliation_action = 'RETRY_EXISTING_SCOPE' THEN",
  );
  const releaseBranch = source.indexOf(
    "Case reconciliation claim cannot be released",
  );

  assert.ok(labelStatusProjection >= 0 && labelStatusProjection < orderLock);
  assert.ok(labelClaimProjection >= 0 && labelClaimProjection < orderLock);
  assert.match(source.slice(orderLock, orderLock + 180), /FOR UPDATE/u);
  assert.ok(retryBranch > orderLock);
  assert.ok(releaseBranch > retryBranch);

  const retrySource = source.slice(retryBranch, releaseBranch);
  assert.match(
    retrySource,
    /locked_order\."labelStatus" =\s*'PURCHASED'::public\."LabelStatus"/u,
  );
  assert.match(
    retrySource,
    /locked_order\."labelClaimStatus" IN \(\s*'PROVIDER_PENDING',\s*'PROVIDER_AMBIGUOUS',\s*'PROVIDER_RECORDED'\s*\)/u,
  );
  assert.doesNotMatch(retrySource, /'FINALIZED'/u);
  assert.doesNotMatch(
    source.slice(releaseBranch),
    /locked_order\."label(?:Claim)?Status"/u,
  );
});

test("CI applies the current provider prerequisite and only this correction", () => {
  const prerequisiteStart = ciWorkflow.indexOf(
    "Apply exact Order provider-terminal prerequisite in disposable PostgreSQL",
  );
  const applyStart = ciWorkflow.indexOf(
    "Apply only Case refund label-claim correction in disposable PostgreSQL",
  );
  const nextCorrectionStart = ciWorkflow.indexOf(
    "Restore Order deauthorized Case-access correction",
    applyStart,
  );
  assert.ok(
    prerequisiteStart > 0
      && applyStart > prerequisiteStart
      && nextCorrectionStart > applyStart,
  );
  const prerequisiteBlock = ciWorkflow.slice(prerequisiteStart, applyStart);
  assert.match(
    prerequisiteBlock,
    /psql "\$DIRECT_URL"[\s\S]*--set=ON_ERROR_STOP=on[\s\S]*--file=prisma\/migrations\/20260926010000_correct_order_provider_terminal_reconciliation\/migration\.sql/u,
  );
  assert.doesNotMatch(prerequisiteBlock, /prisma migrate deploy/u);

  const correctionBlock = ciWorkflow.slice(applyStart, nextCorrectionStart);
  assert.match(
    correctionBlock,
    /psql "\$DIRECT_URL"[\s\S]*--set=ON_ERROR_STOP=on[\s\S]*--file=prisma\/migrations\/20260901161000_correct_case_staff_refund_label_claim\/migration\.sql/u,
  );
  assert.doesNotMatch(correctionBlock, /prisma migrate deploy/u);
  assert.match(
    correctionBlock,
    /CASE_LABEL_CLAIM_CORRECTION_EXPECTED: "1"/u,
  );
});
