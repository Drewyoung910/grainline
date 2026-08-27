import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
  BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION_SHA256,
  blockedCheckoutTransferBindingFunctionSource,
} from "../scripts/build-blocked-checkout-transfer-binding-migration.mjs";
import {
  assertBlockedCheckoutTransferBindingLedger,
  assertBlockedCheckoutTransferBindingProductionScope,
  assertTransferBindingFunction,
  parseBlockedCheckoutTransferBindingScopeEnvironment,
  verifyBlockedCheckoutTransferBindingProductionScope,
} from "../scripts/verify-blocked-checkout-transfer-binding-production-scope.mjs";

const URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function applied() {
  return {
    migration_name: BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
    checksum: BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION_SHA256,
    finished_at: "2026-08-26T01:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function functionRow() {
  return {
    identity: "public.grainline_blocked_checkout_transfer_bind(text,bigint,text,text,text,text,text)",
    owner_name: "neondb_owner",
    security_definer: true,
    function_kind: "f",
    language_name: "plpgsql",
    volatility: "v",
    parallel_safety: "u",
    leakproof: false,
    config: ["search_path=pg_catalog"],
    function_source: blockedCheckoutTransferBindingFunctionSource(),
    runtime_can_execute: true,
    public_can_execute: false,
    invalid_acl_count: 0,
  };
}

const assertPredecessor = (snapshot, stage) => {
  assert.equal(snapshot?.exact, true);
  assert.equal(stage, "after");
  return { blockedCheckoutRefundDeliveryApplied: true };
};

test("scope parser accepts only a guarded manual-main owner connection", () => {
  const env = {
    DIRECT_URL: URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    BLOCKED_CHECKOUT_TRANSFER_BINDING_SCOPE_STAGE: "restart",
  };
  assert.equal(
    parseBlockedCheckoutTransferBindingScopeEnvironment(env).identity.username,
    "neondb_owner",
  );
  for (const drift of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { DIRECT_URL: URL.replace("neondb_owner", "grainline_app_runtime") },
    { DIRECT_URL: URL.replace(".westus3", "-pooler.westus3") },
    { BLOCKED_CHECKOUT_TRANSFER_BINDING_SCOPE_STAGE: "during" },
  ]) {
    assert.throws(() =>
      parseBlockedCheckoutTransferBindingScopeEnvironment({ ...env, ...drift })
    );
  }
});

test("ledger accepts only absent or exact applied restart states", () => {
  const row = applied();
  assert.equal(assertBlockedCheckoutTransferBindingLedger([], "before"), false);
  assert.equal(assertBlockedCheckoutTransferBindingLedger([], "restart"), false);
  assert.equal(assertBlockedCheckoutTransferBindingLedger([row], "after"), true);
  assert.equal(assertBlockedCheckoutTransferBindingLedger([row], "restart"), true);
  for (const rows of [
    [{ ...row, checksum: "0".repeat(64) }],
    [{ ...row, finished_at: null }],
    [{ ...row, rolled_back_at: new Date() }],
    [{ ...row, applied_steps_count: 0 }],
    [row, row],
    [{ ...row, migration_name: "20260826010001_unknown" }],
  ]) {
    assert.throws(() =>
      assertBlockedCheckoutTransferBindingLedger(rows, "restart")
    );
  }
  assert.throws(() =>
    assertBlockedCheckoutTransferBindingLedger([row], "before")
  );
  assert.throws(() =>
    assertBlockedCheckoutTransferBindingLedger([], "after")
  );
});

test("function catalog is absent before and exact after the migration", () => {
  assert.doesNotThrow(() =>
    assertTransferBindingFunction(null, false, "neondb_owner")
  );
  assert.doesNotThrow(() =>
    assertTransferBindingFunction(functionRow(), true, "neondb_owner")
  );
  assert.throws(() =>
    assertTransferBindingFunction(functionRow(), false, "neondb_owner")
  );
  for (const mutate of [
    (row) => { row.function_source += "\n-- drift"; },
    (row) => { row.runtime_can_execute = false; },
    (row) => { row.public_can_execute = true; },
    (row) => { row.invalid_acl_count = 1; },
    (row) => { row.config = null; },
    (row) => { row.owner_name = "grainline_app_runtime"; },
  ]) {
    const row = functionRow();
    mutate(row);
    assert.throws(() =>
      assertTransferBindingFunction(row, true, "neondb_owner")
    );
  }
});

test("scope accepts only the exact predecessor and restart state", async () => {
  const before = assertBlockedCheckoutTransferBindingProductionScope(
    {
      blockedCheckoutRefundDelivery: { exact: true },
      candidateLedgerRows: [],
      transferBindingFunction: null,
    },
    "restart",
    { assertPredecessor },
  );
  assert.equal(before.state, "transfer-binding-predecessor");
  assert.equal(before.runtimeExecuteOnly, false);

  const afterSnapshot = {
    blockedCheckoutRefundDelivery: { exact: true },
    candidateLedgerRows: [applied()],
    transferBindingFunction: functionRow(),
  };
  const after = assertBlockedCheckoutTransferBindingProductionScope(
    afterSnapshot,
    "after",
    { assertPredecessor },
  );
  assert.equal(after.state, "transfer-binding-compatible");
  assert.equal(after.runtimeExecuteOnly, true);
  assert.equal(after.orderPaymentEventRlsEnabled, false);
  assert.equal(after.predecessorRuntimeCrudRetained, true);

  const verified = await verifyBlockedCheckoutTransferBindingProductionScope(
    { directUrl: URL, stage: "after" },
    {
      readSnapshot: async () => afterSnapshot,
      assertPredecessor,
    },
  );
  assert.equal(verified.state, "transfer-binding-compatible");
});

test("production reader is one engine-attested read-only snapshot", () => {
  const source = readFileSync(
    "scripts/verify-blocked-checkout-transfer-binding-production-scope.mjs",
    "utf8",
  );
  assert.match(
    source,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
  );
  assert.match(source, /current_setting\('transaction_read_only'\)/);
  assert.match(source, /await client\.query\("ROLLBACK"\)/);
  assert.match(
    source,
    /readBlockedCheckoutRefundDeliveryProductionSnapshotFromClient/,
  );
  assert.match(source, /oidvectortypes\(procedure\.proargtypes\)/);
  assert.match(source, /pg_catalog\.replace\(/);
});
