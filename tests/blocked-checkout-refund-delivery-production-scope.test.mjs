import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
  BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION_SHA256,
  blockedCheckoutRefundDeliveryFunctionSources,
} from "../scripts/build-blocked-checkout-refund-delivery-migration.mjs";
import {
  runBlockedCheckoutRefundDeliveryProductionScopePostgresProof,
} from "../scripts/blocked-checkout-refund-delivery-production-scope-postgres-proof.mjs";
import {
  ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS,
  orderPaymentEventCompatibleFunctionSources,
} from "../scripts/verify-order-payment-event-compatible-production-scope.mjs";
import {
  assertBlockedCheckoutRefundDeliveryLedger,
  assertBlockedCheckoutRefundDeliveryProductionScope,
  parseBlockedCheckoutRefundDeliveryScopeEnvironment,
  verifyBlockedCheckoutRefundDeliveryProductionScope,
} from "../scripts/verify-blocked-checkout-refund-delivery-production-scope.mjs";

const URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const RUNTIME_ROLE = "grainline_app_runtime";
const PRIVATE_PAYMENT_FUNCTIONS = new Set([
  "grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)",
  "grainline_order_refund_reconciliation_immutable()",
]);

function applied(migration_name, checksum) {
  return {
    migration_name,
    checksum,
    finished_at: "2026-08-25T01:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

const broadPaymentTable = Object.freeze({
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

const privateReconciliationTable = Object.freeze({
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

const refundClaimColumns = Object.freeze([
  { column_name: "refundClaimGeneration", data_type: "bigint", is_nullable: "NO" },
  { column_name: "refundClaimId", data_type: "character varying", is_nullable: "YES" },
  { column_name: "refundClaimIdempotencyScope", data_type: "character varying", is_nullable: "YES" },
  { column_name: "refundClaimProviderAuthorizedAt", data_type: "timestamp without time zone", is_nullable: "YES" },
  { column_name: "refundClaimSource", data_type: "character varying", is_nullable: "YES" },
  { column_name: "refundClaimSourceGeneration", data_type: "bigint", is_nullable: "YES" },
  { column_name: "refundClaimSourceId", data_type: "character varying", is_nullable: "YES" },
]);

function compatibleSnapshot() {
  const sources = orderPaymentEventCompatibleFunctionSources();
  return {
    ledgerRows: ORDER_PAYMENT_EVENT_COMPATIBLE_MIGRATIONS.map((migration) =>
      applied(migration.name, migration.checksum)
    ),
    orderPaymentEventTable: structuredClone(broadPaymentTable),
    reconciliationTable: structuredClone(privateReconciliationTable),
    refundClaimColumns: structuredClone(refundClaimColumns),
    paymentEventColumns: [{
      column_name: "stripeEventCreatedSeconds",
      data_type: "bigint",
      is_nullable: "YES",
    }],
    functions: Object.entries(sources).map(([identity, function_source]) => ({
      identity,
      owner_name: "neondb_owner",
      security_definer:
        identity !== "grainline_order_refund_reconciliation_immutable()",
      function_kind: "f",
      leakproof: false,
      config: ["search_path=pg_catalog"],
      function_source,
      runtime_can_execute: !PRIVATE_PAYMENT_FUNCTIONS.has(identity),
      public_can_execute: false,
      invalid_acl_count: 0,
    })),
  };
}

function notificationPolicies() {
  const expression =
    `"userId" = NULLIF(current_setting('app.user_id', true), '')`;
  return [
    {
      rls_enabled: true,
      rls_forced: true,
      policy_name: "grainline_notification_recipient_select",
      policy_command: "r",
      policy_permissive: true,
      policy_roles: [RUNTIME_ROLE],
      using_expression: expression,
      check_expression: null,
    },
    {
      rls_enabled: true,
      rls_forced: true,
      policy_name: "grainline_notification_recipient_update",
      policy_command: "w",
      policy_permissive: true,
      policy_roles: [RUNTIME_ROLE],
      using_expression: expression,
      check_expression: expression,
    },
  ];
}

function notificationTable() {
  return {
    owner_name: "neondb_owner",
    rls_enabled: true,
    rls_forced: true,
    runtime_can_select: true,
    runtime_can_insert: false,
    runtime_can_update: false,
    runtime_can_delete: false,
    runtime_can_update_read: true,
    runtime_other_update_count: 0,
    public_has_crud: false,
    invalid_table_acl_count: 0,
    invalid_column_acl_count: 0,
    runtime_read_update_acl_count: 1,
  };
}

function notificationFunctions(candidateApplied) {
  const sources = blockedCheckoutRefundDeliveryFunctionSources();
  return [
    {
      identity: "grainline_notification_create_core",
      owner_name: "neondb_owner",
      security_definer: true,
      function_kind: "f",
      language_name: "plpgsql",
      volatility: "v",
      parallel_safety: "u",
      leakproof: false,
      config: ["search_path=pg_catalog"],
      function_source: candidateApplied
        ? sources.candidateCore
        : sources.predecessorCore,
      runtime_can_execute: false,
      public_can_execute: false,
      invalid_acl_count: 0,
    },
    {
      identity: "grainline_notification_create_order_event",
      owner_name: "neondb_owner",
      security_definer: true,
      function_kind: "f",
      language_name: "plpgsql",
      volatility: "v",
      parallel_safety: "u",
      leakproof: false,
      config: ["search_path=pg_catalog"],
      function_source: sources.orderWrapper,
      runtime_can_execute: true,
      public_can_execute: false,
      invalid_acl_count: 0,
    },
  ];
}

function snapshot(candidateApplied) {
  return {
    orderPaymentEventCompatible: compatibleSnapshot(),
    candidateLedgerRows: candidateApplied
      ? [applied(
          BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
          BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION_SHA256,
        )]
      : [],
    notificationTable: notificationTable(),
    notificationPolicies: notificationPolicies(),
    notificationFunctions: notificationFunctions(candidateApplied),
  };
}

test("scope parser accepts only manual main and the reviewed direct owner", () => {
  const env = {
    DIRECT_URL: URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_STAGE: "restart",
  };
  assert.equal(
    parseBlockedCheckoutRefundDeliveryScopeEnvironment(env).identity.username,
    "neondb_owner",
  );
  for (const drift of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { DIRECT_URL: URL.replace("neondb_owner", RUNTIME_ROLE) },
    { DIRECT_URL: URL.replace(".westus3", "-pooler.westus3") },
    { BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_STAGE: "during" },
  ]) {
    assert.throws(() =>
      parseBlockedCheckoutRefundDeliveryScopeEnvironment({ ...env, ...drift })
    );
  }
});

test("candidate ledger accepts only absent or exact applied restart states", () => {
  const row = applied(
    BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
    BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION_SHA256,
  );
  assert.equal(assertBlockedCheckoutRefundDeliveryLedger([], "before"), false);
  assert.equal(
    assertBlockedCheckoutRefundDeliveryLedger([], "restart"),
    false,
  );
  assert.equal(
    assertBlockedCheckoutRefundDeliveryLedger([row], "after"),
    true,
  );
  assert.equal(
    assertBlockedCheckoutRefundDeliveryLedger([row], "restart"),
    true,
  );
  for (const rows of [
    [{ ...row, checksum: "0".repeat(64) }],
    [{ ...row, finished_at: null }],
    [{ ...row, rolled_back_at: new Date() }],
    [{ ...row, applied_steps_count: 0 }],
    [row, row],
    [{ ...row, migration_name: "20260825010001_unknown" }],
  ]) {
    assert.throws(() =>
      assertBlockedCheckoutRefundDeliveryLedger(rows, "restart")
    );
  }
  assert.throws(() =>
    assertBlockedCheckoutRefundDeliveryLedger([row], "before")
  );
  assert.throws(() =>
    assertBlockedCheckoutRefundDeliveryLedger([], "after")
  );
});

test("scope accepts exact predecessor and applied compatibility states", async () => {
  const before = assertBlockedCheckoutRefundDeliveryProductionScope(
    snapshot(false),
    "before",
  );
  assert.equal(before.state, "delivery-predecessor");
  assert.equal(before.blockedCheckoutRefundDeliveryApplied, false);
  assert.equal(before.compatibleMigrationPrefixLength, 5);
  assert.equal(before.notificationRlsForced, true);

  const after = assertBlockedCheckoutRefundDeliveryProductionScope(
    snapshot(true),
    "after",
  );
  assert.equal(after.state, "delivery-compatible");
  assert.equal(after.blockedCheckoutRefundDeliveryApplied, true);
  assert.equal(after.orderPaymentEventRlsEnabled, false);
  assert.equal(after.predecessorRuntimeCrudRetained, true);
  assert.equal(after.notificationGenericCoreRuntimePrivate, true);

  assert.equal(
    assertBlockedCheckoutRefundDeliveryProductionScope(
      snapshot(false),
      "restart",
    ).state,
    "delivery-predecessor",
  );
  assert.equal(
    assertBlockedCheckoutRefundDeliveryProductionScope(
      snapshot(true),
      "restart",
    ).state,
    "delivery-compatible",
  );

  const verified = await verifyBlockedCheckoutRefundDeliveryProductionScope(
    { directUrl: URL, stage: "after" },
    { readSnapshot: async () => snapshot(true) },
  );
  assert.equal(verified.state, "delivery-compatible");
});

test("scope rejects predecessor, Notification, ACL, policy, and body drift", () => {
  const cases = [];
  const add = (mutate) => {
    const value = snapshot(true);
    mutate(value);
    cases.push(value);
  };
  add((value) => { value.orderPaymentEventCompatible.orderPaymentEventTable.rls_enabled = true; });
  add((value) => { value.notificationTable.rls_forced = false; });
  add((value) => { value.notificationTable.runtime_can_insert = true; });
  add((value) => { value.notificationTable.runtime_can_update_read = false; });
  add((value) => { value.notificationTable.runtime_other_update_count = 1; });
  add((value) => { value.notificationTable.invalid_table_acl_count = 1; });
  add((value) => { value.notificationTable.invalid_column_acl_count = 1; });
  add((value) => { value.notificationPolicies[0].policy_roles = ["PUBLIC"]; });
  add((value) => { value.notificationPolicies[1].check_expression = null; });
  add((value) => { value.notificationFunctions[0].runtime_can_execute = true; });
  add((value) => { value.notificationFunctions[0].function_source += "\n-- drift"; });
  add((value) => { value.notificationFunctions[1].function_source += "\n-- drift"; });
  add((value) => { value.notificationFunctions.pop(); });
  for (const value of cases) {
    assert.throws(() =>
      assertBlockedCheckoutRefundDeliveryProductionScope(
        value,
        "after",
      )
    );
  }
});

test("production reader is one engine-attested read-only snapshot", () => {
  const source = fs.readFileSync(
    "scripts/verify-blocked-checkout-refund-delivery-production-scope.mjs",
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
    /readOrderPaymentEventCompatibleProductionSnapshotFromClient/,
  );
  assert.match(source, /readNotificationPolicyState/);
});

test("PostgreSQL proof refuses every non-loopback target", async () => {
  await assert.rejects(() =>
    runBlockedCheckoutRefundDeliveryProductionScopePostgresProof({
      BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_PROOF_DATABASE_URL:
        "postgresql://ci:ci@production.example.com:5432/grainline_ci",
    })
  );
});
