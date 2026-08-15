#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  verifyCheckoutStockReservationActivatedCatalog,
  verifyCheckoutStockReservationActivationRuntimeIdentity,
} from "./checkout-stock-reservation-activation-production-postflight.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS,
} from "./checkout-stock-reservation-authority-catalog.mjs";
import {
  verifyCheckoutStockReservationForceRelease,
} from "./verify-checkout-stock-reservation-force-release.mjs";

const { Client } = pg;
const DATABASE_ENV = "CHECKOUT_STOCK_RESERVATION_FORCE_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const RUNTIME_ROLE = "grainline_app_runtime";

export function parseCheckoutStockReservationForceProofConfig(
  env = process.env,
) {
  const databaseUrl = env[DATABASE_ENV];
  assert.ok(databaseUrl, `${DATABASE_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "FORCE proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), RUNTIME_ROLE);
  assert.ok(parsed.password, "FORCE proof requires direct runtime login");
  return Object.freeze({ databaseUrl });
}

async function expectedFailure(client, operation, code, label) {
  await client.query("SAVEPOINT checkout_reservation_force_expected_failure");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query(
    "ROLLBACK TO SAVEPOINT checkout_reservation_force_expected_failure",
  );
  await client.query(
    "RELEASE SAVEPOINT checkout_reservation_force_expected_failure",
  );
  assert.equal(caught?.code, code, `${label} returned the wrong SQLSTATE`);
}

export async function runCheckoutStockReservationForceProof(
  env = process.env,
) {
  const { databaseUrl } = parseCheckoutStockReservationForceProofConfig(env);
  verifyCheckoutStockReservationForceRelease();
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
    await verifyCheckoutStockReservationActivationRuntimeIdentity(
      client,
      { databaseName: DATABASE_NAME, runtimeRole: RUNTIME_ROLE },
      "ci",
    );
    await verifyCheckoutStockReservationActivatedCatalog(client, "ci", true);
    await expectedFailure(
      client,
      () => client.query(
        'SELECT id FROM public."CheckoutStockReservation" LIMIT 1',
      ),
      "42501",
      "direct runtime read",
    );
    const exported = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public.grainline_checkout_reservation_export(
          'grainline-ci-force-proof-absent-user'
        )
    `);
    assert.deepEqual(exported.rows, [{ count: 0 }]);
    await expectedFailure(
      client,
      () => client.query(`
        SELECT public.grainline_checkout_reservation_restore_items('[]'::jsonb)
      `),
      "42501",
      "private helper execution",
    );
    await expectedFailure(
      client,
      () => client.query(`
        SELECT public.grainline_checkout_reservation_prune_batch(1)
      `),
      "25006",
      "fixed write read-only fence",
    );
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      database: DATABASE_NAME,
      runtimeRole: RUNTIME_ROLE,
      directRuntimeLogin: true,
      sourcePinnedFunctions:
        CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS.length,
      postflightReadOnly: true,
      policyCount: 0,
      rlsEnabled: true,
      rlsForced: true,
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
    process.stdout.write(`${JSON.stringify(
      await runCheckoutStockReservationForceProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `CheckoutStockReservation FORCE PostgreSQL proof failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
