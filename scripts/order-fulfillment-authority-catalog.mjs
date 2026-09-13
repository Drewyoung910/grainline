import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORDER_FULFILLMENT_AUTHORITY_MIGRATION =
  "20260901130000_prepare_order_fulfillment_authority";
export const ORDER_FULFILLMENT_AUTHORITY_MIGRATION_SHA256 =
  "c0d139eebe55bd481116c2a2d66699525e397db72dad8f358d948852264cd5fc";
export const ORDER_FULFILLMENT_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_seller_fulfillment_transition(text,text,text,text,text)",
  "grainline_order_buyer_receipt_confirm(text,text)",
  "grainline_order_seller_notes_update(text,text,text)",
]);

export function verifyOrderFulfillmentAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_FULFILLMENT_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = createHash("sha256").update(migration).digest("hex");
  assert.equal(
    migrationSha256,
    ORDER_FULFILLMENT_AUTHORITY_MIGRATION_SHA256,
    "Order fulfillment-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}
