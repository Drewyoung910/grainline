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
  STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS,
  stripeWebhookEventFunctionSourceSha256,
} from "./stripe-webhook-event-function-source-catalog.mjs";

const { Client } = pg;

export const STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION =
  "verify-production-stripe-webhook-event-activation-runtime-read-only";
const MIGRATION_ROLE = "neondb_owner";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,19}$/;
const EVIDENCE_PREFIX =
  "stripe-webhook-event-activation-production-postflight-";

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

export function parseStripeWebhookEventActivationPostflightConfig(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "StripeWebhookEvent activation production postflight",
  );
  if (
    env.STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_CONFIRM
      !== STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error("StripeWebhookEvent activation postflight confirmation is invalid");
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `StripeWebhookEvent activation postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `StripeWebhookEvent activation postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("StripeWebhookEvent activation release commit is invalid");
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
    "STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH",
  ));
  if (
    path.basename(evidencePath) !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "StripeWebhookEvent activation evidence path is not fresh and exact",
    );
  }

  return Object.freeze({
    databaseUrl,
    databaseUrlSha256: sha256(databaseUrl),
    evidencePath,
    mainCiRunId: positiveInteger(
      env,
      "STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID",
    ),
    migrationRunId: positiveInteger(
      env,
      "STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_MIGRATION_RUN_ID",
    ),
    releaseCommit,
    runtimeIdentity,
  });
}

