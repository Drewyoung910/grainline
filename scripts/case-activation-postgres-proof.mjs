#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_ACTIVATION_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const TABLES = Object.freeze([
  "Case",
  "CaseMessage",
  "CaseMessageAttachment",
]);

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseActivationProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case activation proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case activation proof requires ${DATABASE_NAME}`,
  );
  return Object.freeze({ databaseUrl });
}

async function expectDenied(client, label, query) {
  await client.query(`SAVEPOINT ${label}`);
  let caught;
  try {
    await client.query(query);
  } catch (error) {
    caught = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
  await client.query(`RELEASE SAVEPOINT ${label}`);
  assert.ok(caught, `${label} unexpectedly succeeded`);
  assert.equal(caught.code, "42501", `${label} returned the wrong SQLSTATE`);
}

async function proveCatalog(client, forceExpected) {
  const result = await client.query(`
    SELECT
      class.relname,
      class.relrowsecurity,
      class.relforcerowsecurity,
      (
        SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.pg_policy AS policy
         WHERE policy.polrelid = class.oid
      ) AS policy_count,
      (
        pg_catalog.has_table_privilege($1, class.oid, 'SELECT')
        OR pg_catalog.has_table_privilege($1, class.oid, 'INSERT')
        OR pg_catalog.has_table_privilege($1, class.oid, 'UPDATE')
        OR pg_catalog.has_table_privilege($1, class.oid, 'DELETE')
        OR pg_catalog.has_table_privilege($1, class.oid, 'TRUNCATE')
        OR pg_catalog.has_table_privilege($1, class.oid, 'REFERENCES')
        OR pg_catalog.has_table_privilege($1, class.oid, 'TRIGGER')
      ) AS runtime_table_authority,
      pg_catalog.has_any_column_privilege(
        $1,
        class.oid,
        'SELECT,INSERT,UPDATE,REFERENCES'
      ) AS runtime_column_authority
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relkind = 'r'
       AND class.relname = ANY($2::text[])
     ORDER BY class.relname
  `, [RUNTIME_ROLE, TABLES]);
  assert.deepEqual(result.rows, [
    {
      relname: "Case",
      relrowsecurity: true,
      relforcerowsecurity: forceExpected,
      policy_count: 0,
      runtime_table_authority: false,
      runtime_column_authority: false,
    },
    {
      relname: "CaseMessage",
      relrowsecurity: true,
      relforcerowsecurity: forceExpected,
      policy_count: 0,
      runtime_table_authority: false,
      runtime_column_authority: false,
    },
    {
      relname: "CaseMessageAttachment",
      relrowsecurity: true,
      relforcerowsecurity: forceExpected,
      policy_count: 0,
      runtime_table_authority: false,
      runtime_column_authority: false,
    },
  ]);
}

async function proveRuntimeDenial(client) {
  await client.query("SET LOCAL ROLE grainline_app_runtime");
  const identity = await client.query(`
    SELECT current_user AS current_user, session_user AS session_user
  `);
  assert.deepEqual(identity.rows[0], {
    current_user: RUNTIME_ROLE,
    session_user: "ci",
  });

  for (const [index, table] of TABLES.entries()) {
    await expectDenied(
      client,
      `case_activation_select_${index}`,
      `SELECT 1 FROM public."${table}" LIMIT 1`,
    );
    await expectDenied(
      client,
      `case_activation_insert_${index}`,
      `INSERT INTO public."${table}" DEFAULT VALUES`,
    );
    await expectDenied(
      client,
      `case_activation_update_${index}`,
      `UPDATE public."${table}" SET id = id WHERE false`,
    );
    await expectDenied(
      client,
      `case_activation_delete_${index}`,
      `DELETE FROM public."${table}" WHERE false`,
    );
  }
}

export async function runCaseActivationProof(
  env = process.env,
  {
    applicationName = "grainline-case-activation-proof",
    forceExpected = false,
  } = {},
) {
  assert.equal(typeof forceExpected, "boolean");
  const { databaseUrl } = parseCaseActivationProofConfig(env);
  const client = new Client({
    application_name: applicationName,
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
  await client.connect();
  let began = false;
  try {
    const target = await client.query(`
      SELECT current_database() AS database_name, current_user AS current_user
    `);
    assert.deepEqual(target.rows[0], {
      database_name: DATABASE_NAME,
      current_user: "ci",
    });
    await client.query("BEGIN");
    began = true;
    await proveCatalog(client, forceExpected);
    await proveRuntimeDenial(client);
    await client.query("ROLLBACK");
    began = false;
    return Object.freeze({
      database: DATABASE_NAME,
      tables: TABLES.length,
      policyCount: 0,
      forceEnabled: forceExpected,
      directOperationsDenied: TABLES.length * 4,
      sqlState: "42501",
      persistentDatabaseChanged: false,
      productionChanged: false,
    });
  } finally {
    if (began) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function main() {
  const result = await runCaseActivationProof();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `Case activation PostgreSQL proof failed closed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  });
}
