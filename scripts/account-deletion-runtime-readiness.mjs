#!/usr/bin/env node
import pg from "pg";
import { pathToFileURL } from "node:url";
import {
  ACCOUNT_DELETION_DATABASE_ENV,
  assertVercelRuntimeDatabaseIsolation,
} from "./guard-runtime-db-env.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;

export const ACCOUNT_DELETION_RUNTIME_FUNCTIONS = Object.freeze([
  "grainline_account_deletion_side_effect_claim(text)",
  "grainline_account_deletion_side_effect_complete(text,bigint,uuid)",
  "grainline_account_deletion_side_effect_fail(text,bigint,uuid,text)",
]);
export const ACCOUNT_DELETION_APPLICATION_FUNCTIONS = Object.freeze([
  "grainline_account_deletion_media_key_enqueue_claimed(text,bigint,uuid,text[])",
]);

const stopped = () => new Error(
  "account-deletion runtime readiness gate stopped; preparation is absent or authority drifted",
);

export function collectAccountDeletionRuntimeReadinessIssues(rows) {
  const issues = [];
  const values = Array.isArray(rows) ? rows : [];
  const identities = new Set(values.map((row) => String(row?.function_identity ?? "")));
  for (const identity of ACCOUNT_DELETION_RUNTIME_FUNCTIONS) {
    if (!identities.has(identity)) issues.push(`missing required function ${identity}`);
  }
  if (values.length !== ACCOUNT_DELETION_RUNTIME_FUNCTIONS.length) {
    issues.push("account-deletion function inventory is not exact");
  }
  for (const row of values) {
    const prefix = String(row?.function_identity ?? "unknown");
    if (row?.current_user_name !== "grainline_account_deletion_runtime"
      || row?.session_user_name !== "grainline_account_deletion_runtime"
      || row?.database_name !== "neondb") {
      issues.push("account-deletion database identity drifted");
    }
    if (row?.read_only !== true) issues.push("readiness transaction is not read-only");
    if (row?.role_restricted !== true) issues.push("account-deletion role attributes drifted");
    if (row?.schema_usage !== true || row?.schema_create === true) {
      issues.push("account-deletion schema authority drifted");
    }
    if (row?.table_crud !== true) issues.push("account-deletion table authority is not prepared");
    if (row?.function_exists !== true) issues.push(`${prefix} is not installed`);
    if (row?.function_execute !== true) issues.push(`${prefix} lacks effective EXECUTE`);
  }
  return [...new Set(issues)];
}

export function collectAccountDeletionApplicationReadinessIssues(rows) {
  const issues = [];
  const values = Array.isArray(rows) ? rows : [];
  const identities = new Set(values.map((row) => String(row?.function_identity ?? "")));
  for (const identity of ACCOUNT_DELETION_APPLICATION_FUNCTIONS) {
    if (!identities.has(identity)) issues.push(`missing required application function ${identity}`);
  }
  if (values.length !== ACCOUNT_DELETION_APPLICATION_FUNCTIONS.length) {
    issues.push("account-deletion application function inventory is not exact");
  }
  for (const row of values) {
    const prefix = String(row?.function_identity ?? "unknown");
    if (row?.current_user_name !== "grainline_app_runtime"
      || row?.session_user_name !== "grainline_app_runtime"
      || row?.database_name !== "neondb") {
      issues.push("application database identity drifted");
    }
    if (row?.read_only !== true) issues.push("application readiness transaction is not read-only");
    if (row?.function_exists !== true) issues.push(`${prefix} is not installed`);
    if (row?.function_execute !== true) issues.push(`${prefix} lacks effective EXECUTE`);
  }
  return [...new Set(issues)];
}

export function collectAccountDeletionActivationReadinessIssues(row) {
  const issues = [];
  if (row?.rls_enabled !== true) {
    issues.push("AccountDeletionSideEffect RLS is not enabled");
  }
  if (row?.worker_policy_exact !== true) {
    issues.push("AccountDeletionSideEffect worker policy drifted");
  }
  return issues;
}

