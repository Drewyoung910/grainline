#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  proveOrderPaymentEventCompatibleRuntimeBoundaries,
  proveOrderPaymentEventCompatibleRuntimeCatalog,
  verifyOrderPaymentEventCompatibleRuntimeIdentity,
} from "./order-payment-event-compatible-production-postflight.mjs";

const { Client } = pg;
const DATABASE_ENV =
  "ORDER_PAYMENT_EVENT_COMPATIBLE_POSTFLIGHT_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const OWNER_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";

export function parseOrderPaymentEventCompatiblePostflightProofConfig(
  env = process.env,
) {
  const databaseUrl = env[DATABASE_ENV];
  assert.ok(databaseUrl, `${DATABASE_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "OrderPaymentEvent compatible postflight proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), RUNTIME_ROLE);
  assert.ok(
    parsed.password,
    "OrderPaymentEvent compatible postflight proof requires direct runtime login",
  );
  return Object.freeze({ databaseUrl });
}

export async function runOrderPaymentEventCompatiblePostflightProof(
  env = process.env,
) {
  const { databaseUrl } =
    parseOrderPaymentEventCompatiblePostflightProofConfig(env);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let transactionOpen = false;
  try {
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
    await verifyOrderPaymentEventCompatibleRuntimeIdentity(
      client,
      { databaseName: DATABASE_NAME, runtimeRole: RUNTIME_ROLE },
      OWNER_ROLE,
    );
    const catalog = await proveOrderPaymentEventCompatibleRuntimeCatalog(
      client,
      OWNER_ROLE,
    );
    await proveOrderPaymentEventCompatibleRuntimeBoundaries(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      database: DATABASE_NAME,
      runtimeRole: RUNTIME_ROLE,
      directRuntimeLogin: true,
      functionCount: catalog.functionCount,
      orderPaymentEventRlsEnabled: false,
      orderRefundReconciliationRlsForced: true,
      postflightReadOnly: true,
      residue: 0,
      productionTouched: false,
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(
        await runOrderPaymentEventCompatiblePostflightProof(),
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent compatible postflight PostgreSQL proof failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
