import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION =
  "20260830010000_prepare_order_payment_event_aggregate_authority";
export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION_SHA256 =
  "dfb2120e9c338607b1bfd73a8e095af004b188b9a0baa047987ece07199c0666";

export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS = Object.freeze([
  "paymentConversionDisputeBlocked",
  "paymentRefundBlocked",
]);

export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_payment_projection_guard",
  "grainline_order_payment_projection_refresh",
  "grainline_order_payment_projection_state",
]);

export const ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTION_IDENTITIES =
  Object.freeze([
    "grainline_order_payment_projection_guard()",
    "grainline_order_payment_projection_refresh()",
    "grainline_order_payment_projection_state(text)",
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

function normalizeIdentityArguments(declarations) {
  const trimmed = declarations.trim();
  if (trimmed === "") return "";
  return trimmed.split(",").map((declaration) => {
    const tokens = declaration.trim()
      .replace(/\s+DEFAULT\s+[\s\S]*$/iu, "")
      .replace(/^IN\s+/iu, "")
      .split(/\s+/u);
    assert.ok(tokens.length >= 2, "aggregate-authority function argument is not named");
    return tokens.slice(1).join(" ").toLowerCase();
  }).join(",");
}

export function orderPaymentEventAggregateAuthorityFunctionSources(
  root = process.cwd(),
) {
  const { migration } = verifyOrderPaymentEventAggregateAuthorityMigrationBytes(root);
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
    [...ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTION_IDENTITIES].sort(),
    "OrderPaymentEvent aggregate-authority function source inventory drifted",
  );
  return Object.freeze(Object.fromEntries([...sources].sort()));
}
