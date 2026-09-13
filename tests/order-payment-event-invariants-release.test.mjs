import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ORDER_PAYMENT_EVENT_INVARIANTS_PHASE,
  verifyOrderPaymentEventInvariantsRelease,
} from "../scripts/verify-order-payment-event-invariants-release.mjs";

test("OrderPaymentEvent invariants are the exact compatibility-only successor", () => {
  const release = verifyOrderPaymentEventInvariantsRelease();
  assert.equal(release.phase, ORDER_PAYMENT_EVENT_INVARIANTS_PHASE);
  assert.equal(release.validatedConstraintCount, 6);
  assert.equal(release.triggerCount, 3);
  assert.equal(release.rlsChanged, false);
  assert.equal(release.runtimeTablePrivilegesChanged, false);
  assert.equal(release.productionTouched, false);
});

test("OrderPaymentEvent invariant workflow is exact-main, inspection-bound and candidate-only", () => {
  const workflow = readFileSync(
    ".github/workflows/order-payment-event-invariants-production.yml",
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /mainCi\.head_sha !== releaseCommit/);
  assert.match(workflow, /inspection\.head_sha !== releaseCommit/);
  assert.match(workflow, /Order Payment Shipping Legacy Inspection/);
  assert.match(workflow, /guard-production-migration-runner\.mjs/);
  assert.match(workflow, /20260829010000_prepare_order_payment_event_invariants/);
  assert.match(workflow, /ORDER_PAYMENT_EVENT_INVARIANTS_SCOPE_STAGE: restart/);
  assert.match(workflow, /invariants-predecessor/);
  assert.match(workflow, /invariants-prepared/);
  assert.match(
    workflow,
    /if: steps\.scope\.outputs\.state == 'invariants-predecessor'/,
  );
  assert.match(workflow, /npx prisma migrate deploy/);
  assert.match(workflow, /audit:db-grants -- --require-direct-url/);
  assert.match(workflow, /ORDER_PAYMENT_EVENT_INVARIANTS_SCOPE_STAGE: after/);
  assert.doesNotMatch(
    workflow,
    /vercel deploy|stripe|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/i,
  );
});
