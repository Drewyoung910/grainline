import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION =
  "20260824030000_prepare_order_payment_signed_authority";
export const ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION_SHA256 =
  "176ad2c17301dd1d6bd9a1c0e190e8d44b15463ec830f9a67eb43ec3070396f2";

export function verifyOrderPaymentSignedAuthorityMigrationBytes(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  assert.ok(
    fs.existsSync(migrationPath),
    `missing ${ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION}`,
  );
  const migration = fs.readFileSync(migrationPath);
  const migrationSha256 = createHash("sha256").update(migration).digest("hex");
  assert.equal(
    migrationSha256,
    ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION_SHA256,
    "Order payment signed authority migration bytes drifted",
  );
  return Object.freeze({ migrationPath, migrationSha256 });
}
