import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  runOrderPaymentEventCompatibleProductionScopePostgresProof,
} from "../scripts/order-payment-event-compatible-production-scope-postgres-proof.mjs";

const workflow = readFileSync(
  ".github/workflows/order-payment-event-compatible-production.yml",
  "utf8",
);
const scope = readFileSync(
  "scripts/verify-order-payment-event-compatible-production-scope.mjs",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

test("workflow binds one protected exact-main compatible production operation", () => {
  assert.match(workflow, /^name: OrderPaymentEvent Compatible Production Preparation$/m);
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read/);
  assert.match(workflow, /concurrency:\n  group: production-database-migrations\n  cancel-in-progress: false/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /github\.repository == 'Drewyoung910\/grainline'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /releaseCommit !== context\.sha/);
  assert.match(workflow, /run\.head_sha !== releaseCommit/);
  assert.match(workflow, /run\.head_branch !== 'main'/);
  assert.match(workflow, /run\.status !== 'completed'/);
  assert.match(workflow, /run\.conclusion !== 'success'/);
  assert.match(
    workflow,
    /apply-reviewed-order-payment-event-compatible-authority/,
  );
  assert.match(workflow, /name: 'CI', event: 'push'/);
  assert.match(workflow, /name: 'Order Payment Shipping Legacy Inspection'/);
  assert.match(workflow, /actions\/checkout@v5[\s\S]*ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
});

test("workflow byte-verifies and applies only the reviewed migration tail", () => {
  for (const command of [
    "audit:order-refund-claim-generation-release",
    "audit:order-refund-record-authority-release",
    "audit:order-payment-signed-authority-release",
    "audit:order-refund-reconciliation-authority-release",
    "audit:order-refund-inactive-seller-recovery-release",
    "audit:rls-seller-payout-event-force-sealed-prefix",
  ]) {
    assert.match(workflow, new RegExp(command.replaceAll(":", "\\:")));
  }
  assert.match(
    workflow,
    /latest[\s\S]*20260824050000_prepare_order_refund_inactive_seller_recovery/,
  );
  assert.match(workflow, /Isolate all compatible OrderPaymentEvent releases/);
  const restoreSteps = [
    "Restore and verify refund claim generation release",
    "Restore and verify refund record authority release",
    "Restore and verify signed payment authority release",
    "Restore and verify refund reconciliation authority release",
    "Restore and verify inactive-seller recovery release",
  ];
  let previous = -1;
  for (const step of restoreSteps) {
    const position = workflow.indexOf(step);
    assert.ok(position > previous, `${step} must preserve release order`);
    previous = position;
  }
  assert.ok(
    workflow.indexOf("Verify sealed SellerPayoutEvent FORCE predecessor")
      < workflow.indexOf(restoreSteps[0]),
  );
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(workflow, /if: steps\.scope\.outputs\.state != 'prepared'/);
  assert.match(workflow, /ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_STAGE: restart/);
  assert.match(workflow, /ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_STAGE: after/);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/);
  assert.match(workflow, /scripts\/provision-runtime-db-role\.sql/);
  assert.doesNotMatch(workflow, /vercel|stripe\.com|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu);
});

test("scope reader is engine-read-only and refuses authority widening", () => {
  assert.match(
    scope,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
  );
  assert.match(scope, /current_setting\('transaction_read_only'\)/);
  assert.match(scope, /await client\.query\("ROLLBACK"\)/);
  assert.match(scope, /orderPaymentEventRlsEnabled: false/);
  assert.match(scope, /orderPaymentEventRlsForced: false/);
  assert.match(scope, /predecessorRuntimeCrudRetained: true/);
  assert.match(scope, /runtime_can_select !== true/);
  assert.match(scope, /runtime_can_insert !== true/);
  assert.match(scope, /runtime_can_update !== true/);
  assert.match(scope, /runtime_can_delete !== true/);
});

test("PostgreSQL proof refuses non-loopback and CI runs the real reader", async () => {
  await assert.rejects(() =>
    runOrderPaymentEventCompatibleProductionScopePostgresProof({
      ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_PROOF_DATABASE_URL:
        "postgresql://ci:ci@production.example.com:5432/grainline_ci",
    })
  );
  assert.match(
    ci,
    /Prove restart-safe OrderPaymentEvent compatible production scope in PostgreSQL 16/,
  );
  assert.match(
    ci,
    /ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
  );
});
