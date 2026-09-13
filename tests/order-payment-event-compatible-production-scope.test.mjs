import assert from "node:assert/strict";
import test from "node:test";
import {
  ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS,
  assertOrderPaymentEventCompatibleLedger,
  assertOrderPaymentEventCompatibleProductionScope,
  orderPaymentEventCompatibleFunctionSources,
  parseOrderPaymentEventCompatibleScopeEnvironment,
  verifyOrderPaymentEventCompatibleProductionScope,
} from "../scripts/verify-order-payment-event-compatible-production-scope.mjs";

const URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const PRIVATE = new Set([
  "grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)",
  "grainline_order_refund_reconciliation_immutable()",
]);

function applied(migration) {
  return {
    migration_name: migration.name,
    checksum: migration.checksum,
    finished_at: "2026-08-24T00:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

const broadTable = Object.freeze({
  owner_name: "neondb_owner",
  rls_enabled: false,
  rls_forced: false,
  policy_count: 0,
  runtime_can_select: true,
  runtime_can_insert: true,
  runtime_can_update: true,
  runtime_can_delete: true,
  public_has_crud: false,
  invalid_table_acl_count: 0,
  column_acl_count: 0,
});

const privateTable = Object.freeze({
  owner_name: "neondb_owner",
  rls_enabled: true,
  rls_forced: true,
  policy_count: 0,
  runtime_can_select: false,
  runtime_can_insert: false,
  runtime_can_update: false,
  runtime_can_delete: false,
  public_has_crud: false,
  invalid_table_acl_count: 0,
  column_acl_count: 0,
});

const claimColumns = Object.freeze([
  { column_name: "refundClaimGeneration", data_type: "bigint", is_nullable: "NO" },
  { column_name: "refundClaimId", data_type: "character varying", is_nullable: "YES" },
  { column_name: "refundClaimIdempotencyScope", data_type: "character varying", is_nullable: "YES" },
  { column_name: "refundClaimProviderAuthorizedAt", data_type: "timestamp without time zone", is_nullable: "YES" },
  { column_name: "refundClaimSource", data_type: "character varying", is_nullable: "YES" },
  { column_name: "refundClaimSourceGeneration", data_type: "bigint", is_nullable: "YES" },
  { column_name: "refundClaimSourceId", data_type: "character varying", is_nullable: "YES" },
]);

function snapshot(prefixLength) {
  const sources = orderPaymentEventCompatibleFunctionSources(
    process.cwd(),
    prefixLength,
  );
  return {
    ledgerRows: ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS
      .slice(0, prefixLength)
      .map(applied),
    orderPaymentEventTable: structuredClone(broadTable),
    reconciliationTable:
      prefixLength >= 4 ? structuredClone(privateTable) : null,
    refundClaimColumns:
      prefixLength >= 1 ? structuredClone(claimColumns) : [],
    paymentEventColumns: prefixLength >= 3
      ? [{
          column_name: "stripeEventCreatedSeconds",
          data_type: "bigint",
          is_nullable: "YES",
        }]
      : [],
    functions: Object.entries(sources).map(([identity, function_source]) => ({
      identity,
      owner_name: "neondb_owner",
      security_definer:
        identity !== "grainline_order_refund_reconciliation_immutable()",
      function_kind: "f",
      leakproof: false,
      config: ["search_path=pg_catalog"],
      function_source,
      runtime_can_execute: !PRIVATE.has(identity),
      public_can_execute: false,
      invalid_acl_count: 0,
    })),
  };
}

test("production scope parser accepts only manual main and the direct owner", () => {
  const env = {
    DIRECT_URL: URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_STAGE: "restart",
  };
  assert.equal(
    parseOrderPaymentEventCompatibleScopeEnvironment(env).identity.username,
    "neondb_owner",
  );
  for (const drift of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { DIRECT_URL: URL.replace("neondb_owner", "grainline_app_runtime") },
    { DIRECT_URL: URL.replace(".westus3", "-pooler.westus3") },
    { ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_STAGE: "during" },
  ]) {
    assert.throws(() =>
      parseOrderPaymentEventCompatibleScopeEnvironment({ ...env, ...drift })
    );
  }
});

test("ledger accepts only exact applied prefixes", () => {
  for (let prefix = 0; prefix <= ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.length; prefix += 1) {
    assert.equal(
      assertOrderPaymentEventCompatibleLedger(
        ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.slice(0, prefix).map(applied),
        "restart",
      ),
      prefix,
    );
  }
  assert.equal(assertOrderPaymentEventCompatibleLedger([], "before"), 0);
  assert.equal(
    assertOrderPaymentEventCompatibleLedger(
      ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.map(applied),
      "after",
    ),
    5,
  );
  const gap = [
    applied(ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS[0]),
    applied(ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS[2]),
  ];
  assert.throws(() => assertOrderPaymentEventCompatibleLedger(gap, "restart"));
  const wrong = applied(ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS[0]);
  wrong.checksum = "0".repeat(64);
  assert.throws(() => assertOrderPaymentEventCompatibleLedger([wrong], "restart"));
  assert.throws(() =>
    assertOrderPaymentEventCompatibleLedger([
      applied(ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS[0]),
      applied(ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS[0]),
    ], "restart")
  );
  assert.throws(() =>
    assertOrderPaymentEventCompatibleLedger([
      { ...applied(ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS[0]), migration_name: "20260824999999_unknown" },
    ], "restart")
  );
  assert.throws(() =>
    assertOrderPaymentEventCompatibleLedger([], "after")
  );
  assert.throws(() =>
    assertOrderPaymentEventCompatibleLedger(
      ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.map(applied),
      "before",
    )
  );
});

test("scope accepts predecessor, every restart prefix, and exact prepared state", async () => {
  const expectedStates = [
    "predecessor",
    "claim-prepared",
    "record-prepared",
    "signed-prepared",
    "reconciliation-prepared",
    "prepared",
  ];
  for (let prefix = 0; prefix < expectedStates.length; prefix += 1) {
    const result = assertOrderPaymentEventCompatibleProductionScope(
      snapshot(prefix),
      "restart",
    );
    assert.equal(result.compatibleMigrationPrefixLength, prefix);
    assert.equal(result.state, expectedStates[prefix]);
    assert.equal(result.orderPaymentEventRlsEnabled, false);
    assert.equal(result.predecessorRuntimeCrudRetained, true);
  }
  assert.equal(
    assertOrderPaymentEventCompatibleProductionScope(snapshot(0), "before").state,
    "predecessor",
  );
  assert.equal(
    assertOrderPaymentEventCompatibleProductionScope(snapshot(5), "after").state,
    "prepared",
  );
  const verified = await verifyOrderPaymentEventCompatibleProductionScope(
    { directUrl: URL, stage: "after" },
    { readSnapshot: async () => snapshot(5) },
  );
  assert.equal(verified.compatibleMigrationPrefixLength, 5);
});

test("scope rejects table, column, reconciliation, function, and source drift", () => {
  const cases = [];
  const add = (mutate) => {
    const value = snapshot(5);
    mutate(value);
    cases.push(value);
  };
  add((value) => { value.orderPaymentEventTable.rls_enabled = true; });
  add((value) => { value.orderPaymentEventTable.runtime_can_delete = false; });
  add((value) => { value.orderPaymentEventTable.public_has_crud = true; });
  add((value) => { value.orderPaymentEventTable.invalid_table_acl_count = 1; });
  add((value) => { value.refundClaimColumns[0].data_type = "integer"; });
  add((value) => { value.paymentEventColumns[0].is_nullable = "NO"; });
  add((value) => { value.reconciliationTable.rls_forced = false; });
  add((value) => { value.reconciliationTable.runtime_can_select = true; });
  add((value) => { value.functions[0].owner_name = "grainline_app_runtime"; });
  add((value) => { value.functions[1].public_can_execute = true; });
  add((value) => { value.functions[2].config = ["search_path=public"]; });
  add((value) => { value.functions[3].function_source += "\n-- drift"; });
  add((value) => { value.functions.pop(); });
  for (const value of cases) {
    assert.throws(() =>
      assertOrderPaymentEventCompatibleProductionScope(value, "restart")
    );
  }
  const earlyReconciliation = snapshot(3);
  earlyReconciliation.reconciliationTable = structuredClone(privateTable);
  assert.throws(() =>
    assertOrderPaymentEventCompatibleProductionScope(
      earlyReconciliation,
      "restart",
    )
  );
});

test("function catalog tracks the exact replacement at the final prefix", () => {
  const before = orderPaymentEventCompatibleFunctionSources(process.cwd(), 4);
  const after = orderPaymentEventCompatibleFunctionSources(process.cwd(), 5);
  const sellerRecord = Object.keys(after).find((identity) =>
    identity.startsWith("grainline_seller_refund_record(")
  );
  const caseApply = Object.keys(after).find((identity) =>
    identity.startsWith("grainline_case_seller_refund_apply(")
  );
  assert.ok(sellerRecord);
  assert.ok(caseApply);
  assert.notEqual(before[sellerRecord], after[sellerRecord]);
  assert.notEqual(before[caseApply], after[caseApply]);
});
