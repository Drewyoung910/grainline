#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

export const CASE_COMPATIBLE_DATABASE_POSTFLIGHT_CONFIRMATION =
  "verify-production-case-compatible-database-read-only";
export const CASE_COMPATIBLE_RUNTIME_FUNCTIONS = Object.freeze([
  "grainline_case_account_deletion_blockers",
  "grainline_case_account_deletion_redact",
  "grainline_case_cron_transition_batch",
  "grainline_case_escalate",
  "grainline_case_export_page",
  "grainline_case_get",
  "grainline_case_get_by_order",
  "grainline_case_guild_unresolved_guard",
  "grainline_case_mark_resolved",
  "grainline_case_message_page",
  "grainline_case_message_preflight",
  "grainline_case_open",
  "grainline_case_order_active_for_buyer",
  "grainline_case_order_active_for_seller",
  "grainline_case_reply",
  "grainline_case_seller_active_count",
  "grainline_case_seller_refund_apply",
  "grainline_case_seller_verification_eligibility",
  "grainline_case_staff_active_count",
  "grainline_case_staff_queue",
  "grainline_case_staff_resolution_finalize",
  "grainline_case_staff_resolution_prepare",
  "grainline_case_staff_resolution_provider_record",
  "grainline_case_staff_resolution_reconcile",
  "grainline_case_stripe_dispute_apply",
  "grainline_order_buyer_pii_prune_batch",
]);
export const CASE_COMPATIBLE_PRIVATE_FUNCTIONS = Object.freeze([
  "grainline_account_deletion_redact_text_core",
  "grainline_case_resolution_claim_immutable",
  "grainline_case_resolution_claim_lease_valid",
]);

