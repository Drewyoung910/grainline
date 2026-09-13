import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_PHASE,
  verifyOrderPaymentSignedDisputeIdentityRelease,
} from "../scripts/verify-order-payment-signed-dispute-identity-release.mjs";

test("signed-dispute identity release is the exact compatibility-only successor", () => {
  const release = verifyOrderPaymentSignedDisputeIdentityRelease();
  assert.equal(
    release.phase,
    ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_PHASE,
  );
  assert.equal(release.runtimeFunctionsReplaced, 1);
  assert.equal(release.rlsChanged, false);
  assert.equal(release.runtimeTablePrivilegesChanged, false);
  assert.equal(release.productionTouched, false);
});

test("signed-dispute identity workflow is exact-main and candidate-only", () => {
  const workflow = readFileSync(
    ".github/workflows/order-payment-signed-dispute-identity-production.yml",
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /run\.head_sha !== releaseCommit/);
  assert.match(workflow, /run\.name !== 'CI'/);
  assert.match(workflow, /run\.conclusion !== 'success'/);
  assert.match(workflow, /guard-production-migration-runner\.mjs/);
  assert.match(
    workflow,
    /20260828020000_correct_order_payment_signed_dispute_identity/,
  );
  assert.match(workflow, /ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_SCOPE_STAGE: restart/);
  assert.match(workflow, /signed-dispute-identity-predecessor/);
  assert.match(workflow, /signed-dispute-identity-compatible/);
  assert.match(
    workflow,
    /if: steps\.scope\.outputs\.state == 'signed-dispute-identity-predecessor'/,
  );
  assert.match(workflow, /npx prisma migrate deploy/);
  assert.match(workflow, /audit:db-grants -- --require-direct-url/);
  assert.match(workflow, /ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_SCOPE_STAGE: after/);
  assert.doesNotMatch(
    workflow,
    /vercel deploy|stripe|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/i,
  );
});
