import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION =
  "20260829020000_prepare_order_payment_event_read_authority";
export const ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION_SHA256 =
  "8d3d5c8545ec221619fbb3e6bf47cd75e595ec3c854808ca21a3263ff4eae2c3";

export const ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_payment_buyer_refund_outcomes(text,text[])",
  "grainline_order_payment_seller_refund_outcomes(text,text[])",
  "grainline_order_payment_buyer_export_page(text,integer,bigint,text)",
  "grainline_order_payment_seller_export_page(text,integer,bigint,text)",
  "grainline_order_payment_staff_timeline(text,text,integer)",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyOrderPaymentEventReadAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION_SHA256,
    "OrderPaymentEvent read-authority migration checksum drifted",
  );
  return Object.freeze({ migration, migrationPath, migrationSha256 });
}

function normalizeIdentityArguments(declarations) {
  const trimmed = declarations.trim();
  if (trimmed === "") return "";
  return trimmed.split(",").map((declaration) => {
    const tokens = declaration.trim()
      .replace(/\s+DEFAULT\s+[\s\S]*$/iu, "")
      .replace(/^IN\s+/iu, "")
      .split(/\s+/u);
    assert.ok(tokens.length >= 2, "read-authority function argument is not named");
    return tokens.slice(1).join(" ").toLowerCase();
  }).join(",");
}

export function orderPaymentEventReadAuthorityFunctionSources(
  root = process.cwd(),
) {
  const { migration } = verifyOrderPaymentEventReadAuthorityMigrationBytes(root);
  const sources = new Map();
  const pattern = /\bCREATE\s+FUNCTION\s+public\.(grainline_[A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*RETURNS[\s\S]*?\nAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\3;/gu;
  for (const match of migration.matchAll(pattern)) {
    sources.set(
      `${match[1]}(${normalizeIdentityArguments(match[2])})`,
      match[4],
    );
  }
  assert.deepEqual(
    [...sources.keys()].sort(),
    [...ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS].sort(),
    "OrderPaymentEvent read-authority function source inventory drifted",
  );
  return Object.freeze(Object.fromEntries([...sources].sort()));
}
