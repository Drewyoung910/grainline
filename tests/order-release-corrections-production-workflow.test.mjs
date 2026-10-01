import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/order-release-corrections-production.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const migrations = Object.freeze([
  [
    "20260926010000_correct_order_provider_terminal_reconciliation",
    "6e835d8da110ee53384d1afd898fe0e02a8c9679f48be24a43557173b3651987",
  ],
  [
    "20260926011000_correct_order_paid_checkout_bound_reservation",
    "757d579c6ac61a9a3d5b434eb9421c1da2dad24d8051c08b61ce2e2850bb4b36",
  ],
  [
    "20260926012000_correct_order_seller_deauthorization_fulfillment",
    "de3db869562e4cdbe411efb1652f0cefb2f2a9687a079e15e84b70aaeb740263",
  ],
  [
    "20260926012100_correct_order_seller_deauthorization_label",
    "75b2c6d00f9f7996c6140a57adbcc91f207cf96e2c495478fb21a9a633f0b29f",
  ],
  [
    "20260926012200_correct_order_seller_deauthorization_projection",
    "4b8ed62faa14d9fa32c57c0045847357d04c16889f9a1d2e3b83633a1c482578",
  ],
]);
const deferredCutover = Object.freeze([
  "20260926012300_retire_legacy_checkout_reservation_creators",
  "f66b5314f6116a2900b06c98e0a5cb0236684ab8c0c712e5d6059a758571ae61",
]);

test("workflow binds the five corrections to exact main and successful push CI", () => {
  assert.match(workflow, /^name: Order Release Corrections Production$/mu);
  assert.match(workflow, /^  workflow_dispatch:$/mu);
  assert.match(workflow, /github\.repository == 'Drewyoung910\/grainline'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(workflow, /apply-reviewed-order-release-corrections/u);
  assert.match(workflow, /main\.commit\.sha !== sha/u);
  assert.match(workflow, /run\.head_sha !== sha/u);
  assert.match(workflow, /run\.head_branch !== 'main'/u);
  assert.match(workflow, /run\.name !== 'CI'/u);
  assert.match(workflow, /run\.event !== 'push'/u);
  assert.match(workflow, /run\.conclusion !== 'success'/u);
  assert.match(workflow, /id: correction_scope/u);
  assert.match(
    workflow,
    /state=\$\{rowsByName\.size === 0 \? 'predecessor' : 'restart'\}/u,
  );
  assert.match(
    workflow,
    /if: steps\.correction_scope\.outputs\.state == 'predecessor'/u,
  );
  assert.match(workflow, /\[\[ "\$CORRECTION_STATE" == "restart" \]\]/u);
  assert.match(workflow, /assert\.equal\(rowsByName\.has\(cutover\), false\)/u);
});

test("workflow pins every SQL byte and applies the correction set once", () => {
  for (const [migration, expectedDigest] of migrations) {
    const bytes = readFileSync(`prisma/migrations/${migration}/migration.sql`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      expectedDigest,
    );
    assert.match(workflow, new RegExp(migration, "u"));
    assert.match(workflow, new RegExp(expectedDigest, "u"));
  }
  const [deferredMigration, deferredDigest] = deferredCutover;
  const deferredBytes = readFileSync(
    `prisma/migrations/${deferredMigration}/migration.sql`,
  );
  assert.equal(
    createHash("sha256").update(deferredBytes).digest("hex"),
    deferredDigest,
  );
  assert.match(workflow, new RegExp(deferredMigration, "u"));
  assert.match(workflow, new RegExp(deferredDigest, "u"));
  assert.match(
    workflow,
    /test -f "\$holding\/20260926012300_retire_legacy_checkout_reservation_creators\/migration\.sql"/u,
  );
  assert.match(workflow, /mv "\$deferred" prisma\/migrations\//u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /npx prisma migrate status/u);
  assert.match(workflow, /Order_provider_claim_mutual_exclusion_check/u);
  assert.match(
    workflow,
    /status NOT IN \\\('SESSION_CREATED', 'COMPLETED'\\\)/u,
  );
  assert.match(workflow, /sellerDeauthorizedAt/u);
  assert.match(workflow, /grainline_order_seller_label_provider_record/u);
  assert.match(workflow, /grainline_order_label_clawback_finalize/u);
  assert.match(workflow, /ORDER_LABEL_REFUND_RACE_RECORDED/u);
  assert.match(workflow, /p_outcome IS NULL OR p_outcome NOT IN/u);
  assert.doesNotMatch(
    workflow,
    /vercel|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|ALTER TABLE[^\n]+DISABLE ROW LEVEL SECURITY/iu,
  );
});

test("CI defers successor-aware PostgreSQL tests until correction files are restored", () => {
  const predecessorStart = ciWorkflow.indexOf(
    "      - name: Prove compatible Order participant authority",
  );
  const predecessorEnd = ciWorkflow.indexOf(
    "      - name: Prove Order compatible production-scope query in disposable PostgreSQL",
    predecessorStart,
  );
  const restoreStart = ciWorkflow.indexOf(
    "      - name: Restore and prove the reviewed successors",
  );
  const restoreEnd = ciWorkflow.indexOf(
    "      - name: Production build",
    restoreStart,
  );
  assert.ok(predecessorStart >= 0 && predecessorEnd > predecessorStart);
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  const predecessorStep = ciWorkflow.slice(predecessorStart, predecessorEnd);
  const restoredStep = ciWorkflow.slice(restoreStart, restoreEnd);
  for (const testFile of [
    "tests/order-fulfillment-authority-postgres.test.mjs",
    "tests/order-label-authority-postgres.test.mjs",
    "tests/order-participant-detail-authority-postgres.test.mjs",
  ]) {
    assert.doesNotMatch(predecessorStep, new RegExp(testFile, "u"));
    assert.match(restoredStep, new RegExp(testFile, "u"));
  }
});

test("CI holds every successor-aware test out of the historical full suite", () => {
  const isolateStart = ciWorkflow.indexOf(
    "      - name: Isolate successor regressions from historical full-suite release guards",
  );
  const testStart = ciWorkflow.indexOf("      - name: Tests", isolateStart);
  const restoreStart = ciWorkflow.indexOf(
    "      - name: Restore and prove the reviewed successors",
    testStart,
  );
  const restoreEnd = ciWorkflow.indexOf(
    "      - name: Production build",
    restoreStart,
  );
  assert.ok(isolateStart >= 0 && testStart > isolateStart);
  assert.ok(restoreStart > testStart && restoreEnd > restoreStart);
  const isolateStep = ciWorkflow.slice(isolateStart, testStart);
  const restoredStep = ciWorkflow.slice(restoreStart, restoreEnd);
  for (const testFile of [
    "tests/order-provider-terminal-reconciliation-postgres.test.mjs",
    "tests/order-paid-checkout-authority-postgres.test.mjs",
    "tests/order-paid-repair-lock-proof.test.mjs",
    "tests/order-fulfillment-authority-postgres.test.mjs",
    "tests/order-label-authority-postgres.test.mjs",
    "tests/order-participant-detail-authority-postgres.test.mjs",
    "tests/order-review-holds.test.mjs",
    "tests/order-release-corrections-production-workflow.test.mjs",
    "tests/order-checkout-legacy-creator-retirement-postgres.test.mjs",
    "tests/order-checkout-source-cutover-production-workflow.test.mjs",
    "tests/order-item-enable-release.test.mjs",
  ]) {
    assert.match(isolateStep, new RegExp(testFile, "u"));
    assert.match(restoredStep, new RegExp(testFile, "u"));
  }
});
