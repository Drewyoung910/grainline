#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  assertOrderPaymentEventActivationProductionScope,
  readOrderPaymentEventActivationProductionSnapshotFromClient,
} from "./verify-order-payment-event-activation-production-scope.mjs";
import {
  verifyOrderPaymentEventActivationRelease,
} from "./verify-order-payment-event-activation-release.mjs";

const { Client } = pg;
const OWNER_ENV = "ORDER_PAYMENT_EVENT_ACTIVATION_PROOF_DATABASE_URL";
const RUNTIME_ENV =
  "ORDER_PAYMENT_EVENT_ACTIVATION_PROOF_RUNTIME_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const OWNER_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/giu, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
      "$1[redacted-credentials]@",
    );
}

function parseLoopbackUrl(raw, label, expectedRole) {
  assert.ok(raw, `${label} is required`);
  const parsed = new URL(raw);
  assert.equal(parsed.protocol, "postgresql:", `${label} requires PostgreSQL`);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    `${label} refuses a non-loopback database`,
  );
  assert.equal(decodeURIComponent(parsed.username), expectedRole);
  assert.ok(parsed.password, `${label} requires a password`);
  assert.equal(decodeURIComponent(parsed.pathname), `/${DATABASE_NAME}`);
  assert.equal(parsed.searchParams.get("sslmode"), "disable");
  return raw;
}

export function parseOrderPaymentEventActivationProofConfig(
  env = process.env,
) {
  return Object.freeze({
    ownerUrl: parseLoopbackUrl(env[OWNER_ENV], OWNER_ENV, OWNER_ROLE),
    runtimeUrl: parseLoopbackUrl(
      env[RUNTIME_ENV],
      RUNTIME_ENV,
      RUNTIME_ROLE,
    ),
  });
}

function client(connectionString, applicationName) {
  return new Client({
    application_name: applicationName,
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: 35_000,
    statement_timeout: 30_000,
  });
}

async function expectSqlState(
  runtime,
  label,
  sql,
  params,
  expectedCode,
  expectedMessage,
) {
  await runtime.query("BEGIN");
  let caught;
  try {
    await runtime.query(sql, params);
  } catch (error) {
    caught = error;
  }
  await runtime.query("ROLLBACK");
  assert.ok(caught, `${label} unexpectedly succeeded`);
  assert.equal(caught.code, expectedCode, `${label} returned wrong SQLSTATE`);
  if (expectedMessage) assert.match(caught.message, expectedMessage, label);
}

async function proveCatalog(owner) {
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
      { migrationRole: OWNER_ROLE, runtimeRole: RUNTIME_ROLE },
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
    database_name: DATABASE_NAME,
    current_user: RUNTIME_ROLE,
    session_user: RUNTIME_ROLE,
  }]);

  for (const [label, sql] of [
    ["direct_select", 'SELECT id FROM public."OrderPaymentEvent" LIMIT 1'],
    ["direct_insert", 'INSERT INTO public."OrderPaymentEvent" DEFAULT VALUES'],
    ["direct_update", 'UPDATE public."OrderPaymentEvent" SET id = id WHERE false'],
    ["direct_delete", 'DELETE FROM public."OrderPaymentEvent" WHERE false'],
  ]) {
    await expectSqlState(runtime, label, sql, [], "42501");
  }

  await expectSqlState(
    runtime,
    "retired_case_entry_point",
    "SELECT public.grainline_case_seller_refund_apply($1, $2)",
    ["missing-case", "missing-event"],
    "42501",
  );
  await expectSqlState(
    runtime,
    "retired_blocked_checkout_entry_point",
    "SELECT * FROM public.grainline_blocked_checkout_refund_claim($1, $2, $3, $4, $5)",
    ["missing-event", 1, "missing-order", "missing-session", 500],
    "42501",
  );

  const buyerOutcome = await runtime.query(`
    SELECT * FROM public.grainline_order_payment_buyer_refund_outcomes(
      $1, ARRAY[$2]::text[]
    )
  `, ["missing-buyer", "missing-order"]);
  const sellerOutcome = await runtime.query(`
    SELECT * FROM public.grainline_order_payment_seller_refund_outcomes(
      $1, ARRAY[$2]::text[]
    )
  `, ["missing-seller", "missing-order"]);
  const buyerExport = await runtime.query(`
    SELECT * FROM public.grainline_order_payment_buyer_export_page(
      $1, 1, NULL, NULL
    )
  `, ["missing-buyer"]);
  const sellerExport = await runtime.query(`
    SELECT * FROM public.grainline_order_payment_seller_export_page(
      $1, 1, NULL, NULL
    )
  `, ["missing-seller"]);
  assert.equal(buyerOutcome.rowCount, 0);
  assert.equal(sellerOutcome.rowCount, 0);
  assert.equal(buyerExport.rowCount, 0);
  assert.equal(sellerExport.rowCount, 0);

  await expectSqlState(
    runtime,
    "staff_projection_actor_check",
    "SELECT * FROM public.grainline_order_payment_staff_timeline($1, $2, 1)",
    ["missing-staff", "missing-order"],
    "42501",
    /Staff payment timeline access denied/u,
  );
}

export async function runOrderPaymentEventActivationPostgresProof(
  env = process.env,
) {
  const { ownerUrl, runtimeUrl } =
    parseOrderPaymentEventActivationProofConfig(env);
  verifyOrderPaymentEventActivationRelease();
  const owner = client(ownerUrl, "grainline-ope-activation-owner-proof");
  const runtime = client(runtimeUrl, "grainline-ope-activation-runtime-proof");
  await owner.connect();
  await runtime.connect();
  try {
    const catalog = await proveCatalog(owner);
    await proveRuntimeBoundary(runtime);
    return Object.freeze({
      database: DATABASE_NAME,
      directRuntimeLogin: true,
      directTableOperationsDenied: 4,
      retiredFunctionExecutionsDenied: 2,
      retainedReadFunctionsExecuted: 5,
      runtimeFunctionCount: catalog.runtimeFunctionCount,
      privateFunctionCount: catalog.privateFunctionCount,
      policyCount: catalog.policyCount,
      rlsEnabled: catalog.orderPaymentEventRlsEnabled,
      rlsForced: catalog.orderPaymentEventRlsForced,
      engineReadOnlyCatalogProof: true,
      rowDataChanged: false,
      productionTouched: false,
    });
  } finally {
    await runtime.end().catch(() => {});
    await owner.end().catch(() => {});
  }
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(
      await runOrderPaymentEventActivationPostgresProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent activation PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
