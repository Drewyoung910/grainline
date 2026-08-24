import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ORDER_REFUND_RECORD_AUTHORITY_MIGRATION =
  "20260824020000_prepare_order_refund_record_authority";
export const ORDER_REFUND_RECORD_AUTHORITY_MIGRATION_SHA256 =
  "906b1e6c5196a7385027e3842fb3146907e2d24f629a9431bbbc5db7dbece782";

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
