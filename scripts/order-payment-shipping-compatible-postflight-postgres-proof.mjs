#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  runOrderPaymentShippingCompatiblePostflight,
} from "./order-payment-shipping-compatible-production-postflight.mjs";

const { Client } = pg;
const PROOF_ENV =
  "ORDER_PAYMENT_SHIPPING_COMPATIBLE_POSTFLIGHT_PROOF_DATABASE_URL";
const PROOF_DATABASE = "grainline_ci";
const PROOF_OWNER = "ci";
const PROOF_RUNTIME_ROLE = "grainline_app_runtime";
const PROOF_PASSWORD = "order-payment-shipping-compatible-proof";

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseOrderPaymentShippingCompatiblePostflightProofConfig(
  env = process.env,
) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Order/payment/shipping compatible postflight proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, `/${PROOF_DATABASE}`);
  assert.equal(decodeURIComponent(parsed.username), PROOF_OWNER);
  return Object.freeze({ databaseUrl });
}

function client(connectionString, applicationName) {
  return new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
  });
}

export async function runOrderPaymentShippingCompatiblePostflightProof(
  config,
) {
  const owner = client(
    config.databaseUrl,
    "grainline-order-payment-shipping-compatible-postflight-proof-owner",
  );
  await owner.connect();
  let passwordInstalled = false;
  try {
    const identity = await owner.query(`
      SELECT
        pg_catalog.current_database() AS database_name,
        CURRENT_USER AS current_user_name,
        SESSION_USER AS session_user_name
    `);
    assert.deepEqual(identity.rows, [{
      database_name: PROOF_DATABASE,
      current_user_name: PROOF_OWNER,
      session_user_name: PROOF_OWNER,
    }]);
    await owner.query(`
      ALTER ROLE grainline_app_runtime
      PASSWORD 'order-payment-shipping-compatible-proof'
    `);
    passwordInstalled = true;

    const runtimeUrl = new URL(config.databaseUrl);
    runtimeUrl.username = PROOF_RUNTIME_ROLE;
    runtimeUrl.password = PROOF_PASSWORD;
    const result = await runOrderPaymentShippingCompatiblePostflight({
      databaseUrl: runtimeUrl.toString(),
      mainCiRunId: 1,
      migrationRole: PROOF_OWNER,
      migrationRunId: 1,
      releaseCommit: "f".repeat(40),
      runtimeGuard: Object.freeze({
        databaseName: PROOF_DATABASE,
        endpointId: "loopback",
        region: "loopback",
        runtimeRole: PROOF_RUNTIME_ROLE,
      }),
    });
    assert.equal(result.status, "passed");
    assert.equal(result.postflightReadOnly, true);
    assert.equal(result.productionChangedByPostflight, false);
    return result;
  } finally {
    if (passwordInstalled) {
      await owner.query(`
        ALTER ROLE grainline_app_runtime PASSWORD NULL
      `).catch(() => {});
    }
    await owner.end();
  }
}

async function main() {
  try {
    const config =
      parseOrderPaymentShippingCompatiblePostflightProofConfig(process.env);
    const result =
      await runOrderPaymentShippingCompatiblePostflightProof(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `Order/payment/shipping compatible postflight PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
