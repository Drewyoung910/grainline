import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildOrderRefundInactiveSellerRecoveryMigration,
} from "../scripts/build-order-refund-inactive-seller-recovery-migration.mjs";
import {
  ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
  ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION_SHA256,
  verifyOrderRefundInactiveSellerRecoveryMigrationBytes,
} from "../scripts/order-refund-inactive-seller-recovery-catalog.mjs";
import {
  verifyOrderRefundInactiveSellerRecoveryRelease,
} from "../scripts/verify-order-refund-inactive-seller-recovery-release.mjs";

const migrationPath =
  `prisma/migrations/${ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION}/migration.sql`;
const migration = fs.readFileSync(migrationPath, "utf8");

test("inactive-seller recovery migration is generated from sealed predecessors", () => {
  const generated = buildOrderRefundInactiveSellerRecoveryMigration();
  const pinned = verifyOrderRefundInactiveSellerRecoveryMigrationBytes();
  assert.equal(generated.migration, migration);
  assert.equal(generated.migrationSha256, pinned.migrationSha256);
  assert.equal(
    pinned.migrationSha256,
    ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION_SHA256,
  );
});

test("inactive first-write recovery derives one exact immutable ADMIN gate", () => {
  const release = verifyOrderRefundInactiveSellerRecoveryRelease();
  assert.equal(release.replacedFunctions, 2);
  assert.equal(release.newRuntimeFunctions, 0);
  assert.equal(release.tablePrivilegesChanged, false);
  assert.equal(release.rlsChanged, false);
  assert.match(
    migration,
    /IF locked_actor\.banned OR locked_actor\."deletedAt" IS NOT NULL THEN[\s\S]*FROM public\."OrderRefundReconciliation" AS reconciliation/,
  );
  assert.match(
    migration,
    /reconciliation\.action IN \(\s*'RETRY_EXISTING_SCOPE',\s*'CONFIRMED_PROVIDER_EFFECT'/,
  );
  assert.doesNotMatch(migration, /p_reconciliation_id/);
  assert.equal(
    (migration.match(/FOR SHARE OF reconciliation, administrator;/gu) ?? [])
      .length,
    2,
  );
});

test("ordinary function identities and runtime ACLs remain unchanged", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.grainline_seller_refund_record\(\s*p_actor_user_id text,\s*p_claim_id text,\s*p_claim_generation bigint/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.grainline_case_seller_refund_apply\(\s*p_actor_user_id text,\s*p_order_payment_event_id text/,
  );
  assert.equal((migration.match(/GRANT EXECUTE ON FUNCTION/gu) ?? []).length, 2);
  assert.equal((migration.match(/REVOKE ALL ON FUNCTION/gu) ?? []).length, 2);
  assert.doesNotMatch(migration, /CREATE FUNCTION public\.grainline_/);
});

test("recovery does not alter provider, RLS, table grants, or application routing", () => {
  const finalization = fs.readFileSync(
    "src/lib/orderRefundFinalization.ts",
    "utf8",
  );
  const adminAction = fs.readFileSync(
    "src/app/admin/orders/[id]/refundReconciliationActions.ts",
    "utf8",
  );
  assert.match(finalization, /recordSellerOrderRefund\(input, tx\)/);
  assert.match(
    adminAction,
    /reconcileOrderRefundClaim\([\s\S]*finalizePreparedRefund\(/,
  );
  assert.doesNotMatch(migration, /ALTER TABLE/);
  assert.doesNotMatch(migration, /ON TABLE/);
  assert.doesNotMatch(migration, /stripe\./i);
});
