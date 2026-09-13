#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  assertOrderPaymentEventCompatibleProductionScope,
  readOrderPaymentEventCompatibleProductionSnapshot,
} from "./verify-order-payment-event-compatible-production-scope.mjs";

const PREFIX = "OrderPaymentEvent compatible production-scope PostgreSQL proof";

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function assertLoopbackFixture(value) {
  const parsed = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
    || decodeURIComponent(parsed.username) !== "ci"
  ) {
    throw new Error(`${PREFIX} refuses a non-loopback CI database`);
  }
  return value;
}

export async function runOrderPaymentEventCompatibleProductionScopePostgresProof(
  env = process.env,
) {
  const connectionString = assertLoopbackFixture(required(
    env,
    "ORDER_PAYMENT_EVENT_COMPATIBLE_SCOPE_PROOF_DATABASE_URL",
  ));
  const snapshot = await readOrderPaymentEventCompatibleProductionSnapshot(
    connectionString,
  );
  const result = assertOrderPaymentEventCompatibleProductionScope(
    snapshot,
    "after",
    { migrationRole: "ci" },
  );
  if (
    result.state !== "prepared"
    || result.compatibleMigrationPrefixLength !== 5
    || result.orderPaymentEventRlsEnabled !== false
    || result.predecessorRuntimeCrudRetained !== true
    || result.reconciliationPolicylessForce !== true
  ) {
    throw new Error(`${PREFIX} returned an unexpected compatible state`);
  }
  return Object.freeze({
    proofMode: "loopback-postgresql16-engine-read-only-catalog",
    state: result.state,
    compatibleMigrationPrefixLength: result.compatibleMigrationPrefixLength,
    productionChangedByProof: false,
  });
}

async function main() {
  try {
    const result = await runOrderPaymentEventCompatibleProductionScopePostgresProof();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${PREFIX} failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
