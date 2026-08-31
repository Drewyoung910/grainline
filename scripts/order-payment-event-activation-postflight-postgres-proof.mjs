#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  proveOrderPaymentEventActivationRuntimePosture,
} from "./order-payment-event-activation-production-postflight.mjs";

const { Client } = pg;
const DATABASE_ENV =
  "ORDER_PAYMENT_EVENT_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const OWNER_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";

export function parseOrderPaymentEventActivationPostflightProofConfig(
  env = process.env,
) {
  const databaseUrl = env[DATABASE_ENV];
  assert.ok(databaseUrl, `${DATABASE_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "OrderPaymentEvent activation postflight proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), RUNTIME_ROLE);
  assert.ok(
    parsed.password,
    "OrderPaymentEvent activation postflight proof requires direct login",
  );
  assert.equal(parsed.searchParams.get("sslmode"), "disable");
  return Object.freeze({ databaseUrl });
}

export async function runOrderPaymentEventActivationPostflightProof(
  env = process.env,
) {
  const { databaseUrl } =
    parseOrderPaymentEventActivationPostflightProofConfig(env);
  const client = new Client({
    application_name: "grainline-ope-activation-postflight-proof",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 35_000,
    statement_timeout: 30_000,
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const proof = await proveOrderPaymentEventActivationRuntimePosture(
      client,
      { databaseName: DATABASE_NAME, runtimeRole: RUNTIME_ROLE },
      { migrationRole: OWNER_ROLE },
    );
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      database: DATABASE_NAME,
      runtimeRole: RUNTIME_ROLE,
      directRuntimeLogin: true,
      ...proof,
      postflightReadOnly: true,
      productionTouched: false,
      residue: 0,
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      await runOrderPaymentEventActivationPostflightProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent activation postflight PostgreSQL proof failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
