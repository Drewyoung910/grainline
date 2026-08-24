import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION =
  "20260824050000_prepare_order_refund_inactive_seller_recovery";
export const ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION_SHA256 =
  "e37d5ea925af5f4b82f90b1f1bcdeb9b14f5a4b34da7c228bdc94f8bfbbb9598";

export function verifyOrderRefundInactiveSellerRecoveryMigrationBytes(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
    "migration.sql",
  );
  assert.ok(
    fs.existsSync(migrationPath),
    `missing ${ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION}`,
  );
  const migration = fs.readFileSync(migrationPath);
  const migrationSha256 = createHash("sha256")
    .update(migration)
    .digest("hex");
  assert.equal(
    migrationSha256,
    ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION_SHA256,
    "Order refund inactive-seller recovery migration bytes drifted",
  );
  return Object.freeze({ migrationPath, migrationSha256 });
}
