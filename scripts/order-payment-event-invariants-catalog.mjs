import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION =
  "20260829010000_prepare_order_payment_event_invariants";
export const ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION_SHA256 =
  "e5da430056c32d2a4d754f08e5ea3fa79dfb0ab401f71375d73ae6d14e39943c";

export const ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS = Object.freeze([
  "grainline_order_currency_payment_immutable",
  "grainline_order_payment_event_immutable",
  "grainline_order_payment_event_validate_insert",
]);

export const ORDER_PAYMENT_EVENT_INVARIANT_CONSTRAINTS = Object.freeze([
  "OrderPaymentEvent_amountCents_check",
  "OrderPaymentEvent_currency_check",
  "OrderPaymentEvent_eventType_check",
  "OrderPaymentEvent_source_shape_check",
  "OrderPaymentEvent_text_shape_check",
  "OrderPaymentEvent_timestamp_immutable_shape_check",
]);

export const ORDER_PAYMENT_EVENT_INVARIANT_TRIGGERS = Object.freeze([
  "grainline_order_currency_payment_immutable",
  "grainline_order_payment_event_immutable",
  "grainline_order_payment_event_validate_insert",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function orderPaymentEventInvariantsMigrationPath(
  root = process.cwd(),
) {
  return path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
    "migration.sql",
  );
}

export function verifyOrderPaymentEventInvariantsMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = orderPaymentEventInvariantsMigrationPath(root);
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION_SHA256,
    "OrderPaymentEvent invariant migration checksum drifted",
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
    assert.ok(tokens.length >= 2, "invariant function argument is not named");
    return tokens.slice(1).join(" ").toLowerCase();
  }).join(",");
}

export function orderPaymentEventInvariantFunctionSources(
  root = process.cwd(),
) {
  const { migration } = verifyOrderPaymentEventInvariantsMigrationBytes(root);
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
    ORDER_PAYMENT_EVENT_INVARIANT_FUNCTIONS.map((name) => `${name}()`),
    "OrderPaymentEvent invariant function source inventory drifted",
  );
  return Object.freeze(Object.fromEntries([...sources].sort()));
}
