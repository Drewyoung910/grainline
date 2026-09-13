import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseOrderRefundReconciliationAuthorityProofConfig,
} from "../scripts/order-refund-reconciliation-authority-postgres-proof.mjs";

const PROOF_URL = "postgresql://ci:ci@localhost:5432/grainline_ci";

test("real PostgreSQL reconciliation proof refuses unsafe database targets", () => {
  assert.throws(
    () => parseOrderRefundReconciliationAuthorityProofConfig({}),
    /is required/,
  );
  assert.throws(
    () => parseOrderRefundReconciliationAuthorityProofConfig({
      ORDER_REFUND_RECONCILIATION_AUTHORITY_PROOF_DATABASE_URL:
        "postgresql://ci:ci@database.example.com:5432/grainline_ci",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseOrderRefundReconciliationAuthorityProofConfig({
      ORDER_REFUND_RECONCILIATION_AUTHORITY_PROOF_DATABASE_URL:
        "postgresql://ci:ci@localhost:5432/grainline",
    }),
    /requires grainline_ci/,
  );
  assert.throws(
    () => parseOrderRefundReconciliationAuthorityProofConfig({
      ORDER_REFUND_RECONCILIATION_AUTHORITY_PROOF_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime@localhost:5432/grainline_ci",
    }),
    /requires the ci migration role/,
  );
  assert.deepEqual(
    parseOrderRefundReconciliationAuthorityProofConfig({
      ORDER_REFUND_RECONCILIATION_AUTHORITY_PROOF_DATABASE_URL: PROOF_URL,
    }),
    { databaseUrl: PROOF_URL },
  );
});

test("CI runs the real PostgreSQL proof only after applying reconciliation", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const proofSource = readFileSync(
    "scripts/order-refund-reconciliation-authority-postgres-proof.mjs",
    "utf8",
  );
  const apply = ci.indexOf(
    "Apply Order refund reconciliation authority preparation",
  );
  const proof = ci.indexOf(
    "Prove Order refund reconciliation authority through the runtime role",
  );
  assert.ok(apply >= 0 && apply < proof);
  assert.match(
    ci,
    /Prove Order refund reconciliation authority through the runtime role[\s\S]{0,360}ORDER_REFUND_RECONCILIATION_AUTHORITY_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
  );
  assert.match(
    JSON.parse(readFileSync("package.json", "utf8")).scripts[
      "audit:order-refund-reconciliation-authority-postgres"
    ],
    /order-refund-reconciliation-authority-postgres-proof\.mjs/,
  );
  assert.match(proofSource, /processingStartedAt" = NULL/);
  assert.match(proofSource, /inactive signed-lease blocked-checkout record/);
  assert.match(proofSource, /direct blocked-checkout record core/);
  assert.match(proofSource, /forged blocked-checkout reconciliation record/);
  assert.match(
    proofSource,
    /failedLeaseRecoveryBoundToReconciliation: true/,
  );
});
