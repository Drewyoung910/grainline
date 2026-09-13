import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION =
  "20260901150000_prepare_order_charged_total";
export const ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION_SHA256 =
  "b5edb502f1f6c7685f0deb44163975150d5b22770c6758b66414dd979e93dec8";

export function verifyOrderChargedTotalCompatibilityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = createHash("sha256")
    .update(migration)
    .digest("hex");
  assert.equal(
    migrationSha256,
    ORDER_CHARGED_TOTAL_COMPATIBILITY_MIGRATION_SHA256,
    "Order charged-total compatibility migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}
