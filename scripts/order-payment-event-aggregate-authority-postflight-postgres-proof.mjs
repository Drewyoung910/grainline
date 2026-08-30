#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  assertOrderPaymentEventAggregateAuthorityRuntimeSnapshot,
  proveOrderPaymentEventAggregatePrivateExecutionDenied,
  readOrderPaymentEventAggregateAuthorityRuntimeSnapshot,
} from "./order-payment-event-aggregate-authority-production-postflight.mjs";
import {
  proveOrderPaymentEventReadAuthorityRuntimeBoundaries,
  proveOrderPaymentEventReadAuthorityRuntimeCatalog,
  verifyOrderPaymentEventReadAuthorityRuntimeIdentity,
} from "./order-payment-event-read-authority-production-postflight.mjs";

const { Client } = pg;
const PROOF_URL_ENV =
  "ORDER_PAYMENT_EVENT_AGGREGATE_POSTFLIGHT_PROOF_DATABASE_URL";

export function parseOrderPaymentEventAggregatePostflightProofConfig(
  env = process.env,
) {
  const value = env?.[PROOF_URL_ENV];
  assert.ok(value, `${PROOF_URL_ENV} is required`);
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    `${PROOF_URL_ENV} refuses a non-loopback database`,
  );
  assert.equal(decodeURIComponent(parsed.username), "grainline_app_runtime");
  assert.ok(parsed.password, `${PROOF_URL_ENV} requires a password`);
  assert.equal(decodeURIComponent(parsed.pathname), "/grainline_ci");
  assert.equal(parsed.searchParams.get("sslmode"), "disable");
  return Object.freeze({ databaseUrl: value });
}

export async function runOrderPaymentEventAggregatePostflightPostgresProof(
  config,
) {
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-ope-aggregate-postflight-proof",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const transaction = await client.query(`
      SELECT
        pg_catalog.current_setting('transaction_isolation') AS isolation,
        pg_catalog.current_setting('transaction_read_only') AS read_only
    `);
    assert.deepEqual(transaction.rows, [{
      isolation: "repeatable read",
      read_only: "on",
    }]);
    await verifyOrderPaymentEventReadAuthorityRuntimeIdentity(client, {
      databaseName: "grainline_ci",
      runtimeRole: "grainline_app_runtime",
    }, "ci");
    const readCatalog = await proveOrderPaymentEventReadAuthorityRuntimeCatalog(
      client,
      "ci",
    );
    const readBoundary =
      await proveOrderPaymentEventReadAuthorityRuntimeBoundaries(client);
    const aggregate = assertOrderPaymentEventAggregateAuthorityRuntimeSnapshot(
      await readOrderPaymentEventAggregateAuthorityRuntimeSnapshot(client),
      { functionOwner: "ci", root: process.cwd() },
    );
    const denial =
      await proveOrderPaymentEventAggregatePrivateExecutionDenied(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      aggregatePrivateFunctionCount: aggregate.privateFunctionCount,
      aggregateProjectionColumnCount: aggregate.projectionColumnCount,
      aggregateTriggerCount: aggregate.triggerCount,
      deniedPrivateFunctionCount: denial.deniedFunctionCount,
      engineReadOnlyProven: true,
      readAuthorityFunctionCount: readCatalog.functionCount,
      readAuthorityProjectionCount: readBoundary.projectionCount,
      runtimeIdentityProven: true,
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function main() {
  try {
    const result = await runOrderPaymentEventAggregatePostflightPostgresProof(
      parseOrderPaymentEventAggregatePostflightProofConfig(),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent aggregate-authority postflight PostgreSQL proof failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
