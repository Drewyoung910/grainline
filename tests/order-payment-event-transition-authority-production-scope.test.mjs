import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTION_IDENTITIES,
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION_SHA256,
  orderPaymentEventTransitionAuthorityFunctionSources,
} from "../scripts/order-payment-event-transition-authority-catalog.mjs";
import {
  assertOrderPaymentEventTransitionAuthorityProductionScope,
} from "../scripts/verify-order-payment-event-transition-authority-production-scope.mjs";

function candidateSnapshot(applied) {
  const sources = orderPaymentEventTransitionAuthorityFunctionSources();
  return {
    orderPaymentEventAggregateAuthority: {},
    candidateLedgerRows: applied ? [{
      migration_name: ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
      checksum: ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION_SHA256,
      finished_at: new Date(),
      rolled_back_at: null,
      applied_steps_count: 1,
    }] : [],
    columns: applied ? [{
      column_name: "paymentOpenDisputeBlocked",
      type_name: "boolean",
      not_null: true,
      default_expression: "false",
    }] : [],
    functions: applied
      ? ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_FUNCTION_IDENTITIES.map(
        (identity) => ({
          identity,
          owner_name: "neondb_owner",
          security_definer: true,
          function_kind: "f",
          language_name: identity.endsWith("(text)") ? "sql" : "plpgsql",
          volatility: "v",
          parallel_safety: "u",
          leakproof: false,
          config: ["search_path=pg_catalog"],
          function_source: sources[identity],
          runtime_can_execute: false,
          public_can_execute: false,
          invalid_acl_count: 0,
        }),
      )
      : [],
    triggers: applied ? [
      {
        trigger_name: "grainline_order_payment_open_dispute_guard",
        relation_schema: "public",
        table_name: "Order",
        enabled: "O",
        trigger_type: 23,
        argument_count: 0,
        constraint_trigger: false,
        deferrable: false,
        initially_deferred: false,
        update_columns: ["paymentOpenDisputeBlocked"],
        function_identity: "grainline_order_payment_open_dispute_guard()",
        function_schema: "public",
        function_owner: "neondb_owner",
        function_kind: "f",
      },
      {
        trigger_name: "grainline_order_payment_open_dispute_refresh",
        relation_schema: "public",
        table_name: "OrderPaymentEvent",
        enabled: "O",
        trigger_type: 5,
        argument_count: 0,
        constraint_trigger: false,
        deferrable: false,
        initially_deferred: false,
        update_columns: [],
        function_identity: "grainline_order_payment_open_dispute_refresh()",
        function_schema: "public",
        function_owner: "neondb_owner",
        function_kind: "f",
      },
    ] : [],
    projectionMismatchCount: applied ? 0 : null,
  };
}

const dependencies = Object.freeze({
  assertPredecessor: () => ({
    orderPaymentEventAggregateAuthorityApplied: true,
  }),
});

test("transition-authority scope accepts only exact predecessor or applied state", () => {
  const before = assertOrderPaymentEventTransitionAuthorityProductionScope(
    candidateSnapshot(false),
    "restart",
    dependencies,
  );
  assert.equal(before.state, "transition-authority-predecessor");
  assert.equal(before.projectionColumnCount, 0);
  assert.equal(before.privateFunctionCount, 0);

  const after = assertOrderPaymentEventTransitionAuthorityProductionScope(
    candidateSnapshot(true),
    "after",
    dependencies,
  );
  assert.equal(after.state, "transition-authority-prepared");
  assert.equal(after.projectionColumnCount, 1);
  assert.equal(after.privateFunctionCount, 3);
  assert.equal(after.projectionMismatchCount, 0);
  assert.equal(after.orderPaymentEventRlsEnabled, false);
  assert.equal(after.predecessorRuntimeCrudRetained, true);
});

test("transition-authority scope rejects ledger, projection and catalog drift", () => {
  const badLedger = candidateSnapshot(true);
  badLedger.candidateLedgerRows[0].checksum = "0".repeat(64);
  assert.throws(() => assertOrderPaymentEventTransitionAuthorityProductionScope(
    badLedger,
    "after",
    dependencies,
  ));

  const badColumn = candidateSnapshot(true);
  badColumn.columns[0].not_null = false;
  assert.throws(() => assertOrderPaymentEventTransitionAuthorityProductionScope(
    badColumn,
    "after",
    dependencies,
  ));

  const badProjection = candidateSnapshot(true);
  badProjection.projectionMismatchCount = 1;
  assert.throws(() => assertOrderPaymentEventTransitionAuthorityProductionScope(
    badProjection,
    "after",
    dependencies,
  ));

  const badSource = candidateSnapshot(true);
  badSource.functions[0].function_source += "\n-- drift";
  assert.throws(() => assertOrderPaymentEventTransitionAuthorityProductionScope(
    badSource,
    "after",
    dependencies,
  ));

  const badAcl = candidateSnapshot(true);
  badAcl.functions[0].runtime_can_execute = true;
  assert.throws(() => assertOrderPaymentEventTransitionAuthorityProductionScope(
    badAcl,
    "after",
    dependencies,
  ));

  const badTrigger = candidateSnapshot(true);
  badTrigger.triggers[0].enabled = "D";
  assert.throws(() => assertOrderPaymentEventTransitionAuthorityProductionScope(
    badTrigger,
    "after",
    dependencies,
  ));
});

test("transition-authority production reader is engine-read-only", () => {
  const source = readFileSync(
    "scripts/verify-order-payment-event-transition-authority-production-scope.mjs",
    "utf8",
  );
  assert.match(
    source,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/u,
  );
  assert.match(source, /transaction_read_only/u);
  assert.match(source, /readOnly !== "on"/u);
  assert.match(
    source,
    /pg_catalog\.unnest\(trigger\.tgattr::smallint\[\]\)[\s\S]*?\)::text\[\] AS update_columns/u,
  );
  assert.doesNotMatch(
    source,
    /INSERT INTO|UPDATE public|DELETE FROM|ALTER TABLE/u,
  );
});
