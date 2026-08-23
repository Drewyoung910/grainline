#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
  assertVercelRuntimeDatabaseIsolation,
  privilegedDatabaseEnvironmentKeys,
  unreviewedPostgresUrlEnvironmentKeys,
} from "./guard-runtime-db-env.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";
import {
  SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS,
} from "./verify-seller-payout-event-authority-production-scope.mjs";
import {
  proveSellerPayoutEventActivatedCatalog,
} from "./seller-payout-event-activation-postgres-proof.mjs";

const { Client } = pg;
const MIGRATION_ROLE = "neondb_owner";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/u;
const EVIDENCE_PREFIX =
  "seller-payout-event-activation-production-postflight-";

export const SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION =
  "verify-production-seller-payout-event-activation-runtime-read-only";

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

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/giu, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
      "$1[redacted-credentials]@",
    );
}

export function parseSellerPayoutEventActivationPostflightConfig(
  env = process.env,
  {
    assertRuntimeDatabaseIsolation = assertVercelRuntimeDatabaseIsolation,
  } = {},
) {
  assertDeterministicPostgresEnvironment(
    env,
    "SellerPayoutEvent activation production postflight",
  );
  if (
    env.SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRM
      !== SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error(
      "SellerPayoutEvent activation postflight confirmation is invalid",
    );
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `SellerPayoutEvent activation postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `SellerPayoutEvent activation postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("SellerPayoutEvent activation release commit is invalid");
  }
  const databaseUrl = required(env, "DATABASE_URL");
  const runtimeIdentity = assertRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: databaseUrl,
    RUNTIME_DB_ROLE: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
    PGOPTIONS: env.PGOPTIONS,
  });
  const evidencePath = path.resolve(required(
    env,
    "SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH",
  ));
  if (
    path.basename(evidencePath) !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "SellerPayoutEvent activation evidence path is not fresh and exact",
    );
  }

  return Object.freeze({
    databaseUrl,
    databaseUrlSha256: sha256(databaseUrl),
    evidencePath,
    mainCiRunId: positiveInteger(
      env,
      "SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID",
    ),
    migrationRunId: positiveInteger(
      env,
      "SELLER_PAYOUT_EVENT_ACTIVATION_POSTFLIGHT_MIGRATION_RUN_ID",
    ),
    releaseCommit,
    runtimeIdentity,
  });
}

export function readSellerPayoutEventActivationPostflightGitState(
  cwd = process.cwd(),
) {
  const run = (args) => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertSellerPayoutEventActivationPostflightGitState(
  state,
  releaseCommit,
) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "SellerPayoutEvent activation postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

async function expectSqlState(client, operation, code, label) {
  await client.query("SAVEPOINT seller_payout_activation_expected_failure");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query(
    "ROLLBACK TO SAVEPOINT seller_payout_activation_expected_failure",
  );
  await client.query(
    "RELEASE SAVEPOINT seller_payout_activation_expected_failure",
  );
  assert.equal(caught?.code, code, `${label} returned the wrong SQLSTATE`);
}

export async function verifySellerPayoutEventActivationRuntimeIdentity(
  client,
  expected,
  migrationRole = MIGRATION_ROLE,
) {
  const result = await client.query(`
    SELECT
      pg_catalog.current_database() AS database_name,
      CURRENT_USER AS current_user_name,
      SESSION_USER AS session_user_name,
      role.rolsuper,
      role.rolbypassrls,
      role.rolinherit,
      role.rolcanlogin,
      role.rolcreatedb,
      role.rolcreaterole,
      role.rolreplication,
      pg_catalog.pg_has_role(CURRENT_USER, $1, 'MEMBER') AS member_of_owner
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = CURRENT_USER
  `, [migrationRole]);
  assert.deepEqual(result.rows, [{
    database_name: expected.databaseName,
    current_user_name: expected.runtimeRole,
    session_user_name: expected.runtimeRole,
    rolsuper: false,
    rolbypassrls: false,
    rolinherit: false,
    rolcanlogin: true,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    member_of_owner: false,
  }]);
}

export async function runSellerPayoutEventActivationPostflight(config) {
  const git = assertSellerPayoutEventActivationPostflightGitState(
    readSellerPayoutEventActivationPostflightGitState(),
    config.releaseCommit,
  );
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-seller-payout-event-activation-postflight",
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
    await verifySellerPayoutEventActivationRuntimeIdentity(
      client,
      config.runtimeIdentity,
    );
    await proveSellerPayoutEventActivatedCatalog(client, MIGRATION_ROLE);
    await expectSqlState(
      client,
      () => client.query(
        'SELECT id FROM public."SellerPayoutEvent" LIMIT 1',
      ),
      "42501",
      "direct table read",
    );

    const absentActor = "seller-payout-activation-postflight-absent-user";
    const latest = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public.grainline_seller_payout_latest_failure($1)
    `, [absentActor]);
    assert.deepEqual(latest.rows, [{ count: 0 }]);
    const exported = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public.grainline_seller_payout_export_page(
          $1, 1, NULL, NULL
        )
    `, [absentActor]);
    assert.deepEqual(exported.rows, [{ count: 0 }]);

    const now = await client.query(`
      SELECT pg_catalog.floor(
        EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())
      )::bigint AS seconds
    `);
    await expectSqlState(
      client,
      () => client.query(`
        SELECT * FROM public.grainline_seller_payout_event_apply(
          'seller-payout-activation-postflight-absent-event',
          1,
          $1,
          'acct_seller_payout_activation_postflight_absent',
          'po_seller_payout_activation_postflight_absent',
          0,
          'usd',
          'postflight',
          'Read-only fence'
        )
      `, [now.rows[0]?.seconds]),
      "25006",
      "fixed write read-only fence",
    );
    await client.query("ROLLBACK");
    transactionOpen = false;

    const evidence = Object.freeze({
      schemaVersion: 1,
      operation: "seller-payout-event-activation-production-postflight",
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
        functionCount: SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS.length,
        policyCount: 0,
        postflightReadOnly: true,
        publicOrUnreviewedAuthority: false,
        rlsEnabled: true,
        rlsForced: false,
        runtimeTableOrColumnAuthority: false,
        checks: Object.freeze([
          "engine_attested_repeatable_read_read_only_transaction",
          "actual_pooled_runtime_role_identity",
          "policyless_enable_no_force_table_posture",
          "zero_unreviewed_runtime_or_public_table_or_column_authority",
          "exact_three_function_source_mode_owner_and_acl_catalog",
          "direct_table_read_denied",
          "fixed_latest_projection_succeeds",
          "fixed_export_projection_succeeds",
          "fixed_write_reaches_read_only_fence",
        ]),
      }),
      completedAt: new Date().toISOString(),
      productionChangedByPostflight: false,
      status: "passed",
    });
    writeSellerPayoutEventActivationPostflightEvidence(
      config.evidencePath,
      evidence,
    );
    return evidence;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

export function writeSellerPayoutEventActivationPostflightEvidence(
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
    throw new Error("SellerPayoutEvent activation evidence is not mode 0600");
  }
}

async function main() {
  try {
    const config = parseSellerPayoutEventActivationPostflightConfig();
    const evidence = await runSellerPayoutEventActivationPostflight(config);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.source.commit,
      postflightReadOnly: evidence.proof.postflightReadOnly,
      productionChangedByPostflight: evidence.productionChangedByPostflight,
    })}\n`);
  } catch (error) {
    process.stderr.write(
      `SellerPayoutEvent activation production postflight failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
