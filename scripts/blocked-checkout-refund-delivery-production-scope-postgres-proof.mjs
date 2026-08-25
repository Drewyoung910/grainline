#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  assertBlockedCheckoutRefundDeliveryProductionScope,
  readBlockedCheckoutRefundDeliveryProductionSnapshot,
} from "./verify-blocked-checkout-refund-delivery-production-scope.mjs";

const PREFIX =
  "Blocked-checkout refund delivery production-scope PostgreSQL proof";

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

export async function runBlockedCheckoutRefundDeliveryProductionScopePostgresProof(
  env = process.env,
) {
  const connectionString = assertLoopbackFixture(required(
    env,
    "BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_PROOF_DATABASE_URL",
  ));
  const snapshot = await readBlockedCheckoutRefundDeliveryProductionSnapshot(
    connectionString,
  );
  const result = assertBlockedCheckoutRefundDeliveryProductionScope(
    snapshot,
    "after",
    { migrationRole: "ci" },
  );
  if (
    result.state !== "delivery-compatible"
    || result.compatibleMigrationPrefixLength !== 5
    || result.blockedCheckoutRefundDeliveryApplied !== true
    || result.orderPaymentEventRlsEnabled !== false
    || result.predecessorRuntimeCrudRetained !== true
    || result.notificationRlsEnabled !== true
    || result.notificationRlsForced !== true
    || result.notificationGenericCoreRuntimePrivate !== true
  ) {
    throw new Error(`${PREFIX} returned an unexpected compatible state`);
  }
  return Object.freeze({
    proofMode: "loopback-postgresql16-engine-read-only-catalog",
    state: result.state,
    compatibleMigrationPrefixLength: result.compatibleMigrationPrefixLength,
    blockedCheckoutRefundDeliveryApplied:
      result.blockedCheckoutRefundDeliveryApplied,
    productionChangedByProof: false,
  });
}

async function main() {
  try {
    const result =
      await runBlockedCheckoutRefundDeliveryProductionScopePostgresProof();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${PREFIX} failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
