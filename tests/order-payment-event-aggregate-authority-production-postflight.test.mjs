import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTION_IDENTITIES,
  orderPaymentEventAggregateAuthorityFunctionSources,
} from "../scripts/order-payment-event-aggregate-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_POSTFLIGHT_CONFIRMATION,
  assertOrderPaymentEventAggregateAuthorityPostflightGitState,
  assertOrderPaymentEventAggregateAuthorityRuntimeSnapshot,
  parseOrderPaymentEventAggregateAuthorityPostflightConfig,
  proveOrderPaymentEventAggregatePrivateExecutionDenied,
  writeOrderPaymentEventAggregateAuthorityPostflightEvidence,
} from "../scripts/order-payment-event-aggregate-authority-production-postflight.mjs";

const COMMIT = "a".repeat(40);
const REVIEWED_IDENTITY = Object.freeze({
  databaseName: "grainline",
  endpointId: "reviewed-endpoint",
  region: "aws-us-east-2",
  role: "grainline_app_runtime",
  runtimeRole: "grainline_app_runtime",
});

function environment(evidencePath) {
  return {
    NODE_ENV: "production",
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_POSTFLIGHT_CONFIRM:
      ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_POSTFLIGHT_CONFIRMATION,
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_POSTFLIGHT_RELEASE_COMMIT: COMMIT,
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_POSTFLIGHT_MAIN_CI_RUN_ID: "101",
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_POSTFLIGHT_INSPECTION_RUN_ID: "102",
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_POSTFLIGHT_MIGRATION_RUN_ID: "103",
    ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_POSTFLIGHT_EVIDENCE_PATH:
      evidencePath,
    DATABASE_URL:
      "postgresql://grainline_app_runtime:secret@example.com/grainline",
  };
}

function aggregateSnapshot() {
  const sources = orderPaymentEventAggregateAuthorityFunctionSources();
  return {
    columns: [
      {
        column_name: "paymentConversionDisputeBlocked",
        type_name: "boolean",
        not_null: true,
        default_expression: "false",
      },
      {
        column_name: "paymentRefundBlocked",
        type_name: "boolean",
        not_null: true,
        default_expression: "false",
      },
    ],
    functions: ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_FUNCTION_IDENTITIES.map(
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
    ),
    triggers: [
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
    ],
    projectionAggregate: {
      total_order_count: "2",
      refund_blocked_count: "0",
      dispute_blocked_count: "0",
    },
  };
}

test("aggregate-authority postflight accepts exact runtime-only bindings", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ope-aggregate-postflight-"));
  const evidencePath = path.join(
    directory,
    `order-payment-event-aggregate-authority-production-postflight-${COMMIT}.json`,
  );
  const config = parseOrderPaymentEventAggregateAuthorityPostflightConfig(
    environment(evidencePath),
    { assertRuntimeDatabaseIsolation: () => REVIEWED_IDENTITY },
  );
  assert.equal(config.releaseCommit, COMMIT);
  assert.equal(config.mainCiRunId, 101);
  assert.equal(config.inspectionRunId, 102);
  assert.equal(config.migrationRunId, 103);
  assert.equal(config.runtimeIdentity, REVIEWED_IDENTITY);
});

test("aggregate-authority postflight rejects privileged aliases and stale evidence", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ope-aggregate-postflight-"));
  const evidencePath = path.join(
    directory,
    `order-payment-event-aggregate-authority-production-postflight-${COMMIT}.json`,
  );
  const dependencies = {
    assertRuntimeDatabaseIsolation: () => REVIEWED_IDENTITY,
  };
  assert.throws(() => parseOrderPaymentEventAggregateAuthorityPostflightConfig(
    {
      ...environment(evidencePath),
      DIRECT_URL: "postgresql://owner:secret@example.com/db",
    },
    dependencies,
  ));
  assert.throws(() => parseOrderPaymentEventAggregateAuthorityPostflightConfig(
    {
      ...environment(evidencePath),
      DATABASE_URL_COPY: environment(evidencePath).DATABASE_URL,
    },
    dependencies,
  ));
  writeOrderPaymentEventAggregateAuthorityPostflightEvidence(evidencePath, {
    status: "occupied",
  });
  assert.throws(() => parseOrderPaymentEventAggregateAuthorityPostflightConfig(
    environment(evidencePath),
    dependencies,
  ));
});

