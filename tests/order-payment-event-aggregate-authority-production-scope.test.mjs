import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTION_IDENTITIES,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION_SHA256,
  orderPaymentEventAggregateAuthorityFunctionSources,
} from "../scripts/order-payment-event-aggregate-authority-catalog.mjs";
import {
  assertOrderPaymentEventAggregateAuthorityProductionScope,
} from "../scripts/verify-order-payment-event-aggregate-authority-production-scope.mjs";

function candidateSnapshot(applied) {
  const sources = orderPaymentEventAggregateAuthorityFunctionSources();
  return {
    orderPaymentEventReadAuthority: {},
    candidateLedgerRows: applied ? [{
      migration_name: ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
      checksum: ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION_SHA256,
      finished_at: new Date(),
      rolled_back_at: null,
      applied_steps_count: 1,
    }] : [],
    columns: applied ? ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_COLUMNS.map(
      (columnName) => ({
        column_name: columnName,
        type_name: "boolean",
        not_null: true,
        default_expression: "false",
      }),
    ) : [],
    functions: applied
      ? ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTION_IDENTITIES.map(
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
        trigger_name: "grainline_order_payment_projection_guard",
        relation_schema: "public",
        table_name: "Order",
        enabled: "O",
        trigger_type: 23,
        argument_count: 0,
        constraint_trigger: false,
        deferrable: false,
        initially_deferred: false,
        update_columns: [
          "paymentRefundBlocked",
          "paymentConversionDisputeBlocked",
        ],
        function_identity: "grainline_order_payment_projection_guard()",
        function_schema: "public",
        function_owner: "neondb_owner",
        function_kind: "f",
      },
      {
        trigger_name: "grainline_order_payment_projection_refresh",
        relation_schema: "public",
        table_name: "OrderPaymentEvent",
        enabled: "O",
        trigger_type: 5,
        argument_count: 0,
        constraint_trigger: false,
        deferrable: false,
        initially_deferred: false,
        update_columns: [],
        function_identity: "grainline_order_payment_projection_refresh()",
        function_schema: "public",
        function_owner: "neondb_owner",
        function_kind: "f",
      },
    ] : [],
    projectionMismatchCount: applied ? 0 : null,
  };
}

const dependencies = Object.freeze({
  assertPredecessor: () => ({ orderPaymentEventReadAuthorityApplied: true }),
});

test("aggregate-authority scope accepts only exact predecessor or applied state", () => {
  const before = assertOrderPaymentEventAggregateAuthorityProductionScope(
    candidateSnapshot(false),
    "restart",
    dependencies,
  );
  assert.equal(before.state, "aggregate-authority-predecessor");
  assert.equal(before.projectionColumnCount, 0);
  assert.equal(before.privateFunctionCount, 0);

  const after = assertOrderPaymentEventAggregateAuthorityProductionScope(
    candidateSnapshot(true),
    "after",
    dependencies,
  );
  assert.equal(after.state, "aggregate-authority-prepared");
  assert.equal(after.projectionColumnCount, 2);
  assert.equal(after.privateFunctionCount, 3);
  assert.equal(after.projectionMismatchCount, 0);
  assert.equal(after.orderPaymentEventRlsEnabled, false);
  assert.equal(after.predecessorRuntimeCrudRetained, true);
});

test("aggregate-authority scope rejects ledger, column and projection drift", () => {
  const badLedger = candidateSnapshot(true);
  badLedger.candidateLedgerRows[0].checksum = "0".repeat(64);
  assert.throws(() => assertOrderPaymentEventAggregateAuthorityProductionScope(
    badLedger,
    "after",
    dependencies,
  ));

  const badColumn = candidateSnapshot(true);
  badColumn.columns[0].not_null = false;
  assert.throws(() => assertOrderPaymentEventAggregateAuthorityProductionScope(
    badColumn,
    "after",
    dependencies,
  ));

  const badProjection = candidateSnapshot(true);
  badProjection.projectionMismatchCount = 1;
  assert.throws(() => assertOrderPaymentEventAggregateAuthorityProductionScope(
    badProjection,
    "after",
    dependencies,
  ));
});

test("aggregate-authority scope rejects function and trigger drift", () => {
  const badSource = candidateSnapshot(true);
  badSource.functions[0].function_source += "\n-- drift";
  assert.throws(() => assertOrderPaymentEventAggregateAuthorityProductionScope(
    badSource,
    "after",
    dependencies,
  ));

  const badAcl = candidateSnapshot(true);
  badAcl.functions[0].runtime_can_execute = true;
  assert.throws(() => assertOrderPaymentEventAggregateAuthorityProductionScope(
    badAcl,
    "after",
    dependencies,
  ));

  const badTrigger = candidateSnapshot(true);
  badTrigger.triggers[0].enabled = "D";
  assert.throws(() => assertOrderPaymentEventAggregateAuthorityProductionScope(
    badTrigger,
    "after",
    dependencies,
  ));
});

test("aggregate-authority scope reader is engine-read-only", () => {
  const source = readFileSync(
    "scripts/verify-order-payment-event-aggregate-authority-production-scope.mjs",
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
