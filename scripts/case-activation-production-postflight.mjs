#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  CASE_COMPATIBLE_PRIVATE_FUNCTIONS,
  CASE_COMPATIBLE_RUNTIME_FUNCTIONS,
  assertCaseCompatibleDatabaseGitState,
  proveRuntimeBoundary,
  readCaseCompatibleDatabaseGitState,
  verifyFunctionCatalog,
  verifyReadOnlyTransaction,
  verifyRuntimeIdentity,
  verifyTriggerCatalog,
} from "./case-compatible-database-production-postflight.mjs";
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

export const CASE_ACTIVATION_POSTFLIGHT_CONFIRMATION =
  "verify-production-case-policyless-activation-read-only";
export const CASE_ACTIVATION_MIGRATION =
  "20260804160000_enable_case_rls";
export const CASE_FORCE_POSTFLIGHT_CONFIRMATION =
  "verify-production-case-policyless-force-read-only";
export const CASE_FORCE_MIGRATION =
  "20260804191000_force_case_rls";
export const CASE_ACTIVATION_RUNTIME_FUNCTION =
  "grainline_direct_upload_case_attachment_read";
export const CASE_ACTIVATION_RUNTIME_FUNCTION_ARGUMENTS =
  "text, text, text";

const REVIEWED_MIGRATION_ROLE = "neondb_owner";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/;
const POST_FORCE_FLAG = "--post-force";
const CASE_DATA_TABLES = Object.freeze([
  "Case",
  "CaseMessage",
  "CaseMessageAttachment",
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function parseSafePositiveInteger(env, key) {
  const raw = required(env, key);
  if (!SAFE_POSITIVE_INTEGER.test(raw)) {
    throw new Error(`${key} is not a safe positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${key} is not a safe positive integer`);
  }
  return value;
}

function parseCasePostflightConfig(env, forceExpected) {
  const environmentPrefix = forceExpected
    ? "CASE_FORCE_POSTFLIGHT"
    : "CASE_ACTIVATION_POSTFLIGHT";
  const confirmation = forceExpected
    ? CASE_FORCE_POSTFLIGHT_CONFIRMATION
    : CASE_ACTIVATION_POSTFLIGHT_CONFIRMATION;
  const evidencePrefix = forceExpected
    ? "case-force-production-postflight-"
    : "case-activation-production-postflight-";
  const migration = forceExpected
    ? CASE_FORCE_MIGRATION
    : CASE_ACTIVATION_MIGRATION;
  const label = forceExpected
    ? "Case FORCE production postflight"
    : "Case activation production postflight";
  assertDeterministicPostgresEnvironment(
    env,
    label,
  );
  if (env[`${environmentPrefix}_CONFIRM`] !== confirmation) {
    throw new Error(`${label} confirmation is invalid`);
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `Case activation postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `Case activation postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    `${environmentPrefix}_RELEASE_COMMIT`,
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error(`${label} release commit is invalid`);
  }
  const mainCiRunId = parseSafePositiveInteger(
    env,
    `${environmentPrefix}_MAIN_CI_RUN_ID`,
  );
  const migrationRunId = parseSafePositiveInteger(
    env,
    `${environmentPrefix}_MIGRATION_RUN_ID`,
  );
  const databaseUrl = required(env, "DATABASE_URL");
  const runtimeGuard = assertVercelRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: databaseUrl,
    RUNTIME_DB_ROLE: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
    PGOPTIONS: env.PGOPTIONS,
  });
  const evidencePath = path.resolve(
    required(env, `${environmentPrefix}_EVIDENCE_PATH`),
  );
  if (
    path.basename(evidencePath) !== `${evidencePrefix}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error(`${label} evidence path is not fresh and exact`);
  }

  return Object.freeze({
    applicationName: forceExpected
      ? "grainline-case-force-production-postflight"
      : "grainline-case-activation-production-postflight",
    databaseUrl,
    evidencePath,
    forceExpected,
    mainCiRunId,
    migration,
    migrationRole: REVIEWED_MIGRATION_ROLE,
    migrationRunId,
    releaseCommit,
    runtimeGuard,
  });
}

export function parseCaseActivationPostflightConfig(env = process.env) {
  return parseCasePostflightConfig(env, false);
}

export function parseCaseForcePostflightConfig(env = process.env) {
  return parseCasePostflightConfig(env, true);
}

export function parseCasePostflightMode(argv = process.argv.slice(2)) {
  if (
    argv.length > 1
    || (argv.length === 1 && argv[0] !== POST_FORCE_FLAG)
  ) {
    throw new Error(
      `usage: case-activation-production-postflight.mjs [${POST_FORCE_FLAG}]`,
    );
  }
  return argv[0] === POST_FORCE_FLAG;
}

async function verifyActivatedTablePosture(
  client,
  migrationRole,
  forceExpected,
) {
  const result = await client.query(
    `
      SELECT
        relation.relname AS table_name,
        relation.relrowsecurity AS rls_enabled,
        relation.relforcerowsecurity AS rls_forced,
        pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
        (
          SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation.oid
        ) AS policy_count,
        pg_catalog.has_table_privilege(
          CURRENT_USER,
          relation.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        ) AS has_table_access,
        pg_catalog.has_any_column_privilege(
          CURRENT_USER,
          relation.oid,
          'SELECT,INSERT,UPDATE,REFERENCES'
        ) AS has_column_access
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind = 'r'
        AND relation.relname = ANY($1::text[])
      ORDER BY relation.relname
    `,
    [[...CASE_DATA_TABLES].sort()],
  );
  assert.equal(result.rows.length, CASE_DATA_TABLES.length);
  for (const row of result.rows) {
    assert.equal(row.owner_name, migrationRole, row.table_name);
    assert.equal(row.rls_enabled, true, row.table_name);
    assert.equal(row.rls_forced, forceExpected, row.table_name);
    assert.equal(row.policy_count, 0, row.table_name);
    assert.equal(row.has_table_access, false, row.table_name);
    assert.equal(row.has_column_access, false, row.table_name);
  }
}

async function verifyAttachmentFunction(client, migrationRole) {
  const result = await client.query(
    `
      SELECT
        pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
        procedure.prosecdef AS security_definer,
        procedure.proconfig AS function_config,
        pg_catalog.has_function_privilege(
          CURRENT_USER,
          procedure.oid,
          'EXECUTE'
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
        ) AS public_execute
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = $1
        AND pg_catalog.oidvectortypes(procedure.proargtypes) = $2
    `,
    [
      CASE_ACTIVATION_RUNTIME_FUNCTION,
      CASE_ACTIVATION_RUNTIME_FUNCTION_ARGUMENTS,
    ],
  );
  assert.deepEqual(result.rows, [{
    owner_name: migrationRole,
    security_definer: true,
    function_config: ["search_path=pg_catalog"],
    runtime_execute: true,
    public_execute: false,
  }]);
}

async function expectDirectReadDenied(client, tableName) {
  await client.query("SAVEPOINT case_activation_expected_denial");
  let caught;
  try {
    await client.query(`SELECT * FROM public."${tableName}" LIMIT 1`);
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT case_activation_expected_denial");
  await client.query("RELEASE SAVEPOINT case_activation_expected_denial");
  assert.equal(
    caught?.code,
    "42501",
    `${tableName} direct read did not fail with 42501`,
  );
}

export async function runCaseActivationPostflight(config) {
  const parsed = new URL(config.databaseUrl);
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: config.applicationName,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    ...postgresChannelBindingClientOptions(parsed),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '20s'");
    await verifyReadOnlyTransaction(client);
    await verifyRuntimeIdentity(
      client,
      config.runtimeGuard,
      config.migrationRole,
    );
    await verifyActivatedTablePosture(
      client,
      config.migrationRole,
      config.forceExpected,
    );
    await verifyTriggerCatalog(client);
    await verifyFunctionCatalog(client, config.migrationRole);
    await verifyAttachmentFunction(client, config.migrationRole);
    await proveRuntimeBoundary(client);
    for (const tableName of CASE_DATA_TABLES) {
      await expectDirectReadDenied(client, tableName);
    }
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      status: "passed",
      releaseCommit: config.releaseCommit,
      mainCiRunId: config.mainCiRunId,
      migrationRunId: config.migrationRunId,
      migration: config.migration,
      database: config.runtimeGuard.databaseName,
      endpointId: config.runtimeGuard.endpointId,
      region: config.runtimeGuard.region,
      runtimeRole: config.runtimeGuard.runtimeRole,
      caseFamilyRlsEnabled: true,
      caseFamilyRlsForced: config.forceExpected,
      caseFamilyPolicyCount: 0,
      caseFamilyRuntimeTableAccess: false,
      runtimeFunctionCount:
        CASE_COMPATIBLE_RUNTIME_FUNCTIONS.length + 1,
      privateFunctionCount: CASE_COMPATIBLE_PRIVATE_FUNCTIONS.length,
      postflightReadOnly: true,
      productionChangedByPostflight: false,
      completedChecks: [
        "engine_attested_repeatable_read_read_only_transaction",
        "actual_pooled_runtime_role_identity",
        config.forceExpected
          ? "case_family_policyless_enable_with_force"
          : "case_family_policyless_enable_without_force",
        "zero_case_family_table_or_column_authority",
        "exact_case_runtime_function_partition",
        "private_ledger_and_helper_direct_denial",
        "case_family_direct_select_denial",
        "fixed_recipient_reads_fail_closed_for_invalid_actor",
      ],
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export function writeCaseActivationPostflightEvidence(evidencePath, evidence) {
  const handle = openSync(evidencePath, "wx", 0o600);
  try {
    writeFileSync(handle, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  chmodSync(evidencePath, 0o600);
}

async function main() {
  let label = "Case activation production postflight";
  try {
    const forceExpected = parseCasePostflightMode();
    label = forceExpected
      ? "Case FORCE production postflight"
      : label;
    const config = forceExpected
      ? parseCaseForcePostflightConfig(process.env)
      : parseCaseActivationPostflightConfig(process.env);
    assertCaseCompatibleDatabaseGitState(
      readCaseCompatibleDatabaseGitState(),
      config.releaseCommit,
    );
    const evidence = await runCaseActivationPostflight(config);
    writeCaseActivationPostflightEvidence(config.evidencePath, evidence);
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch (error) {
    process.stderr.write(
      `${label} failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
