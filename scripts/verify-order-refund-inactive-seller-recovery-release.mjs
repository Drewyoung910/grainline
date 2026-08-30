#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildOrderRefundInactiveSellerRecoveryMigration,
} from "./build-order-refund-inactive-seller-recovery-migration.mjs";
import {
  ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
  verifyOrderRefundInactiveSellerRecoveryMigrationBytes,
} from "./order-refund-inactive-seller-recovery-catalog.mjs";
import {
  ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
  verifyOrderRefundReconciliationAuthorityMigrationBytes,
} from "./order-refund-reconciliation-authority-catalog.mjs";
import {
  BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
  verifyBlockedCheckoutRefundDeliveryMigrationBytes,
} from "./build-blocked-checkout-refund-delivery-migration.mjs";
import {
  BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
  verifyBlockedCheckoutTransferBindingMigrationBytes,
} from "./build-blocked-checkout-transfer-binding-migration.mjs";
import {
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
  verifyOrderPaymentSignedRefundIdentityMigrationBytes,
} from "./build-order-payment-signed-refund-identity-migration.mjs";
import {
  ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
  verifyOrderPaymentSignedDisputeIdentityMigrationBytes,
} from "./build-order-payment-signed-dispute-identity-migration.mjs";
import {
  ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
  verifyOrderPaymentEventInvariantsMigrationBytes,
} from "./order-payment-event-invariants-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
  verifyOrderPaymentEventReadAuthorityMigrationBytes,
} from "./order-payment-event-read-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
  verifyOrderPaymentEventAggregateAuthorityMigrationBytes,
} from "./order-payment-event-aggregate-authority-catalog.mjs";

export const ORDER_REFUND_INACTIVE_SELLER_RECOVERY_PHASE =
  "order-refund-inactive-seller-recovery-prepared";

export function verifyOrderRefundInactiveSellerRecoveryRelease(
  rootDirectory = process.cwd(),
) {
  const predecessor = verifyOrderRefundReconciliationAuthorityMigrationBytes(
    rootDirectory,
  );
  const { migrationPath, migrationSha256 } =
    verifyOrderRefundInactiveSellerRecoveryMigrationBytes(rootDirectory);
  const generated = buildOrderRefundInactiveSellerRecoveryMigration(
    rootDirectory,
  );
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.equal(migration, generated.migration);
  assert.equal(migrationSha256, generated.migrationSha256);

  const laterMigrations = fs.readdirSync(
    path.join(rootDirectory, "prisma/migrations"),
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(
      (name) => name > ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
    );
  const successorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
  );
  const reviewedSuccessors = [];
  if (fs.existsSync(successorPath)) {
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
      [BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION],
      "Blocked-checkout transfer binding requires the refund-delivery predecessor",
    );
    verifyBlockedCheckoutTransferBindingMigrationBytes(rootDirectory);
    reviewedSuccessors.push(BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION);
  }
  const signedRefundIdentitySuccessorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
  );
  if (fs.existsSync(signedRefundIdentitySuccessorPath)) {
    assert.deepEqual(
      reviewedSuccessors,
      [
        BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
        BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
      ],
      "Signed-refund identity requires the blocked-checkout successors",
    );
    verifyOrderPaymentSignedRefundIdentityMigrationBytes(rootDirectory);
    reviewedSuccessors.push(ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION);
  }
  const signedDisputeIdentitySuccessorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
  );
  if (fs.existsSync(signedDisputeIdentitySuccessorPath)) {
    assert.deepEqual(
      reviewedSuccessors,
      [
        BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
        BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
        ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
      ],
      "Signed-dispute identity requires the signed-refund successor",
    );
    verifyOrderPaymentSignedDisputeIdentityMigrationBytes(rootDirectory);
    reviewedSuccessors.push(ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION);
  }
  const invariantsSuccessorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
  );
  if (fs.existsSync(invariantsSuccessorPath)) {
    assert.deepEqual(
      reviewedSuccessors,
      [
        BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
        BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
        ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
        ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
      ],
      "OrderPaymentEvent invariants require all reviewed refund successors",
    );
    verifyOrderPaymentEventInvariantsMigrationBytes(rootDirectory);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION);
  }
  const readAuthoritySuccessorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
  );
  if (fs.existsSync(readAuthoritySuccessorPath)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
      "OrderPaymentEvent read authority requires the invariant successor",
    );
    verifyOrderPaymentEventReadAuthorityMigrationBytes(rootDirectory);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION);
  }
  const aggregateAuthoritySuccessorPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
  );
  if (fs.existsSync(aggregateAuthoritySuccessorPath)) {
    assert.equal(
      reviewedSuccessors.at(-1),
      ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
      "OrderPaymentEvent aggregate authority requires the read-authority successor",
    );
    verifyOrderPaymentEventAggregateAuthorityMigrationBytes(rootDirectory);
    reviewedSuccessors.push(ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION);
  }
  assert.deepEqual(
    laterMigrations,
    reviewedSuccessors,
    "Order refund inactive-seller recovery has an unreviewed successor",
  );

  assert.equal(
    (migration.match(/CREATE OR REPLACE FUNCTION public\.grainline_/gu) ?? [])
      .length,
    2,
  );
  assert.equal((migration.match(/SECURITY DEFINER/gu) ?? []).length, 2);
  assert.equal(
    (migration.match(/SET search_path = pg_catalog/gu) ?? []).length,
    2,
  );
  assert.equal(
    (migration.match(/TO grainline_app_runtime;/gu) ?? []).length,
    2,
  );
  assert.match(
    migration,
    /reconciliation\."claimId" = p_claim_id[\s\S]*reconciliation\."claimGeneration" = p_claim_generation/,
  );
  assert.match(
    migration,
    /reconciliation\."idempotencyScope"\s+= locked_order\."refundClaimIdempotencyScope"/,
  );
  assert.match(
    migration,
    /source_event\.metadata->>'refundClaimId'[\s\S]*source_event\.metadata->>'refundClaimGeneration'/,
  );
  assert.match(migration, /administrator\.role = 'ADMIN'::public\."Role"/);
  assert.match(migration, /AND NOT administrator\.banned/);
  assert.match(migration, /administrator\."deletedAt" IS NULL/);
  assert.equal(
    (
      migration.match(/FOR SHARE OF reconciliation, administrator;/gu) ?? []
    ).length,
    2,
    "inactive-seller recovery must lock both ADMIN authority rows",
  );
  assert.doesNotMatch(migration, /CREATE POLICY/u);
  assert.doesNotMatch(
    migration,
    /ALTER TABLE[\s\S]*(?:ENABLE|FORCE|DISABLE|NO FORCE) ROW LEVEL SECURITY/u,
  );
  assert.doesNotMatch(migration, /(?:GRANT|REVOKE)[\s\S]*ON TABLE/u);
  assert.doesNotMatch(migration, /\bEXECUTE\s+[^\n]*\bformat\s*\(/iu);

  return Object.freeze({
    phase: ORDER_REFUND_INACTIVE_SELLER_RECOVERY_PHASE,
    migration: ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
    migrationSha256,
    predecessorMigration: ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
    predecessorSha256: predecessor.migrationSha256,
    replacedFunctions: 2,
    newRuntimeFunctions: 0,
    tablePrivilegesChanged: false,
    rlsChanged: false,
    reviewedSuccessors,
    productionTouched: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      verifyOrderRefundInactiveSellerRecoveryRelease(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Order refund inactive-seller recovery verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
