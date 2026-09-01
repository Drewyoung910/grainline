import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORDER_LABEL_AUTHORITY_MIGRATION =
  "20260901140000_prepare_order_label_authority";
export const ORDER_LABEL_AUTHORITY_MIGRATION_SHA256 =
  "fd9fec2567a7c5071ffd850bb5fc5b81a32a2156d77de35bcea5b4b622385977";
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
export const ORDER_LABEL_PRIVATE_FUNCTIONS = Object.freeze([
  "grainline_order_label_ambiguous_claim_read(text,text,text,bigint)",
  "grainline_order_label_ambiguous_release(text,text,text,bigint,text,text)",
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
