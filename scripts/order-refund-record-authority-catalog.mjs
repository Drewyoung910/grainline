import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ORDER_REFUND_RECORD_AUTHORITY_MIGRATION =
  "20260824020000_prepare_order_refund_record_authority";
export const ORDER_REFUND_RECORD_AUTHORITY_MIGRATION_SHA256 =
  "6db32ff72d074dc4e0332ddec762f3118b5b09aed63122c257ecb979c2b61fd7";

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
