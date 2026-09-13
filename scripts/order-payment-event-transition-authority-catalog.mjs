import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION =
  "20260830020000_prepare_order_payment_event_transition_authority";
export const ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION_SHA256 =
  "ebfd5f7476cc425bdbe8bf44f21625d9ac3532fdcc74b0af52bc1c36299852a3";

export const ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_COLUMNS = Object.freeze([
  "paymentOpenDisputeBlocked",
]);

export const ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTIONS = Object.freeze([
  "grainline_order_payment_open_dispute_guard",
  "grainline_order_payment_open_dispute_refresh",
  "grainline_order_payment_open_dispute_state",
]);

export const ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTION_IDENTITIES =
  Object.freeze([
    "grainline_order_payment_open_dispute_guard()",
    "grainline_order_payment_open_dispute_refresh()",
    "grainline_order_payment_open_dispute_state(text)",
  ]);

export const ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_TRIGGERS = Object.freeze([
  "grainline_order_payment_open_dispute_guard",
  "grainline_order_payment_open_dispute_refresh",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyOrderPaymentEventTransitionAuthorityMigrationBytes(
  root = process.cwd(),
) {
  const migrationPath = path.join(
    root,
    "prisma/migrations",
    ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
    "migration.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");
  const migrationSha256 = sha256(migration);
  assert.equal(
    migrationSha256,
    ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION_SHA256,
    "OrderPaymentEvent transition-authority migration checksum drifted",
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
    assert.ok(tokens.length >= 2, "transition-authority function argument is not named");
    return tokens.slice(1).join(" ").toLowerCase();
  }).join(",");
}

export function orderPaymentEventTransitionAuthorityFunctionSources(
  root = process.cwd(),
) {
  const { migration } = verifyOrderPaymentEventTransitionAuthorityMigrationBytes(root);
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
    [...ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTION_IDENTITIES].sort(),
    "OrderPaymentEvent transition-authority function source inventory drifted",
  );
  return Object.freeze(Object.fromEntries([...sources].sort()));
}
