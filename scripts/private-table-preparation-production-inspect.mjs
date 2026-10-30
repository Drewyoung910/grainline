#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  privateTablePreparation,
  verifyPrivateTablePreparationSource,
} from "./private-table-preparation-catalog.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const PHASES = new Set(["preflight", "postflight"]);
const COMMIT = /^[0-9a-f]{40}$/u;

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function successfulMigration(rows, release) {
  const attempts = rows.filter((row) => row.migration_name === release.migration);
  for (const row of attempts) {
    assert.equal(row.checksum, release.migrationSha256, "migration checksum drifted");
  }
  const successes = attempts.filter((row) => (
    row.finished_at !== null
    && row.rolled_back_at === null
    && Number(row.applied_steps_count) === 1
  ));
  assert.ok(successes.length <= 1, "migration has duplicate successful rows");
  for (const row of attempts) {
    if (!successes.includes(row)) {
      assert.notEqual(row.rolled_back_at, null, "migration has an unresolved failed attempt");
    }
  }
  return successes.length === 1;
}

function evidencePosture(row) {
  return Object.freeze({
    rlsEnabled: row.rls_enabled,
    rlsForced: row.rls_forced,
    policyCount: row.policy_count,
    runtimeSelect: row.runtime_select,
    runtimeInsert: row.runtime_insert,
    runtimeUpdate: row.runtime_update,
    runtimeDelete: row.runtime_delete,
    staffSelect: row.staff_select,
    publicSelect: row.public_select,
    tableAcl: row.table_acl,
  });
}

function assertExpectedPosture(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value, `${key} drifted`);
  }
}

function functionEvidence(row) {
  return Object.freeze({
    name: row.function_name,
    arguments: row.identity_arguments,
    owner: row.owner_name,
    securityDefiner: row.security_definer,
    configuration: row.configuration,
    runtimeExecute: row.runtime_execute,
    staffExecute: row.staff_execute,
    publicExecute: row.public_execute,
    sourceSha256: createHash("sha256").update(row.source, "utf8").digest("hex"),
  });
}

async function readFunctionRows(client, functions) {
  if (functions.length === 0) return [];
  return (await client.query(`
    SELECT procedure.proname AS function_name,
           pg_catalog.oidvectortypes(procedure.proargtypes)::text AS identity_arguments,
           owner.rolname AS owner_name,
           owner.rolsuper OR owner.rolbypassrls AS owner_bypasses_rls,
           procedure.prosecdef AS security_definer,
           procedure.proconfig AS configuration,
           procedure.prosrc AS source,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', procedure.oid, 'EXECUTE'
           ) AS runtime_execute,
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
           ) AS staff_execute,
           pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
             AS public_execute
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
     WHERE namespace.nspname = 'public'
       AND procedure.proname = ANY($1::text[])
     ORDER BY procedure.proname, identity_arguments
  `, [functions.map((entry) => entry.name)])).rows;
}

function assertFunctionPosture(row, expected, tableOwner) {
  const identity = `${row.function_name}(${row.identity_arguments})`;
  const executeRole = expected.executeRole ?? "runtime";
  assert.equal(row.owner_name, tableOwner, `${identity} owner drifted`);
  assert.equal(row.owner_bypasses_rls, true, `${identity} owner cannot bypass RLS`);
  assert.equal(row.security_definer, true, `${identity} is not SECURITY DEFINER`);
  assert.deepEqual(row.configuration, ["search_path=pg_catalog"], `${identity} search_path drifted`);
  assert.equal(
    row.runtime_execute,
    executeRole === "runtime",
    `${identity} runtime EXECUTE drifted`,
  );
  assert.equal(
    row.staff_execute,
    executeRole === "staff",
    `${identity} staff EXECUTE drifted`,
  );
  assert.equal(row.public_execute, false, `${identity} PUBLIC EXECUTE is present`);
  assert.equal(identity, `${expected.name}(${expected.arguments})`);
  return identity;
}

