import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION =
  "20260830010000_prepare_order_payment_event_aggregate_authority";
export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION_SHA256 =
  "de0864d1c8fabf875ddfedb4c3037506c305333e7f999d775613fbb808c2a9d1";

export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS = Object.freeze([
  "paymentConversionDisputeBlocked",
  "paymentRefundBlocked",
]);

export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_payment_projection_guard",
  "grainline_order_payment_projection_refresh",
  "grainline_order_payment_projection_state",
]);

export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_TRIGGERS = Object.freeze([
  "grainline_order_payment_projection_guard",
  "grainline_order_payment_projection_refresh",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyOrderPaymentEventAggregateAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION_SHA256,
    "OrderPaymentEvent aggregate-authority migration checksum drifted",
  );
  return Object.freeze({ migration, migrationPath, migrationSha256 });
}
