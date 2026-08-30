import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
  buildOrderPaymentEventActivationCandidate,
} from "../scripts/build-order-payment-event-activation-candidate.mjs";
import {
  orderPaymentEventActivationFunctionCatalog,
} from "../scripts/order-payment-event-activation-catalog.mjs";
import {
  assertOrderPaymentEventActivationProductionScope,
  parseOrderPaymentEventActivationScopeEnvironment,
} from "../scripts/verify-order-payment-event-activation-production-scope.mjs";

function table(applied) {
  return {
    owner_name: "neondb_owner",
    rls_enabled: applied,
    rls_forced: false,
    policy_count: 0,
    runtime_can_select: !applied,
    runtime_can_insert: !applied,
    runtime_can_update: !applied,
    runtime_can_delete: !applied,
    public_has_crud: false,
    invalid_table_acl_count: 0,
    column_acl_count: 0,
    validated_constraint_count: 6,
    required_index_count: 7,
    required_trigger_count: 7,
    order_payment_event_trigger_count: 4,
    invalid_row_count: 0,
  };
}

function functions(applied) {
  return orderPaymentEventActivationFunctionCatalog().map((entry) => ({
    identity: entry.identity,
    owner_name: "neondb_owner",
    function_kind: "f",
    language_name: entry.language,
    volatility: entry.volatility,
    parallel_safety: entry.parallelSafety,
    security_definer: entry.securityDefiner,
    leakproof: false,
    config: ["search_path=pg_catalog"],
    source_md5: entry.sourceMd5,
    runtime_can_execute: applied ? entry.runtimeAfter : entry.runtimeBefore,
    public_can_execute: false,
    invalid_acl_count: 0,
  }));
}

function snapshot(applied) {
  const candidate = buildOrderPaymentEventActivationCandidate();
  return {
    ledgerRows: applied ? [{
      migration_name: ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
      checksum: candidate.migrationSha256,
      finished_at: "2026-08-30T00:00:00Z",
      rolled_back_at: null,
      applied_steps_count: 1,
    }] : [],
    table: table(applied),
    functions: functions(applied),
    unexpectedNamedFunctionCount: 0,
    unexpectedDirectFunctionCount: 0,
  };
}

test("activation scope accepts only exact predecessor and activated states", () => {
  assert.equal(
    assertOrderPaymentEventActivationProductionScope(
      snapshot(false),
      "before",
    ).state,
    "transition-authority-prepared",
  );
  assert.equal(
    assertOrderPaymentEventActivationProductionScope(
      snapshot(false),
      "restart",
    ).state,
    "transition-authority-prepared",
  );
  assert.equal(
    assertOrderPaymentEventActivationProductionScope(
      snapshot(true),
      "after",
    ).state,
    "activated",
  );
  assert.equal(
    assertOrderPaymentEventActivationProductionScope(
      snapshot(true),
      "restart",
    ).runtimeFunctionCount,
    16,
  );
});

test("activation scope rejects partial ledger and grant drift", () => {
  const partial = snapshot(true);
  partial.ledgerRows[0].applied_steps_count = 0;
  assert.throws(() => assertOrderPaymentEventActivationProductionScope(
    partial,
    "restart",
  ));

  const legacyGrant = snapshot(true);
  const retired = legacyGrant.functions.find(
    (entry) => entry.identity
      === "grainline_case_seller_refund_apply(text,text)",
  );
  retired.runtime_can_execute = true;
  assert.throws(() => assertOrderPaymentEventActivationProductionScope(
    legacyGrant,
    "after",
  ));

  const directGrant = snapshot(true);
  directGrant.table.runtime_can_select = true;
  assert.throws(() => assertOrderPaymentEventActivationProductionScope(
    directGrant,
    "after",
  ));
});

test("activation scope environment stays manual-main and exact-stage only", () => {
  assert.throws(() => parseOrderPaymentEventActivationScopeEnvironment({}));
  assert.throws(() => parseOrderPaymentEventActivationScopeEnvironment({
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    DIRECT_URL: "postgresql://neondb_owner:secret@example.invalid/neondb?sslmode=require&channel_binding=require",
    ORDER_PAYMENT_EVENT_ACTIVATION_SCOPE_STAGE: "after",
  }));
});
