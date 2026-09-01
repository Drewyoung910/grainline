import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORDER_LABEL_AUTHORITY_MIGRATION =
  "20260901140000_prepare_order_label_authority";
export const ORDER_LABEL_AUTHORITY_MIGRATION_SHA256 =
  "3bd75ec60b09774282dfb0efaa0b9c74cbed19e2efed3e8cb71640ae8d61bfa4";
export const ORDER_LABEL_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_seller_label_preflight(text,text)",
  "grainline_order_seller_label_quote_replace(text,text,text,jsonb)",
  "grainline_order_seller_label_claim(text,text,text)",
  "grainline_order_seller_label_provider_record(text,text,text,bigint,text,text,text,text,integer,text,text,text,text)",
  "grainline_order_label_clawback_finalize(text,text,bigint,bigint,text,text,text)",
  "grainline_order_label_clawback_claim_batch(integer)",
  "grainline_order_seller_label_download(text,text)",
  "grainline_order_seller_detail_v4(text,text)",
]);

export function verifyOrderLabelAuthorityMigrationBytes(root = process.cwd()) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_LABEL_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = createHash("sha256").update(migration).digest("hex");
  assert.equal(
    migrationSha256,
    ORDER_LABEL_AUTHORITY_MIGRATION_SHA256,
    "Order label-authority migration bytes drifted",
  );
  return Object.freeze({ migration, migrationSha256 });
}
