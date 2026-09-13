import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION =
  "20260901120000_prepare_order_receipt_notification_authority";
export const ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION_SHA256 =
  "709864eb865a3802aa119f244c7e84a86cf1890df509edff8a1e8087c5b279e2";

export function verifyOrderReceiptNotificationAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = createHash("sha256").update(migration).digest("hex");
  assert.equal(
    migrationSha256,
    ORDER_RECEIPT_NOTIFICATION_AUTHORITY_MIGRATION_SHA256,
    "Order receipt Notification authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}
