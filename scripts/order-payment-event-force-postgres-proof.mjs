#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  parseOrderPaymentEventActivationProofConfig,
} from "./order-payment-event-activation-postgres-proof.mjs";
import {
  assertOrderPaymentEventActivationProductionScope,
  readOrderPaymentEventActivationProductionSnapshotFromClient,
} from "./verify-order-payment-event-activation-production-scope.mjs";
import {
  verifyOrderPaymentEventForceRelease,
} from "./verify-order-payment-event-force-release.mjs";

const { Client } = pg;
const OWNER_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";

async function expectedFailure(
  client,
  label,
  sql,
  params,
  expectedCode,
  expectedMessage,
) {
  await client.query("SAVEPOINT order_payment_force_expected_failure");
  let caught;
  try {
    await client.query(sql, params);
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT order_payment_force_expected_failure");
  await client.query("RELEASE SAVEPOINT order_payment_force_expected_failure");
  assert.ok(caught, `${label} unexpectedly succeeded`);
  assert.equal(caught.code, expectedCode, `${label} returned wrong SQLSTATE`);
  if (expectedMessage) assert.match(caught.message, expectedMessage, label);
}

async function proveOwnerCatalog(owner) {
  await owner.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const transaction = await owner.query(`
      SELECT pg_catalog.current_setting('transaction_isolation') AS isolation,
             pg_catalog.current_setting('transaction_read_only') AS read_only
    `);
    assert.deepEqual(transaction.rows, [{
      isolation: "repeatable read",
      read_only: "on",
    }]);
    const snapshot =
      await readOrderPaymentEventActivationProductionSnapshotFromClient(
        owner,
        { runtimeRole: RUNTIME_ROLE },
      );
    const result = assertOrderPaymentEventActivationProductionScope(
      snapshot,
      "after",
      {
        migrationRole: OWNER_ROLE,
        runtimeRole: RUNTIME_ROLE,
        expectedForce: true,
      },
    );
    await owner.query("ROLLBACK");
    return result;
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function proveRuntimeBoundary(runtime) {
  const identity = await runtime.query(`
    SELECT pg_catalog.current_database() AS database_name,
           CURRENT_USER AS current_user,
           SESSION_USER AS session_user
  `);
  assert.deepEqual(identity.rows, [{
    database_name: "grainline_ci",
    current_user: RUNTIME_ROLE,
    session_user: RUNTIME_ROLE,
  }]);

  await runtime.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const transaction = await runtime.query(`
      SELECT pg_catalog.current_setting('transaction_isolation') AS isolation,
             pg_catalog.current_setting('transaction_read_only') AS read_only
    `);
    assert.deepEqual(transaction.rows, [{
      isolation: "repeatable read",
      read_only: "on",
    }]);
    await expectedFailure(
      runtime,
      "direct_select",
      'SELECT id FROM public."OrderPaymentEvent" LIMIT 1',
      [],
      "42501",
    );
    for (const [label, sql] of [
      ["direct_insert", 'INSERT INTO public."OrderPaymentEvent" DEFAULT VALUES'],
      ["direct_update", 'UPDATE public."OrderPaymentEvent" SET id = id WHERE false'],
      ["direct_delete", 'DELETE FROM public."OrderPaymentEvent" WHERE false'],
    ]) {
      await expectedFailure(runtime, label, sql, [], "25006");
    }
    await expectedFailure(
      runtime,
      "retired_case_entry_point",
      "SELECT public.grainline_case_seller_refund_apply($1, $2)",
      ["missing-case", "missing-event"],
      "42501",
    );
    await expectedFailure(
      runtime,
      "retired_blocked_checkout_entry_point",
      "SELECT * FROM public.grainline_blocked_checkout_refund_claim($1, $2, $3, $4, $5)",
      ["missing-event", 1, "missing-order", "missing-session", 500],
      "42501",
    );

    for (const [sql, params] of [
      [
        "SELECT * FROM public.grainline_order_payment_buyer_refund_outcomes($1, ARRAY[$2]::text[])",
        ["missing-buyer", "missing-order"],
      ],
      [
        "SELECT * FROM public.grainline_order_payment_seller_refund_outcomes($1, ARRAY[$2]::text[])",
        ["missing-seller", "missing-order"],
      ],
      [
        "SELECT * FROM public.grainline_order_payment_buyer_export_page($1, 1, NULL, NULL)",
        ["missing-buyer"],
      ],
      [
        "SELECT * FROM public.grainline_order_payment_seller_export_page($1, 1, NULL, NULL)",
        ["missing-seller"],
      ],
    ]) {
      const result = await runtime.query(sql, params);
      assert.equal(result.rowCount, 0);
    }
    await expectedFailure(
      runtime,
      "staff_projection_actor_check",
      "SELECT * FROM public.grainline_order_payment_staff_timeline($1, $2, 1)",
      ["missing-staff", "missing-order"],
      "42501",
      /Staff payment timeline access denied/u,
    );
    await expectedFailure(
      runtime,
      "fixed_writer_read_only_fence",
      "SELECT public.grainline_seller_refund_claim($1, $2)",
      ["missing-order", "missing-refund"],
      "25006",
    );
    await runtime.query("ROLLBACK");
  } catch (error) {
    await runtime.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function runOrderPaymentEventForcePostgresProof(env = process.env) {
  const { ownerUrl, runtimeUrl } =
    parseOrderPaymentEventActivationProofConfig(env);
  verifyOrderPaymentEventForceRelease(process.cwd(), {
    allowReviewedOrderParticipantListSuccessor: true,
  });
  const owner = new Client({ connectionString: ownerUrl });
  const runtime = new Client({ connectionString: runtimeUrl });
  await owner.connect();
  await runtime.connect();
  try {
    const catalog = await proveOwnerCatalog(owner);
    await proveRuntimeBoundary(runtime);
    return Object.freeze({
      database: "grainline_ci",
      directRuntimeLogin: true,
      directTableOperationsDenied: 4,
      retiredFunctionExecutionsDenied: 2,
      retainedReadFunctionsExecuted: 5,
      fixedWriterReadOnlyFenced: true,
      runtimeFunctionCount: catalog.runtimeFunctionCount,
      privateFunctionCount: catalog.privateFunctionCount,
      policyCount: catalog.policyCount,
      rlsEnabled: catalog.orderPaymentEventRlsEnabled,
      rlsForced: catalog.orderPaymentEventRlsForced,
      rowDataChanged: false,
      productionTouched: false,
    });
  } finally {
    await runtime.end().catch(() => {});
    await owner.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      await runOrderPaymentEventForcePostgresProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent FORCE PostgreSQL proof failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
