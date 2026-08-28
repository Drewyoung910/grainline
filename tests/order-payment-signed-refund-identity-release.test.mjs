import assert from "node:assert/strict";
import { mkdtempSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PHASE,
  verifyOrderPaymentSignedRefundIdentityRelease,
} from "../scripts/verify-order-payment-signed-refund-identity-release.mjs";
import {
  parseOrderPaymentSignedRefundIdentityProofConfig,
} from "../scripts/order-payment-signed-refund-identity-postgres-proof.mjs";

test("signed-refund identity release proves its exact compatible scope", () => {
  const proof = verifyOrderPaymentSignedRefundIdentityRelease();
  assert.deepEqual({
    phase: proof.phase,
    runtimeFunctionsReplaced: proof.runtimeFunctionsReplaced,
    rlsChanged: proof.rlsChanged,
    runtimeTablePrivilegesChanged: proof.runtimeTablePrivilegesChanged,
    productionTouched: proof.productionTouched,
  }, {
    phase: ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PHASE,
    runtimeFunctionsReplaced: 1,
    rlsChanged: false,
    runtimeTablePrivilegesChanged: false,
    productionTouched: false,
  });
});

test("signed-refund identity release refuses an unreviewed successor", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "signed-refund-identity-release-"));
  try {
    mkdirSync(path.join(root, "prisma"), { recursive: true });
    cpSync("prisma/migrations", path.join(root, "prisma/migrations"), {
      recursive: true,
    });
    const successor = path.join(
      root,
      "prisma/migrations/20260828010001_unreviewed_successor",
    );
    mkdirSync(successor);
    writeFileSync(path.join(successor, "migration.sql"), "SELECT 1;\n");
    assert.throws(
      () => verifyOrderPaymentSignedRefundIdentityRelease(root),
      /unreviewed successor/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real PostgreSQL proof accepts only separate loopback owner and runtime roles", () => {
  const config = parseOrderPaymentSignedRefundIdentityProofConfig({
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PROOF_DATABASE_URL:
      "postgresql://ci:owner@127.0.0.1:5432/grainline_ci",
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PROOF_RUNTIME_DATABASE_URL:
      "postgresql://grainline_app_runtime:runtime@localhost:5432/grainline_ci",
  });
  assert.match(config.ownerDatabaseUrl, /ci:owner/);
  assert.match(config.runtimeDatabaseUrl, /grainline_app_runtime:runtime/);
  assert.throws(
    () => parseOrderPaymentSignedRefundIdentityProofConfig({
      ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PROOF_DATABASE_URL:
        "postgresql://ci:owner@database.example/grainline_ci",
      ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime@localhost/grainline_ci",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseOrderPaymentSignedRefundIdentityProofConfig({
      ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PROOF_DATABASE_URL:
        "postgresql://ci:owner@localhost/grainline_ci",
      ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://ci:runtime@localhost/grainline_ci",
    }),
    /grainline_app_runtime/,
  );
});