export function readStripeWebhookEventActivationPostflightGitState(
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

export function assertStripeWebhookEventActivationPostflightGitState(
  state,
  releaseCommit,
) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "StripeWebhookEvent activation postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

async function expectSqlState(client, operation, code, label) {
  await client.query("SAVEPOINT stripe_webhook_activation_expected_failure");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query(
    "ROLLBACK TO SAVEPOINT stripe_webhook_activation_expected_failure",
  );
  await client.query(
    "RELEASE SAVEPOINT stripe_webhook_activation_expected_failure",
  );
  assert.equal(caught?.code, code, `${label} returned the wrong SQLSTATE`);
}

export async function verifyStripeWebhookEventActivationRuntimeIdentity(
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

export async function verifyStripeWebhookEventActivatedCatalog(
  client,
  migrationRole = MIGRATION_ROLE,
) {
  const table = await client.query(`
    SELECT
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      pg_catalog.pg_get_userbyid(class.relowner) AS owner_name,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid) AS policy_count,
      pg_catalog.has_table_privilege(
        CURRENT_USER, class.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) AS runtime_table_authority,
      pg_catalog.has_any_column_privilege(
        CURRENT_USER, class.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
      ) AS runtime_column_authority,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type IN (
             'SELECT', 'INSERT', 'UPDATE', 'DELETE',
             'TRUNCATE', 'REFERENCES', 'TRIGGER'
           )
      ) AS public_table_authority,
      EXISTS (
        SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
         WHERE attribute.attrelid = class.oid
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND acl.grantee = 0
           AND acl.privilege_type IN (
             'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
           )
      ) AS public_column_authority
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'StripeWebhookEvent'
     AND class.relkind = 'r'
  `);
  assert.deepEqual(table.rows, [{
    rls_enabled: true,
    rls_forced: false,
    owner_name: migrationRole,
    policy_count: 0,
    runtime_table_authority: false,
    runtime_column_authority: false,
    public_table_authority: false,
    public_column_authority: false,
  }]);

  const names = STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS.map((entry) => entry.name);
  const functions = await client.query(`
    SELECT
      procedure.proname AS function_name,
      pg_catalog.oidvectortypes(procedure.proargtypes) AS identity_arguments,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      procedure.prokind AS function_kind,
      procedure.prosecdef AS security_definer,
      procedure.proleakproof AS leakproof,
      procedure.provolatile AS volatility,
      procedure.proparallel AS parallel_mode,
      procedure.proconfig AS function_config,
      procedure.prosrc AS function_source,
      pg_catalog.has_function_privilege(
        CURRENT_USER, procedure.oid, 'EXECUTE'
      ) AS runtime_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.privilege_type = 'EXECUTE'
          AND (
            acl.grantee NOT IN (
              procedure.proowner,
              (SELECT role.oid FROM pg_catalog.pg_roles AS role
                WHERE role.rolname = CURRENT_USER)
            )
            OR (
              acl.grantee = (
                SELECT role.oid FROM pg_catalog.pg_roles AS role
                 WHERE role.rolname = CURRENT_USER
              )
              AND (acl.grantor <> procedure.proowner OR acl.is_grantable)
            )
          )) AS invalid_acl_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY($1::text[])
   ORDER BY procedure.proname
  `, [names]);
  assert.equal(functions.rows.length, STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS.length);
  const expectedByName = new Map(
    STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS.map((entry) => [entry.name, entry]),
  );
  const sourceHashes = stripeWebhookEventFunctionSourceSha256();
  for (const row of functions.rows) {
    const expected = expectedByName.get(row.function_name);
    assert.ok(expected, row.function_name);
    assert.equal(row.identity_arguments, expected.identityArguments, row.function_name);
    assert.equal(row.owner_name, migrationRole, row.function_name);
    assert.equal(row.function_kind, "f", row.function_name);
    assert.equal(row.security_definer, true, row.function_name);
    assert.equal(row.leakproof, false, row.function_name);
    assert.equal(row.volatility, "v", row.function_name);
    assert.equal(row.parallel_mode, "u", row.function_name);
    assert.deepEqual(row.function_config, ["search_path=pg_catalog"], row.function_name);
    assert.equal(row.runtime_execute, true, row.function_name);
    assert.equal(row.public_execute, false, row.function_name);
    assert.equal(row.invalid_acl_count, 0, row.function_name);
    assert.equal(
      sha256(row.function_source),
      sourceHashes[row.function_name],
      `${row.function_name} source drifted`,
    );
  }
}

export async function runStripeWebhookEventActivationPostflight(config) {
  const git = assertStripeWebhookEventActivationPostflightGitState(
    readStripeWebhookEventActivationPostflightGitState(),
    config.releaseCommit,
  );
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-stripe-webhook-event-activation-postflight",
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
    await verifyStripeWebhookEventActivationRuntimeIdentity(
      client,
      config.runtimeIdentity,
    );
    await verifyStripeWebhookEventActivatedCatalog(client);
    await expectSqlState(
      client,
      () => client.query(`SELECT id FROM public."StripeWebhookEvent" LIMIT 1`),
      "42501",
      "direct table read",
    );
    const health = await client.query(`
      SELECT * FROM public.grainline_stripe_webhook_health_summary()
    `);
    assert.equal(health.rowCount, 1);
    await expectSqlState(
      client,
      () => client.query(
        "SELECT action FROM public.grainline_stripe_webhook_begin($1, $2)",
        [
          `evt_grainline_postflight_${config.releaseCommit}`,
          "grainline.postflight",
        ],
      ),
      "25006",
      "begin function read-only fence",
    );
    await client.query("ROLLBACK");
    transactionOpen = false;

    const evidence = Object.freeze({
      schemaVersion: 1,
      operation: "stripe-webhook-event-activation-production-postflight",
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
        functionCount: STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS.length,
        policyCount: 0,
        postflightReadOnly: true,
        publicAuthority: false,
        rlsEnabled: true,
        rlsForced: false,
        runtimeTableOrColumnAuthority: false,
        checks: Object.freeze([
          "engine_attested_repeatable_read_read_only_transaction",
          "actual_pooled_runtime_role_identity",
          "policyless_enable_no_force_table_posture",
          "zero_public_and_runtime_table_or_column_authority",
          "exact_six_function_source_mode_owner_and_acl_catalog",
          "direct_table_read_denied",
          "health_summary_succeeds",
          "begin_function_reaches_read_only_fence",
        ]),
      }),
      completedAt: new Date().toISOString(),
      productionChangedByPostflight: false,
      status: "passed",
    });
    writeStripeWebhookEventActivationPostflightEvidence(
      config.evidencePath,
      evidence,
    );
    return evidence;
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

export function writeStripeWebhookEventActivationPostflightEvidence(
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
    throw new Error("StripeWebhookEvent activation evidence is not mode 0600");
  }
}

async function main() {
  try {
    const config = parseStripeWebhookEventActivationPostflightConfig(process.env);
    const evidence = await runStripeWebhookEventActivationPostflight(config);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.source.commit,
      postflightReadOnly: evidence.proof.postflightReadOnly,
      productionChangedByPostflight: evidence.productionChangedByPostflight,
    })}\n`);
  } catch (error) {
    process.stderr.write(
      `StripeWebhookEvent activation production postflight failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
