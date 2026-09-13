import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION =
  "20260824040000_prepare_order_refund_reconciliation_authority";
export const ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION_SHA256 =
  "cfd5d2827eb234fb9c1b7f990b63c3e6bcc2db0dd80038cfcfd163c81314d3d7";

export const ORDER_REFUND_RECONCILIATION_RUNTIME_FUNCTION_NAMES =
  Object.freeze([
    "grainline_order_refund_reconciliation_prepare",
    "grainline_order_refund_claim_mark_ambiguous",
    "grainline_order_refund_reconcile",
    "grainline_blocked_checkout_refund_reconciliation_record",
  ]);

export const ORDER_REFUND_RECONCILIATION_PRIVATE_FUNCTION_NAMES =
  Object.freeze([
    "grainline_order_refund_reconciliation_immutable",
  ]);

export function verifyOrderRefundReconciliationAuthorityMigrationBytes(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  assert.ok(
    fs.existsSync(migrationPath),
    `missing ${ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION}`,
  );
  const migration = fs.readFileSync(migrationPath);
  const migrationSha256 = createHash("sha256")
    .update(migration)
    .digest("hex");
  assert.equal(
    migrationSha256,
    ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION_SHA256,
    "Order refund reconciliation authority migration bytes drifted",
  );
  return Object.freeze({ migrationPath, migrationSha256 });
}