test("aggregate-authority postflight requires exact clean Git state", () => {
  assert.deepEqual(
    assertOrderPaymentEventAggregateAuthorityPostflightGitState(
      { head: COMMIT, status: "" },
      COMMIT,
    ),
    { clean: true, head: COMMIT },
  );
  assert.throws(() => assertOrderPaymentEventAggregateAuthorityPostflightGitState(
    { head: "b".repeat(40), status: "" },
    COMMIT,
  ));
  assert.throws(() => assertOrderPaymentEventAggregateAuthorityPostflightGitState(
    { head: COMMIT, status: " M file" },
    COMMIT,
  ));
});

test("aggregate-authority postflight accepts only exact catalog and bounded aggregates", () => {
  assert.deepEqual(
    assertOrderPaymentEventAggregateAuthorityRuntimeSnapshot(
      aggregateSnapshot(),
    ),
    {
      privateFunctionCount: 3,
      projectionColumnCount: 2,
      projectionQueryProven: true,
      triggerCount: 2,
    },
  );

  const forged = aggregateSnapshot();
  forged.functions[0].runtime_can_execute = true;
  assert.throws(() => assertOrderPaymentEventAggregateAuthorityRuntimeSnapshot(
    forged,
  ));

  const driftedTrigger = aggregateSnapshot();
  driftedTrigger.triggers[0].update_columns.reverse();
  assert.throws(() => assertOrderPaymentEventAggregateAuthorityRuntimeSnapshot(
    driftedTrigger,
  ));

  const impossibleAggregate = aggregateSnapshot();
  impossibleAggregate.projectionAggregate.refund_blocked_count = "3";
  assert.throws(() => assertOrderPaymentEventAggregateAuthorityRuntimeSnapshot(
    impossibleAggregate,
  ));
});

test("aggregate-authority postflight proves all private functions are denied", async () => {
  const attempted = [];
  const client = {
    async query(sql) {
      if (
        sql.startsWith("SAVEPOINT")
        || sql.startsWith("ROLLBACK TO")
        || sql.startsWith("RELEASE")
      ) {
        return { rows: [] };
      }
      attempted.push(sql);
      const error = new Error("denied");
      error.code = "42501";
      throw error;
    },
  };
  assert.deepEqual(
    await proveOrderPaymentEventAggregatePrivateExecutionDenied(client),
    { deniedFunctionCount: 3 },
  );
  assert.equal(attempted.length, 3);
});

test("aggregate-authority evidence is fresh, sanitized and mode 0600", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ope-aggregate-postflight-"));
  const evidencePath = path.join(directory, "evidence.json");
  writeOrderPaymentEventAggregateAuthorityPostflightEvidence(evidencePath, {
    status: "passed",
    rowsExported: false,
  });
  assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(evidencePath, "utf8")), {
    status: "passed",
    rowsExported: false,
  });
  assert.throws(() => writeOrderPaymentEventAggregateAuthorityPostflightEvidence(
    evidencePath,
    { status: "overwritten" },
  ));
  assert.throws(() => writeOrderPaymentEventAggregateAuthorityPostflightEvidence(
    path.join(directory, "unsafe.json"),
    { rawRows: [] },
  ));
});

test("aggregate-authority postflight source pins read-only and output safety", () => {
  const source = readFileSync(
    "scripts/order-payment-event-aggregate-authority-production-postflight.mjs",
    "utf8",
  );
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(source, /transaction_read_only/u);
  assert.match(source, /postgresChannelBindingClientOptions/u);
  assert.match(source, /rowsExported: false/u);
  assert.match(source, /privilegedDatabaseEnvironmentKeys/u);
  assert.match(source, /unreviewedPostgresUrlEnvironmentKeys/u);
  assert.match(source, /\)::text\[\] AS update_columns/u);
  assert.doesNotMatch(source, /INSERT INTO|UPDATE public|DELETE FROM|ALTER TABLE/u);
  assert.doesNotMatch(source, /console\.log\(.*databaseUrl/su);
});