const REVIEWED_MIGRATION_ROLE = "neondb_owner";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,15}$/;
const EVIDENCE_PREFIX = "case-compatible-database-production-postflight-";
const CASE_DATA_TABLES = Object.freeze([
  "Case",
  "CaseMessage",
  "CaseMessageAttachment",
]);
const CASE_PRIVATE_TABLES = Object.freeze([
  "CaseOpenApplication",
  "CaseResolutionClaim",
  "CaseSellerRefundApplication",
  "CaseStripeDisputeApplication",
]);
const SECURITY_INVOKER_FUNCTIONS = new Set([
  "grainline_case_resolution_claim_immutable",
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

export function parseCaseCompatibleDatabasePostflightConfig(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "Case compatible database production postflight",
  );
  if (
    env.CASE_COMPATIBLE_DB_POSTFLIGHT_CONFIRM
      !== CASE_COMPATIBLE_DATABASE_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error("Case compatible database postflight confirmation is invalid");
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `Case compatible database postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `Case compatible database postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(env, "CASE_COMPATIBLE_DB_RELEASE_COMMIT");
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("Case compatible database release commit is invalid");
  }
  const mainCiRunId = parseSafePositiveInteger(
    env,
    "CASE_COMPATIBLE_DB_MAIN_CI_RUN_ID",
  );
  const migrationRunId = parseSafePositiveInteger(
    env,
    "CASE_COMPATIBLE_DB_MIGRATION_RUN_ID",
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
    required(env, "CASE_COMPATIBLE_DB_POSTFLIGHT_EVIDENCE_PATH"),
  );
  if (
    path.basename(evidencePath)
      !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error("Case compatible database evidence path is not the fresh reviewed path");
  }

  return Object.freeze({
    databaseUrl,
    evidencePath,
    mainCiRunId,
    migrationRole: REVIEWED_MIGRATION_ROLE,
    migrationRunId,
    releaseCommit,
    runtimeGuard,
  });
}

export function readCaseCompatibleDatabaseGitState(cwd = process.cwd()) {
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

export function assertCaseCompatibleDatabaseGitState(state, releaseCommit) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "Case compatible database postflight requires the exact clean release commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

async function verifyRuntimeIdentity(
  client,
  expectedIdentity,
  migrationRole,
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
      pg_catalog.pg_has_role(
        CURRENT_USER,
        $1,
        'MEMBER'
      ) AS member_of_owner
    FROM pg_catalog.pg_roles AS role
    WHERE role.rolname = CURRENT_USER
  `, [migrationRole]);
  assert.deepEqual(result.rows, [{
    database_name: expectedIdentity.databaseName,
    current_user_name: expectedIdentity.runtimeRole,
    session_user_name: expectedIdentity.runtimeRole,
    rolsuper: false,
    rolbypassrls: false,
    rolinherit: false,
    rolcanlogin: true,
    member_of_owner: false,
  }]);
}

async function verifyReadOnlyTransaction(client) {
  const result = await client.query(`
    SELECT pg_catalog.current_setting('transaction_read_only') AS read_only
  `);
  assert.deepEqual(result.rows, [{ read_only: "on" }]);
}

async function verifyTablePosture(client, migrationRole) {
  const expectedNames = [...CASE_DATA_TABLES, ...CASE_PRIVATE_TABLES].sort();
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
          CURRENT_USER, relation.oid, 'SELECT'
        ) AS can_select,
        pg_catalog.has_table_privilege(
          CURRENT_USER, relation.oid, 'INSERT'
        ) AS can_insert,
        pg_catalog.has_table_privilege(
          CURRENT_USER, relation.oid, 'UPDATE'
        ) AS can_update,
        pg_catalog.has_table_privilege(
          CURRENT_USER, relation.oid, 'DELETE'
        ) AS can_delete
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind = 'r'
        AND relation.relname = ANY($1::text[])
      ORDER BY relation.relname
    `,
    [expectedNames],
  );
  assert.equal(result.rows.length, expectedNames.length);
  for (const row of result.rows) {
    assert.equal(row.owner_name, migrationRole, row.table_name);
    assert.equal(row.policy_count, 0, row.table_name);
    if (CASE_DATA_TABLES.includes(row.table_name)) {
      assert.equal(row.rls_enabled, false, row.table_name);
      assert.equal(row.rls_forced, false, row.table_name);
      assert.equal(row.can_select, true, row.table_name);
      assert.equal(row.can_insert, true, row.table_name);
      assert.equal(row.can_update, true, row.table_name);
      assert.equal(row.can_delete, true, row.table_name);
    } else {
      assert.equal(row.rls_enabled, true, row.table_name);
      assert.equal(row.rls_forced, true, row.table_name);
      assert.equal(row.can_select, false, row.table_name);
      assert.equal(row.can_insert, false, row.table_name);
      assert.equal(row.can_update, false, row.table_name);
      assert.equal(row.can_delete, false, row.table_name);
    }
  }
}

async function verifyTriggerCatalog(client) {
  const result = await client.query(`
    SELECT
      trigger.tgname AS trigger_name,
      relation.relname AS table_name,
      trigger.tgenabled AS enabled,
      trigger.tgdeferrable AS deferrable,
      trigger.tginitdeferred AS initially_deferred
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND NOT trigger.tgisinternal
      AND trigger.tgname IN (
        'grainline_case_resolution_claim_immutable',
        'grainline_case_resolution_claim_lease_valid',
        'grainline_order_case_resolution_claim_lease_valid'
      )
    ORDER BY trigger.tgname
  `);
  assert.deepEqual(result.rows, [
    {
      trigger_name: "grainline_case_resolution_claim_immutable",
      table_name: "CaseResolutionClaim",
      enabled: "O",
      deferrable: false,
      initially_deferred: false,
    },
    {
      trigger_name: "grainline_case_resolution_claim_lease_valid",
      table_name: "CaseResolutionClaim",
      enabled: "O",
      deferrable: true,
      initially_deferred: true,
    },
    {
      trigger_name: "grainline_order_case_resolution_claim_lease_valid",
      table_name: "Order",
      enabled: "O",
      deferrable: true,
      initially_deferred: true,
    },
  ]);
}

async function verifyFunctionCatalog(client, migrationRole) {
  const runtimeNames = new Set(CASE_COMPATIBLE_RUNTIME_FUNCTIONS);
  const expectedNames = [
    ...CASE_COMPATIBLE_RUNTIME_FUNCTIONS,
    ...CASE_COMPATIBLE_PRIVATE_FUNCTIONS,
  ].sort();
  const result = await client.query(
    `
      SELECT
        procedure.proname AS function_name,
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
        AND procedure.proname = ANY($1::text[])
      ORDER BY procedure.proname
    `,
    [expectedNames],
  );
  assert.equal(result.rows.length, expectedNames.length);
  for (const row of result.rows) {
    assert.equal(row.owner_name, migrationRole, row.function_name);
    assert.deepEqual(
      row.function_config,
      ["search_path=pg_catalog"],
      row.function_name,
    );
    assert.equal(
      row.security_definer,
      !SECURITY_INVOKER_FUNCTIONS.has(row.function_name),
      row.function_name,
    );
    assert.equal(
      row.runtime_execute,
      runtimeNames.has(row.function_name),
      row.function_name,
    );
    assert.equal(row.public_execute, false, row.function_name);
  }
}

async function expectInsufficientPrivilege(client, operation, label) {
  await client.query("SAVEPOINT case_compatible_expected_denial");
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT case_compatible_expected_denial");
  await client.query("RELEASE SAVEPOINT case_compatible_expected_denial");
  assert.equal(caught?.code, "42501", `${label} did not fail with 42501`);
}

async function proveRuntimeBoundary(client) {
  await expectInsufficientPrivilege(
    client,
    () => client.query(
      `SELECT * FROM public."CaseResolutionClaim" LIMIT 1`,
    ),
    "CaseResolutionClaim direct read",
  );
  await expectInsufficientPrivilege(
    client,
    () => client.query(`
      SELECT public.grainline_account_deletion_redact_text_core(
        'postflight',
        ARRAY['postflight']::text[]
      )
    `),
    "private account-deletion redaction core",
  );

  const caseRead = await client.query(`
    SELECT *
    FROM public.grainline_case_get(
      'case-compatible-postflight-invalid-actor',
      'case-compatible-postflight-invalid-case'
    )
  `);
  assert.equal(caseRead.rows.length, 0);
  const messageRead = await client.query(`
    SELECT *
    FROM public.grainline_case_message_page(
      'case-compatible-postflight-invalid-actor',
      'case-compatible-postflight-invalid-case',
      NULL::timestamp,
      NULL::text,
      1
    )
  `);
  assert.equal(messageRead.rows.length, 0);
}

export async function runCaseCompatibleDatabasePostflight(config) {
  const parsed = new URL(config.databaseUrl);
  const client = new Client({
    connectionString: config.databaseUrl,
    application_name: "grainline-case-compatible-database-postflight",
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
    await verifyTablePosture(client, config.migrationRole);
    await verifyTriggerCatalog(client);
    await verifyFunctionCatalog(client, config.migrationRole);
    await proveRuntimeBoundary(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      status: "passed",
      releaseCommit: config.releaseCommit,
      mainCiRunId: config.mainCiRunId,
      migrationRunId: config.migrationRunId,
      database: config.runtimeGuard.databaseName,
      endpointId: config.runtimeGuard.endpointId,
      region: config.runtimeGuard.region,
      runtimeRole: config.runtimeGuard.runtimeRole,
      caseFamilyRlsEnabled: false,
      caseFamilyRlsForced: false,
      legacyCaseCrudRetained: true,
      privateLedgerCount: CASE_PRIVATE_TABLES.length,
      privateLedgersRlsEnabled: true,
      privateLedgersRlsForced: true,
      privateLedgerPolicyCount: 0,
      privateLedgerRuntimeTableAccess: false,
      runtimeFunctionCount: CASE_COMPATIBLE_RUNTIME_FUNCTIONS.length,
      privateFunctionCount: CASE_COMPATIBLE_PRIVATE_FUNCTIONS.length,
      postflightReadOnly: true,
      productionChangedByPostflight: false,
      completedChecks: [
        "engine_attested_repeatable_read_read_only_transaction",
        "actual_pooled_runtime_role_identity",
        "case_family_compatible_predecessor_table_posture",
        "four_service_only_private_ledger_postures",
        "resolution_claim_trigger_catalog",
        "exact_case_compatible_function_acl_and_search_path_catalog",
        "private_ledger_and_helper_direct_denial",
        "fixed_recipient_reads_fail_closed_for_invalid_actor",
      ],
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

export function writeCaseCompatibleDatabasePostflightEvidence(
  evidencePath,
  evidence,
) {
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
  try {
    const config = parseCaseCompatibleDatabasePostflightConfig(process.env);
    assertCaseCompatibleDatabaseGitState(
      readCaseCompatibleDatabaseGitState(),
      config.releaseCommit,
    );
    const evidence = await runCaseCompatibleDatabasePostflight(config);
    writeCaseCompatibleDatabasePostflightEvidence(
      config.evidencePath,
      evidence,
    );
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } catch (error) {
    process.stderr.write(
      `Case compatible database production postflight failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