async function readInstalledCatalog(client, verified, tableOwner) {
  const { release } = verified;
  const columnRows = (await client.query(`
    SELECT attribute.attname AS name,
           pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type,
           NOT attribute.attnotnull AS nullable
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = $1::pg_catalog.regclass
       AND attribute.attname = ANY($2::text[])
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     ORDER BY attribute.attname
  `, [`public."${release.table}"`, release.addedColumns.map((entry) => entry.name)])).rows;
  assert.deepEqual(
    columnRows,
    [...release.addedColumns].sort((left, right) => left.name.localeCompare(right.name)),
    "reviewed column catalog drifted",
  );

  const functionRows = await readFunctionRows(client, release.functions);
  assert.equal(functionRows.length, release.functions.length, "reviewed function count drifted");

  const expectedByIdentity = new Map(release.functions.map((entry) => [
    `${entry.name}(${entry.arguments})`,
    entry,
  ]));
  for (const row of functionRows) {
    const identity = `${row.function_name}(${row.identity_arguments})`;
    const expected = expectedByIdentity.get(identity);
    assert.ok(expected, `unexpected function overload ${identity}`);
    assertFunctionPosture(row, expected, tableOwner);
    assert.equal(
      row.source,
      verified.functionSources.get(row.function_name),
      `${identity} body drifted`,
    );
    expectedByIdentity.delete(identity);
  }
  assert.equal(expectedByIdentity.size, 0, "reviewed function is absent");
  return Object.freeze({
    columns: columnRows,
    functions: functionRows.map(functionEvidence),
  });
}

