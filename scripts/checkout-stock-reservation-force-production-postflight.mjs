#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS,
} from "./checkout-stock-reservation-authority-catalog.mjs";
import {
  readCheckoutStockReservationActivationPostflightGitState,
  verifyCheckoutStockReservationActivatedCatalog,
  verifyCheckoutStockReservationActivationRuntimeIdentity,
} from "./checkout-stock-reservation-activation-production-postflight.mjs";
import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
  assertVercelRuntimeDatabaseIsolation,
  privilegedDatabaseEnvironmentKeys,
  unreviewedPostgresUrlEnvironmentKeys,
} from "./guard-runtime-db-env.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRMATION =
  "verify-production-checkout-stock-reservation-force-runtime-read-only";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,19}$/;
const EVIDENCE_PREFIX =
  "checkout-stock-reservation-force-production-postflight-";

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function positiveInteger(env, key) {
  const raw = required(env, key);
  if (!SAFE_POSITIVE_INTEGER.test(raw)) {
    throw new Error(`${key} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${key} must be a safe positive integer`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function assertCheckoutStockReservationForcePostflightGitState(
  state,
  releaseCommit,
) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "CheckoutStockReservation FORCE postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

export function parseCheckoutStockReservationForcePostflightConfig(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "CheckoutStockReservation FORCE production postflight",
  );
  if (
    env.CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRM
      !== CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error(
      "CheckoutStockReservation FORCE postflight confirmation is invalid",
    );
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `CheckoutStockReservation FORCE postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `CheckoutStockReservation FORCE postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("CheckoutStockReservation FORCE release commit is invalid");
  }
  const databaseUrl = required(env, "DATABASE_URL");
  const runtimeIdentity = assertVercelRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: databaseUrl,
    RUNTIME_DB_ROLE: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
    PGOPTIONS: env.PGOPTIONS,
  });
  const evidencePath = path.resolve(required(
    env,
    "CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_EVIDENCE_PATH",
  ));
  if (
    path.basename(evidencePath) !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "CheckoutStockReservation FORCE evidence path is not fresh and exact",
    );
  }

  return Object.freeze({
    databaseUrl,
    databaseUrlSha256: sha256(databaseUrl),
    evidencePath,
    mainCiRunId: positiveInteger(
      env,
      "CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID",
    ),
    migrationRunId: positiveInteger(
      env,
      "CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_MIGRATION_RUN_ID",
    ),
    releaseCommit,
    runtimeIdentity,
  });
}

async function expectSqlState(client, operation, code, label) {
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

export function writeCheckoutStockReservationForcePostflightEvidence(
  pathname,
  evidence,
) {
  const descriptor = openSync(pathname, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(pathname, 0o600);
  const stat = lstatSync(pathname);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error(
      "CheckoutStockReservation FORCE evidence is not mode 0600",
    );
  }
}

export async function runCheckoutStockReservationForcePostflight(config) {
  const git = assertCheckoutStockReservationForcePostflightGitState(
    readCheckoutStockReservationActivationPostflightGitState(),
    config.releaseCommit,
  );
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-checkout-stock-reservation-force-postflight",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(new URL(config.databaseUrl)),
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
    await verifyCheckoutStockReservationActivationRuntimeIdentity(
      client,
      config.runtimeIdentity,
    );
    await verifyCheckoutStockReservationActivatedCatalog(
      client,
      "neondb_owner",
      true,
    );
    await expectSqlState(
      client,
      () => client.query(
        'SELECT id FROM public."CheckoutStockReservation" LIMIT 1',
      ),
      "42501",
      "direct table read",
    );
    const fixedRead = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public.grainline_checkout_reservation_export(
          'grainline-force-postflight-absent-user'
        )
    `);
    assert.deepEqual(fixedRead.rows, [{ count: 0 }]);
    await expectSqlState(
      client,
      () => client.query(`
        SELECT public.grainline_checkout_reservation_restore_items('[]'::jsonb)
      `),
      "42501",
      "private helper execution",
    );
    await expectSqlState(
      client,
      () => client.query(`
        SELECT public.grainline_checkout_reservation_prune_batch(1)
      `),
      "25006",
      "fixed write read-only fence",
    );
    await client.query("ROLLBACK");
    transactionOpen = false;

    const evidence = Object.freeze({
      schemaVersion: 1,
      operation: "checkout-stock-reservation-force-production-postflight",
      source: Object.freeze({ clean: git.clean, commit: git.head }),
      target: Object.freeze({
        databaseName: config.runtimeIdentity.databaseName,
        databaseUrlSha256: config.databaseUrlSha256,
        endpointId: config.runtimeIdentity.endpointId,
        region: config.runtimeIdentity.region,
        role: config.runtimeIdentity.runtimeRole,
      }),
      runs: Object.freeze({
        mainCiRunId: config.mainCiRunId,
        migrationRunId: config.migrationRunId,
      }),
      proof: Object.freeze({
        functionCount: CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS.length,
        policyCount: 0,
        postflightReadOnly: true,
        publicAuthority: false,
        rlsEnabled: true,
        rlsForced: true,
        runtimeTableOrColumnAuthority: false,
        checks: Object.freeze([
          "engine_attested_repeatable_read_read_only_transaction",
          "actual_pooled_runtime_role_identity",
          "policyless_enable_force_table_posture",
          "zero_public_and_runtime_table_or_column_authority",
          "exact_twenty_five_function_source_mode_owner_and_acl_catalog",
          "direct_table_read_denied",
          "fixed_export_succeeds",
          "private_helper_execution_denied",
          "fixed_write_reaches_read_only_fence",
        ]),
      }),
      completedAt: new Date().toISOString(),
      productionChangedByPostflight: false,
      status: "passed",
    });
    writeCheckoutStockReservationForcePostflightEvidence(
      config.evidencePath,
      evidence,
    );
    return evidence;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function main() {
  try {
    const config = parseCheckoutStockReservationForcePostflightConfig(
      process.env,
    );
    const evidence = await runCheckoutStockReservationForcePostflight(config);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.source.commit,
      postflightReadOnly: evidence.proof.postflightReadOnly,
      productionChangedByPostflight: evidence.productionChangedByPostflight,
    })}\n`);
  } catch (error) {
    process.stderr.write(
      `CheckoutStockReservation FORCE production postflight failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
