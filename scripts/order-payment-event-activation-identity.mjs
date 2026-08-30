import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION =
  "20260830030000_enable_order_payment_event_rls";
export const ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_SHA256 =
  "0ec1c892179d6ba087b9c0866b48b1dcec3ca6e37045be76e46b32e7e0352dae";

export function verifyOrderPaymentEventActivationMigrationBytes(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
    "migration.sql",
  );
  const migration = fs.readFileSync(migrationPath, "utf8");
  const migrationSha256 = createHash("sha256").update(migration).digest("hex");
  assert.equal(
    migrationSha256,
    ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_SHA256,
    "OrderPaymentEvent activation migration bytes drifted",
  );
  return Object.freeze({ migration, migrationPath, migrationSha256 });
}
