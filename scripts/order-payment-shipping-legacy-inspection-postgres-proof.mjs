#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS,
  ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
  normalizeOrderPaymentShippingLegacyCounts,
} from "./order-payment-shipping-legacy-inspect.mjs";

const { Client } = pg;

const DATABASE_NAME = "grainline_ci";
const PROOF_ENV =
  "ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_PROOF_DATABASE_URL";

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

function applicationUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set(
    "application_name",
    "grainline-order-payment-shipping-legacy-inspection-proof",
  );
  return parsed.toString();
}

export function parseOrderPaymentShippingLegacyInspectionProofConfig(
  env = process.env,
) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(
    parsed.protocol,
    "postgresql:",
    "Order/payment/shipping legacy inspection proof requires PostgreSQL",
  );
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Order/payment/shipping legacy inspection proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Order/payment/shipping legacy inspection proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

export async function runOrderPaymentShippingLegacyInspectionProof(databaseUrl) {
  const client = new Client({
    connectionString: applicationUrl(databaseUrl),
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
  let counts;
  let transactionOpen = false;
  try {
    await client.connect();
    const identity = await client.query(`
      SELECT
        CURRENT_USER AS current_user,
        pg_catalog.current_database() AS database_name
    `);
    assert.deepEqual(identity.rows, [
      {
        current_user: "ci",
        database_name: DATABASE_NAME,
      },
    ]);
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const readOnly = await client.query(
      "SELECT pg_catalog.current_setting('transaction_read_only') AS value",
    );
    assert.equal(
      readOnly.rows[0]?.value,
      "on",
      "Order/payment/shipping legacy inspection proof transaction is not read-only",
    );
    const result = await client.query(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
    );
    assert.equal(
      result.rows.length,
      1,
      "Order/payment/shipping legacy inspection proof returned an unexpected row count",
    );
    counts = normalizeOrderPaymentShippingLegacyCounts(result.rows[0]);
    await client.query("ROLLBACK");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
  return Object.freeze({
    aggregateFieldCount: ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS.length,
    database: "loopback/grainline_ci",
    productionChanged: false,
    queryExecuted: true,
    schemaAccepted: true,
    zeroRowDatabase: Object.values(counts).every((value) => value === 0),
  });
}

async function main() {
  const config = parseOrderPaymentShippingLegacyInspectionProofConfig(
    process.env,
  );
  const result = await runOrderPaymentShippingLegacyInspectionProof(
    config.databaseUrl,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
