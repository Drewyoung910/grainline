#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  privateTablePreparationReleaseIds,
  verifyPrivateTablePreparationSource,
} from "./private-table-preparation-catalog.mjs";
import {
  assertVercelRuntimeDatabaseIsolation,
} from "./guard-runtime-db-env.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;
const RELEASE_SELECTION = "owner_social_verification_v1";

function sourceSha256(source) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export const PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS = Object.freeze(
  privateTablePreparationReleaseIds(RELEASE_SELECTION)
    .flatMap((releaseId) => {
      const verified = verifyPrivateTablePreparationSource(releaseId);
      return verified.release.functions.map((entry) => Object.freeze({
        identity: `${entry.name}(${entry.arguments})`,
        executeRole: entry.executeRole ?? "runtime",
        sourceSha256: sourceSha256(verified.functionSources.get(entry.name)),
      }));
    }),
);

const stopped = () => new Error(
  "private-table runtime readiness gate stopped; preparation is absent or authority drifted",
);

export function collectPrivateTableRuntimeReadinessIssues(
  rows,
  expectedFunctions,
  expectedRole,
) {
  const issues = [];
  const values = Array.isArray(rows) ? rows : [];
  const expectedByIdentity = new Map(
    expectedFunctions.map((entry) => [entry.identity, entry]),
  );
  if (values.length !== expectedFunctions.length) {
    issues.push("private-table function inventory is not exact");
  }
  for (const row of values) {
    const identity = String(row?.function_identity ?? "");
    const expected = expectedByIdentity.get(identity);
    if (!expected) {
      issues.push("unexpected private-table function identity");
      continue;
    }
    expectedByIdentity.delete(identity);
    if (
      row?.current_user_name !== expectedRole
      || row?.session_user_name !== expectedRole
      || row?.database_name !== "neondb"
      || row?.read_only !== true
    ) {
      issues.push(`${identity} database identity drifted`);
    }
    if (row?.function_exists !== true || row?.function_execute !== true) {
      issues.push(`${identity} is absent or not executable`);
    }
    if (
      typeof row?.source !== "string"
      || sourceSha256(row.source) !== expected.sourceSha256
    ) {
      issues.push(`${identity} body drifted`);
    }
  }
  for (const identity of expectedByIdentity.keys()) {
    issues.push(`missing required function ${identity}`);
  }
  return [...new Set(issues)];
}

async function inspectRole({
  ClientImpl,
  connectionString,
  expectedFunctions,
  expectedRole,
  applicationName,
}) {
  if (expectedFunctions.length === 0) return;
  const client = new ClientImpl({
    connectionString,
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    application_name: applicationName,
  });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await client.query(`
      WITH expected(function_identity) AS (
        SELECT pg_catalog.unnest($1::text[])
      )
      SELECT expected.function_identity,
             current_user::text AS current_user_name,
             session_user::text AS session_user_name,
             current_database()::text AS database_name,
             pg_catalog.current_setting('transaction_read_only') = 'on' AS read_only,
             procedure.oid IS NOT NULL AS function_exists,
             COALESCE(pg_catalog.has_function_privilege(
               current_user,
               procedure.oid,
               'EXECUTE'
             ), false) AS function_execute,
             procedure.prosrc AS source
        FROM expected
        LEFT JOIN pg_catalog.pg_proc AS procedure
          ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
       ORDER BY expected.function_identity
    `, [expectedFunctions.map((entry) => entry.identity)]);
    if (
      collectPrivateTableRuntimeReadinessIssues(
        result.rows,
        expectedFunctions,
        expectedRole,
      ).length > 0
    ) {
      throw stopped();
    }
    await client.query("COMMIT");
  } catch {
    try { await client.query("ROLLBACK"); } catch { /* preserve bounded failure */ }
    throw stopped();
  } finally {
    try { await client.end(); } catch { /* connection is already unusable */ }
  }
}

export async function verifyPrivateTableRuntimeReadiness({
  env = process.env,
  ClientImpl = Client,
} = {}) {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production") {
    return Object.freeze({ enforced: false, environment: env.VERCEL_ENV ?? null });
  }
  assertVercelRuntimeDatabaseIsolation(env, {
    requireOrderStaffReadDatabase: true,
  });
  const runtimeFunctions = PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS.filter(
    (entry) => entry.executeRole === "runtime",
  );
  const staffFunctions = PRIVATE_TABLE_RUNTIME_READINESS_FUNCTIONS.filter(
    (entry) => entry.executeRole === "staff",
  );
  await inspectRole({
    ClientImpl,
    connectionString: env.DATABASE_URL,
    expectedFunctions: runtimeFunctions,
    expectedRole: "grainline_app_runtime",
    applicationName: "grainline-private-table-runtime-readiness",
  });
  await inspectRole({
    ClientImpl,
    connectionString: env.ORDER_STAFF_READ_DATABASE_URL,
    expectedFunctions: staffFunctions,
    expectedRole: "grainline_staff_read_runtime",
    applicationName: "grainline-private-table-staff-readiness",
  });
  return Object.freeze({
    enforced: true,
    environment: "production",
    releaseSelection: RELEASE_SELECTION,
    runtimeFunctionCount: runtimeFunctions.length,
    staffFunctionCount: staffFunctions.length,
    readOnly: true,
  });
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(
      await verifyPrivateTableRuntimeReadiness(),
    )}\n`);
  } catch {
    process.stderr.write(`${stopped().message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
