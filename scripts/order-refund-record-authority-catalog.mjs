import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ORDER_REFUND_RECORD_AUTHORITY_MIGRATION =
  "20260824020000_prepare_order_refund_record_authority";
export const ORDER_REFUND_RECORD_AUTHORITY_MIGRATION_SHA256 =
  "e1cd79da8f6a0a22668cb612c6f7d579b7af1caf431f917d69771e6b0742d505";

export const ORDER_REFUND_RECORD_PRIVATE_FUNCTION_NAMES = Object.freeze([
  "grainline_blocked_checkout_refund_record_core",
]);

export function verifyOrderRefundRecordAuthorityMigrationBytes(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  assert.ok(
    fs.existsSync(migrationPath),
    `missing ${ORDER_REFUND_RECORD_AUTHORITY_MIGRATION}`,
  );
  const migration = fs.readFileSync(migrationPath);
  const migrationSha256 = createHash("sha256").update(migration).digest("hex");
  assert.equal(
    migrationSha256,
    ORDER_REFUND_RECORD_AUTHORITY_MIGRATION_SHA256,
    "Order refund record authority migration bytes drifted",
  );
  return Object.freeze({ migrationPath, migrationSha256 });
}