export async function verifyAccountDeletionRuntimeReadiness({
  env = process.env,
  ClientImpl = Client,
} = {}) {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production") {
    return Object.freeze({ enforced: false, environment: env.VERCEL_ENV ?? null });
  }
  assertVercelRuntimeDatabaseIsolation(env, {
    requireOrderStaffReadDatabase: true,
    requireAccountDeletionDatabase: true,
  });
  const workerConnectionString = env[ACCOUNT_DELETION_DATABASE_ENV];
  const applicationConnectionString = env.DATABASE_URL;
  const clientOptions = (connectionString, application_name) => ({
    connectionString,
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    application_name,
  });
  const workerClient = new ClientImpl(clientOptions(
    workerConnectionString,
    "grainline-account-deletion-worker-readiness",
  ));
  const applicationClient = new ClientImpl(clientOptions(
    applicationConnectionString,
    "grainline-account-deletion-application-readiness",
  ));
  try {
    await workerClient.connect();
    await workerClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const workerResult = await workerClient.query(`
      WITH expected(function_identity) AS (
        SELECT pg_catalog.unnest($1::text[])
      ), candidate AS (
        SELECT * FROM pg_catalog.pg_roles
         WHERE rolname = 'grainline_account_deletion_runtime'
      )
      SELECT
        expected.function_identity,
        current_user::text AS current_user_name,
        session_user::text AS session_user_name,
        current_database()::text AS database_name,
        pg_catalog.current_setting('transaction_read_only') = 'on' AS read_only,
        NOT (candidate.rolsuper OR candidate.rolcreatedb OR candidate.rolcreaterole
          OR candidate.rolinherit OR NOT candidate.rolcanlogin
          OR candidate.rolreplication OR candidate.rolbypassrls) AS role_restricted,
        pg_catalog.has_schema_privilege(candidate.oid, 'public', 'USAGE') AS schema_usage,
        pg_catalog.has_schema_privilege(candidate.oid, 'public', 'CREATE') AS schema_create,
        (pg_catalog.has_table_privilege(candidate.oid, 'public."AccountDeletionSideEffect"', 'SELECT')
          AND pg_catalog.has_table_privilege(candidate.oid, 'public."AccountDeletionSideEffect"', 'INSERT')
          AND pg_catalog.has_table_privilege(candidate.oid, 'public."AccountDeletionSideEffect"', 'UPDATE')
          AND pg_catalog.has_table_privilege(candidate.oid, 'public."AccountDeletionSideEffect"', 'DELETE'))
          AS table_crud,
        pg_catalog.to_regprocedure(expected.function_identity) IS NOT NULL AS function_exists,
        COALESCE(pg_catalog.has_function_privilege(candidate.oid,
          pg_catalog.to_regprocedure(expected.function_identity), 'EXECUTE'), false)
          AS function_execute
      FROM expected
      CROSS JOIN candidate
      ORDER BY expected.function_identity
    `, [ACCOUNT_DELETION_RUNTIME_FUNCTIONS]);
    if (collectAccountDeletionRuntimeReadinessIssues(workerResult.rows).length > 0) {
      throw stopped();
    }
    const activationResult = await workerClient.query(`
      SELECT
        class.relrowsecurity AS rls_enabled,
        class.relforcerowsecurity AS rls_forced,
        (
          SELECT pg_catalog.count(*) = 1
             AND pg_catalog.bool_and(policy.polpermissive)
             AND pg_catalog.bool_and(policy.polcmd = '*')
             AND pg_catalog.bool_and(policy.polroles = ARRAY[candidate.oid]::oid[])
             AND pg_catalog.bool_and(
               pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
             )
             AND pg_catalog.bool_and(
               pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) = 'true'
             )
            FROM pg_catalog.pg_policy AS policy
           WHERE policy.polrelid = class.oid
        ) AS worker_policy_exact
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
      CROSS JOIN pg_catalog.pg_roles AS candidate
      WHERE namespace.nspname = 'public'
        AND class.relname = 'AccountDeletionSideEffect'
        AND class.relkind = 'r'
        AND candidate.rolname = 'grainline_account_deletion_runtime'
    `);
    if (activationResult.rows.length !== 1
      || collectAccountDeletionActivationReadinessIssues(
        activationResult.rows[0],
      ).length > 0) {
      throw stopped();
    }
    // Exercise the real worker policy without retaining row data or counts.
    await workerClient.query(
      'SELECT 1 FROM public."AccountDeletionSideEffect" LIMIT 1',
    );
    await applicationClient.connect();
    await applicationClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const applicationResult = await applicationClient.query(`
      WITH expected(function_identity) AS (
        SELECT pg_catalog.unnest($1::text[])
      )
      SELECT
        expected.function_identity,
        current_user::text AS current_user_name,
        session_user::text AS session_user_name,
        current_database()::text AS database_name,
        pg_catalog.current_setting('transaction_read_only') = 'on' AS read_only,
        pg_catalog.to_regprocedure(expected.function_identity) IS NOT NULL AS function_exists,
        COALESCE(pg_catalog.has_function_privilege(
          current_user,
          pg_catalog.to_regprocedure(expected.function_identity),
          'EXECUTE'
        ), false) AS function_execute
      FROM expected
      ORDER BY expected.function_identity
    `, [ACCOUNT_DELETION_APPLICATION_FUNCTIONS]);
    if (collectAccountDeletionApplicationReadinessIssues(applicationResult.rows).length > 0) {
      throw stopped();
    }
    await applicationClient.query("SAVEPOINT account_deletion_direct_denial");
    try {
      await applicationClient.query(
        'SELECT 1 FROM public."AccountDeletionSideEffect" LIMIT 1',
      );
      throw stopped();
    } catch (error) {
      if (error?.code !== "42501") throw error;
      await applicationClient.query(
        "ROLLBACK TO SAVEPOINT account_deletion_direct_denial",
      );
      await applicationClient.query(
        "RELEASE SAVEPOINT account_deletion_direct_denial",
      );
    }
    await applicationClient.query("COMMIT");
    await workerClient.query("COMMIT");
    return Object.freeze({
      enforced: true,
      environment: "production",
      role: "grainline_account_deletion_runtime",
      preparedFunctionCount: ACCOUNT_DELETION_RUNTIME_FUNCTIONS.length,
      applicationFunctionCount: ACCOUNT_DELETION_APPLICATION_FUNCTIONS.length,
      rlsEnabled: true,
      rlsForced: activationResult.rows[0].rls_forced === true,
      workerPolicyExercised: true,
      applicationDirectReadDenied: true,
      readOnly: true,
    });
  } catch {
    try { await applicationClient.query("ROLLBACK"); } catch { /* preserve bounded failure */ }
    try { await workerClient.query("ROLLBACK"); } catch { /* preserve bounded failure */ }
    throw stopped();
  } finally {
    try { await applicationClient.end(); } catch { /* connection is already unusable */ }
    try { await workerClient.end(); } catch { /* connection is already unusable */ }
  }
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(await verifyAccountDeletionRuntimeReadiness())}\n`);
  } catch {
    process.stderr.write(`${stopped().message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
