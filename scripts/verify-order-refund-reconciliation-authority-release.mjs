#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION,
  verifyOrderPaymentSignedAuthorityMigrationBytes,
} from "./order-payment-signed-authority-catalog.mjs";
import {
  ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
  verifyOrderRefundReconciliationAuthorityMigrationBytes,
} from "./order-refund-reconciliation-authority-catalog.mjs";
import {
  ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
  verifyOrderRefundInactiveSellerRecoveryMigrationBytes,
} from "./order-refund-inactive-seller-recovery-catalog.mjs";
import {
  BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
  verifyBlockedCheckoutRefundDeliveryMigrationBytes,
} from "./build-blocked-checkout-refund-delivery-migration.mjs";
import {
  BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
  verifyBlockedCheckoutTransferBindingMigrationBytes,
} from "./build-blocked-checkout-transfer-binding-migration.mjs";

export const ORDER_REFUND_RECONCILIATION_AUTHORITY_PHASE =
  "order-refund-reconciliation-authority-prepared";

export function verifyOrderRefundReconciliationAuthorityRelease(
  rootDirectory = process.cwd(),
) {
  const predecessor = verifyOrderPaymentSignedAuthorityMigrationBytes(
    rootDirectory,
  );
  const { migrationPath, migrationSha256 } =
    verifyOrderRefundReconciliationAuthorityMigrationBytes(rootDirectory);
  const migration = fs.readFileSync(migrationPath, "utf8");
  const successorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
  );
  const reviewedSuccessors = fs.existsSync(successorPath)
    ? [ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION]
    : [];
  if (reviewedSuccessors.length === 1) {
    verifyOrderRefundInactiveSellerRecoveryMigrationBytes(rootDirectory);
  }
  const blockedCheckoutSuccessorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
  );
  if (fs.existsSync(blockedCheckoutSuccessorPath)) {
    assert.equal(
      reviewedSuccessors.length,
      1,
      "Blocked-checkout delivery requires the inactive-seller predecessor",
    );
    verifyBlockedCheckoutRefundDeliveryMigrationBytes(rootDirectory);
    reviewedSuccessors.push(BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION);
  }
  const transferBindingSuccessorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
  );
  if (fs.existsSync(transferBindingSuccessorPath)) {
    assert.deepEqual(
      reviewedSuccessors,
      [
        ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
        BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
      ],
      "Blocked-checkout transfer binding requires its reviewed predecessors",
    );
    verifyBlockedCheckoutTransferBindingMigrationBytes(rootDirectory);
    reviewedSuccessors.push(BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION);
  }
  const laterMigrations = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(
      (name) => name > ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
    );
  assert.deepEqual(
    laterMigrations,
    reviewedSuccessors,
    "Order refund reconciliation authority release has an unreviewed successor",
  );
  assert.equal(
    (migration.match(/CREATE FUNCTION public\.grainline_/gu) ?? []).length,
    5,
    "Order refund reconciliation function count drifted",
  );
  assert.equal(
    (migration.match(/SECURITY DEFINER/gu) ?? []).length,
    4,
    "Order refund reconciliation definer count drifted",
  );
  assert.equal(
    (migration.match(/SET search_path = pg_catalog/gu) ?? []).length,
    5,
    "Order refund reconciliation search path count drifted",
  );
  assert.equal(
    (migration.match(/TO grainline_app_runtime;/gu) ?? []).length,
    4,
    "Order refund reconciliation runtime grant count drifted",
  );
  assert.match(
    migration,
    /ALTER TABLE public\."OrderRefundReconciliation" ENABLE ROW LEVEL SECURITY;[\s\S]*ALTER TABLE public\."OrderRefundReconciliation" FORCE ROW LEVEL SECURITY;/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\."OrderRefundReconciliation"\s+FROM PUBLIC, grainline_app_runtime;/u,
  );
  assert.doesNotMatch(migration, /CREATE POLICY/u);
  assert.match(
    migration,
    /BEFORE UPDATE OR DELETE ON public\."OrderRefundReconciliation"[\s\S]*grainline_order_refund_reconciliation_immutable/u,
  );
  assert.doesNotMatch(
    migration,
    /ALTER TABLE public\."OrderPaymentEvent"[\s\S]*(?:ENABLE|FORCE) ROW LEVEL SECURITY/u,
  );
  assert.doesNotMatch(
    migration,
    /(?:GRANT|REVOKE)[\s\S]*ON TABLE public\."OrderPaymentEvent"/u,
  );

  return Object.freeze({
    phase: ORDER_REFUND_RECONCILIATION_AUTHORITY_PHASE,
    migration: ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
    migrationSha256,
    predecessorMigration: ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION,
    predecessorSha256: predecessor.migrationSha256,
    protectedTables: 1,
    runtimeFunctions: 4,
    privateFunctions: 1,
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    orderPaymentEventRlsChanged: false,
    reviewedSuccessors,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderRefundReconciliationAuthorityRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Order refund reconciliation authority release verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