async function readPendingCatalog(client, verified, tableOwner) {
  const { release } = verified;
  const newFunctions = release.functions.filter(
    (entry) => entry.predecessorSourceSha256 === undefined,
  );
  const predecessorFunctions = release.functions.filter(
    (entry) => entry.predecessorSourceSha256 !== undefined,
  );
  const collisions = (await client.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = $1::pg_catalog.regclass
          AND attribute.attname = ANY($2::text[])
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped) AS columns,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_proc AS procedure
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = ANY($3::text[])) AS functions
  `, [
    `public."${release.table}"`,
    release.addedColumns.map((entry) => entry.name),
    newFunctions.map((entry) => entry.name),
  ])).rows[0];
  assert.deepEqual(collisions, { columns: 0, functions: 0 }, "preparation catalog collides");

  const functionRows = await readFunctionRows(client, predecessorFunctions);
  assert.equal(
    functionRows.length,
    predecessorFunctions.length,
    "predecessor function count drifted",
  );
  const expectedByIdentity = new Map(predecessorFunctions.map((entry) => [
    `${entry.name}(${entry.arguments})`,
    entry,
  ]));
  for (const row of functionRows) {
    const identity = `${row.function_name}(${row.identity_arguments})`;
    const expected = expectedByIdentity.get(identity);
    assert.ok(expected, `unexpected predecessor function overload ${identity}`);
    assertFunctionPosture(row, expected, tableOwner);
    assert.equal(
      createHash("sha256").update(row.source, "utf8").digest("hex"),
      expected.predecessorSourceSha256,
      `${identity} predecessor body drifted`,
    );
    expectedByIdentity.delete(identity);
  }
  assert.equal(expectedByIdentity.size, 0, "reviewed predecessor function is absent");
  return Object.freeze({
    columns: [],
    functions: functionRows.map(functionEvidence),
  });
}

export async function inspectPrivateTablePreparationProduction(
  env = process.env,
  {
    Client = pg.Client,
    rootDir = process.cwd(),
    migrationPath,
  } = {},
) {
  const directUrl = required(env, "DIRECT_URL");
  const releaseId = required(env, "PRIVATE_TABLE_PREPARATION_RELEASE_ID");
  const phase = required(env, "PRIVATE_TABLE_PREPARATION_PHASE");
  const evidencePath = required(env, "PRIVATE_TABLE_PREPARATION_EVIDENCE_PATH");
  const releaseCommit = required(env, "PRODUCTION_MIGRATION_RELEASE_COMMIT");
  if (!PHASES.has(phase)) throw new Error("preparation phase is invalid");
  if (!COMMIT.test(releaseCommit)) throw new Error("release commit is invalid");
  const verified = verifyPrivateTablePreparationSource(
    releaseId,
    rootDir,
    migrationPath,
  );
  const release = privateTablePreparation(releaseId);
  const parsed = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    ...postgresChannelBindingClientOptions(parsed),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    application_name: "grainline-private-table-preparation-inspect",
  });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const postureRow = (await client.query(`
      SELECT pg_catalog.current_database() AS database_name,
             current_user AS current_user_name,
             session_user AS session_user_name,
             owner.rolname AS table_owner_name,
             owner.rolsuper OR owner.rolbypassrls AS owner_bypasses_rls,
             target.relrowsecurity AS rls_enabled,
             target.relforcerowsecurity AS rls_forced,
             target.relacl::text AS table_acl,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_policy AS policy
               WHERE policy.polrelid = target.oid) AS policy_count,
             pg_catalog.has_table_privilege(
               'grainline_app_runtime', target.oid, 'SELECT'
             ) AS runtime_select,
             pg_catalog.has_table_privilege(
               'grainline_app_runtime', target.oid, 'INSERT'
             ) AS runtime_insert,
             pg_catalog.has_table_privilege(
               'grainline_app_runtime', target.oid, 'UPDATE'
             ) AS runtime_update,
             pg_catalog.has_table_privilege(
               'grainline_app_runtime', target.oid, 'DELETE'
             ) AS runtime_delete,
             pg_catalog.has_table_privilege(
               'grainline_staff_read_runtime', target.oid, 'SELECT'
             ) AS staff_select,
             pg_catalog.has_table_privilege(0, target.oid, 'SELECT') AS public_select
        FROM pg_catalog.pg_class AS target
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = target.relowner
       WHERE target.oid = $1::pg_catalog.regclass
         AND target.relkind = 'r'
    `, [`public."${release.table}"`])).rows[0];
    assert.ok(postureRow, "reviewed table is absent");
    assert.equal(postureRow.current_user_name, postureRow.session_user_name);
    assert.equal(postureRow.current_user_name, postureRow.table_owner_name);
    assert.equal(postureRow.owner_bypasses_rls, true);
    const posture = evidencePosture(postureRow);
    assertExpectedPosture(posture, release.expectedPredecessorPosture);

    const ledger = (await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count::integer AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = $1
       ORDER BY started_at
    `, [release.migration])).rows;
    const applied = successfulMigration(ledger, release);
    const state = applied ? "applied" : "pending";
    if (phase === "postflight") assert.equal(state, "applied", "preparation is not applied");

    let catalog;
    if (applied) {
      catalog = await readInstalledCatalog(client, verified, postureRow.table_owner_name);
    } else {
      catalog = await readPendingCatalog(client, verified, postureRow.table_owner_name);
    }
    await client.query("COMMIT");

    const evidence = Object.freeze({
      releaseId,
      releaseCommit,
      phase,
      state,
      migration: release.migration,
      migrationSha256: release.migrationSha256,
      databaseName: postureRow.database_name,
      migrationRole: postureRow.current_user_name,
      table: release.table,
      posture,
      catalog,
      productionChanged: false,
      containsRowData: false,
    });
    const previousPath = env.PRIVATE_TABLE_PREPARATION_PREVIOUS_EVIDENCE_PATH?.trim();
    if (phase === "postflight") {
      if (!previousPath) throw new Error("previous preparation evidence is required");
      const previous = JSON.parse(readFileSync(previousPath, "utf8"));
      assert.equal(previous.releaseId, evidence.releaseId, "release evidence drifted");
      assert.equal(previous.releaseCommit, evidence.releaseCommit, "commit evidence drifted");
      assert.equal(previous.migration, evidence.migration, "migration evidence drifted");
      assert.deepEqual(previous.posture, evidence.posture, "table posture changed during preparation");
    }
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    return evidence;
  } finally {
    try { await client.query("ROLLBACK"); } catch {}
    try { await client.end(); } catch {}
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  inspectPrivateTablePreparationProduction()
    .then((evidence) => process.stdout.write(`${evidence.state}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
