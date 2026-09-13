import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ORDER_REFUND_CLAIM_GENERATION_MIGRATION =
  "20260824010000_prepare_order_refund_claim_generation";
export const ORDER_REFUND_CLAIM_GENERATION_MIGRATION_SHA256 =
  "2e08ec8c8c5c8d1c6aa85f59e3d914ad8f5b401100d5e79241f3043b2a52854b";

export function verifyOrderRefundClaimGenerationMigrationBytes(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
    "migration.sql",
  );
  assert.ok(
    fs.existsSync(migrationPath),
    `missing ${ORDER_REFUND_CLAIM_GENERATION_MIGRATION}`,
  );
  const migration = fs.readFileSync(migrationPath);
  const migrationSha256 = createHash("sha256").update(migration).digest("hex");
  assert.equal(
    migrationSha256,
    ORDER_REFUND_CLAIM_GENERATION_MIGRATION_SHA256,
    "Order refund claim generation migration bytes drifted",
  );
  return Object.freeze({ migrationPath, migrationSha256 });
}
