#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  privateTableFunctionExecuteRoles,
  privateTablePreparation,
  privateTablePreparationTables,
  verifyPrivateTablePreparationSource,
} from "./private-table-preparation-catalog.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";
import { isReviewedSuccessfulMigration } from "./reviewed-manually-applied-migrations.mjs";

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
  const successes = attempts.filter(isReviewedSuccessfulMigration);
  assert.ok(successes.length <= 1, "migration has duplicate successful rows");
  for (const row of attempts) {
    if (!successes.includes(row)) {
      assert.notEqual(row.rolled_back_at, null, "migration has an unresolved failed attempt");
    }
  }
  return successes.length === 1;
}

async function readPreparationMarkers(client, release) {
  const newFunctions = release.functions.filter(
    (entry) => entry.predecessorSourceSha256 === undefined,
  );
  const constraints = release.addedConstraints ?? [];
  const tableNames = [release.table, ...(release.additionalTables ?? [])];
  const markers = (await client.query(`
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
      ,(SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.pg_constraint AS constraint_state
          JOIN pg_catalog.pg_class AS relation
            ON relation.oid = constraint_state.conrelid
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname = ANY($4::text[])
           AND constraint_state.conname = ANY($5::text[])
           AND constraint_state.contype = 'c'
           AND constraint_state.convalidated) AS constraints
  `, [
    `public."${release.table}"`,
    release.addedColumns.map((entry) => entry.name),
    newFunctions.map((entry) => entry.name),
    tableNames,
    constraints.map((entry) => entry.name),
  ])).rows[0];
  if ((release.addedIndexes ?? []).length > 0) {
    markers.indexes = (await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM pg_catalog.pg_class AS index_relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = index_relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND index_relation.relkind = 'i'
         AND index_relation.relname = ANY($1::text[])
    `, [release.addedIndexes.map((entry) => entry.name)])).rows[0].count;
  }
  if ((release.addedTriggers ?? []).length > 0) {
    markers.triggers = (await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM pg_catalog.pg_trigger AS trigger_state
       WHERE trigger_state.tgrelid = $1::pg_catalog.regclass
         AND trigger_state.tgname = ANY($2::text[])
         AND NOT trigger_state.tgisinternal
    `, [
      `public."${release.table}"`,
      release.addedTriggers.map((entry) => entry.name),
    ])).rows[0].count;
  }
  return markers;
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

export function preparationMarkersAreAbsent(markers) {
  return markers !== null
    && typeof markers === "object"
    && !Array.isArray(markers)
    && Object.values(markers).length >= 3
    && Object.values(markers).every((count) => count === 0);
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
    volatility: row.volatility,
    configuration: row.configuration,
    runtimeExecute: row.runtime_execute,
    staffExecute: row.staff_execute,
    accountDeletionExecute: row.account_deletion_execute,
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
           procedure.provolatile AS volatility,
           procedure.proconfig AS configuration,
           procedure.prosrc AS source,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', procedure.oid, 'EXECUTE'
           ) AS runtime_execute,
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
           ) AS staff_execute,
           pg_catalog.has_function_privilege(
             'grainline_account_deletion_runtime', procedure.oid, 'EXECUTE'
           ) AS account_deletion_execute,
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
  assert.equal(row.owner_name, tableOwner, `${identity} owner drifted`);
  assert.equal(row.owner_bypasses_rls, true, `${identity} owner cannot bypass RLS`);
  assert.equal(row.security_definer, true, `${identity} is not SECURITY DEFINER`);
  assert.equal(row.volatility, expected.volatility ?? "v", `${identity} volatility drifted`);
  assert.deepEqual(row.configuration, ["search_path=pg_catalog"], `${identity} search_path drifted`);
  const executeRoles = privateTableFunctionExecuteRoles(expected);
  assert.equal(
    Boolean(row.runtime_execute),
    executeRoles.includes("runtime"),
    `${identity} runtime EXECUTE drifted`,
  );
  assert.equal(
    Boolean(row.staff_execute),
    executeRoles.includes("staff"),
    `${identity} staff EXECUTE drifted`,
  );
  assert.equal(
    Boolean(row.account_deletion_execute),
    executeRoles.includes("account_deletion"),
    `${identity} account-deletion EXECUTE drifted`,
  );
  assert.equal(row.public_execute, false, `${identity} PUBLIC EXECUTE is present`);
  assert.equal(identity, `${expected.name}(${expected.arguments})`);
  return identity;
}

async function readRetainedFunctionCatalog(client, release, tableOwner) {
  const retained = release.retainedFunctions ?? [];
  const rows = await readFunctionRows(client, retained);
  assert.equal(rows.length, retained.length, "retained function count drifted");
  const expectedByIdentity = new Map(retained.map((entry) => [
    `${entry.name}(${entry.arguments})`,
    entry,
  ]));
  for (const row of rows) {
    const identity = `${row.function_name}(${row.identity_arguments})`;
    const expected = expectedByIdentity.get(identity);
    assert.ok(expected, `unexpected retained function overload ${identity}`);
    assertFunctionPosture(row, expected, tableOwner);
    assert.equal(
      createHash("sha256").update(row.source, "utf8").digest("hex"),
      expected.sourceSha256,
      `${identity} retained body drifted`,
    );
    expectedByIdentity.delete(identity);
  }
  assert.equal(expectedByIdentity.size, 0, "reviewed retained function is absent");
  return rows.map(functionEvidence);
}

async function readAddedIndexes(client, release) {
  const expected = [...(release.addedIndexes ?? [])]
    .sort((left, right) => left.name.localeCompare(right.name));
  if (expected.length === 0) return [];
  const rows = (await client.query(`
    SELECT index_relation.relname AS name,
           pg_catalog.pg_get_indexdef(index_relation.oid) AS definition,
           index_state.indisunique AS unique,
           index_state.indisvalid AS valid,
           index_state.indisready AS ready
      FROM pg_catalog.pg_index AS index_state
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_state.indexrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = index_relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND index_relation.relname = ANY($1::text[])
     ORDER BY index_relation.relname
  `, [expected.map((entry) => entry.name)])).rows;
  assert.deepEqual(rows, expected.map((entry) => ({
    ...entry,
    unique: false,
    valid: true,
    ready: true,
  })), "reviewed index catalog drifted");
  return rows;
}

async function readAddedTriggers(client, release, tableOwner) {
  const expected = [...(release.addedTriggers ?? [])]
    .sort((left, right) => left.name.localeCompare(right.name));
  if (expected.length === 0) return [];
  const rows = (await client.query(`
    SELECT trigger_state.tgname AS name,
           procedure.proname AS function,
           trigger_state.tgenabled AS enabled,
           trigger_state.tgtype::integer AS type,
           owner.rolname AS function_owner,
           owner.rolsuper OR owner.rolbypassrls AS owner_bypasses_rls,
           procedure.prosecdef AS security_definer,
           procedure.proconfig AS configuration
      FROM pg_catalog.pg_trigger AS trigger_state
      JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger_state.tgfoid
      JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
     WHERE trigger_state.tgrelid = $1::pg_catalog.regclass
       AND trigger_state.tgname = ANY($2::text[])
       AND NOT trigger_state.tgisinternal
     ORDER BY trigger_state.tgname
  `, [
    `public."${release.table}"`,
    expected.map((entry) => entry.name),
  ])).rows;
  assert.equal(rows.length, expected.length, "reviewed trigger count drifted");
  for (const [index, row] of rows.entries()) {
    assert.deepEqual(
      {
        name: row.name,
        function: row.function,
        enabled: row.enabled,
        type: row.type,
      },
      expected[index],
      `${row.name} trigger definition drifted`,
    );
    assert.equal(row.function_owner, tableOwner, `${row.name} function owner drifted`);
    assert.equal(row.owner_bypasses_rls, true, `${row.name} owner cannot bypass RLS`);
    assert.equal(row.security_definer, true, `${row.name} function is not SECURITY DEFINER`);
    assert.deepEqual(row.configuration, ["search_path=pg_catalog"], `${row.name} search_path drifted`);
  }
  return rows.map((row) => Object.freeze({
    name: row.name,
    function: row.function,
    enabled: row.enabled,
    type: row.type,
  }));
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

  const expectedConstraints = [...(release.addedConstraints ?? [])]
    .sort((left, right) => (
      left.table.localeCompare(right.table) || left.name.localeCompare(right.name)
    ));
  const constraintRows = expectedConstraints.length === 0
    ? []
    : (await client.query(`
      SELECT relation.relname AS table,
             constraint_state.conname AS name
        FROM pg_catalog.pg_constraint AS constraint_state
        JOIN pg_catalog.pg_class AS relation
          ON relation.oid = constraint_state.conrelid
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relname = ANY($1::text[])
         AND constraint_state.conname = ANY($2::text[])
         AND constraint_state.contype = 'c'
         AND constraint_state.convalidated
       ORDER BY relation.relname, constraint_state.conname
    `, [
      [...new Set(expectedConstraints.map((entry) => entry.table))],
      expectedConstraints.map((entry) => entry.name),
    ])).rows;
  assert.deepEqual(
    constraintRows,
    expectedConstraints,
    "reviewed constraint catalog drifted",
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
  const retainedFunctions = await readRetainedFunctionCatalog(
    client,
    release,
    tableOwner,
  );
  const indexes = await readAddedIndexes(client, release);
  const triggers = await readAddedTriggers(client, release, tableOwner);
  return Object.freeze({
    columns: columnRows,
    constraints: constraintRows,
    functions: functionRows.map(functionEvidence),
    retainedFunctions,
    indexes,
    triggers,
  });
}

async function readPendingCatalog(client, verified, tableOwner) {
  const { release } = verified;
  const predecessorFunctions = release.functions.filter(
    (entry) => entry.predecessorSourceSha256 !== undefined,
  );
  const collisions = await readPreparationMarkers(client, release);
  assert.equal(
    preparationMarkersAreAbsent(collisions),
    true,
    "preparation catalog collides",
  );

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
  const retainedFunctions = await readRetainedFunctionCatalog(
    client,
    release,
    tableOwner,
  );
  return Object.freeze({
    columns: [],
    constraints: [],
    functions: functionRows.map(functionEvidence),
    retainedFunctions,
    indexes: [],
    triggers: [],
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
  const tables = privateTablePreparationTables(release);
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
    const postureRows = [];
    for (const table of tables) {
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
      `, [`public."${table}"`])).rows[0];
      assert.ok(postureRow, `reviewed table ${table} is absent`);
      assert.equal(postureRow.current_user_name, postureRow.session_user_name);
      assert.equal(postureRow.current_user_name, postureRow.table_owner_name);
      assert.equal(postureRow.owner_bypasses_rls, true);
      assertExpectedPosture(
        evidencePosture(postureRow),
        release.expectedPredecessorPosture,
      );
      postureRows.push(postureRow);
    }
    const postureRow = postureRows[0];
    const postures = Object.fromEntries(postureRows.map((row, index) => [
      tables[index],
      evidencePosture(row),
    ]));
    const posture = postures[release.table];

    const ledger = (await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count::integer AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = $1
       ORDER BY started_at
    `, [release.migration])).rows;
    const applied = successfulMigration(ledger, release);
    const markers = await readPreparationMarkers(client, release);
    const expectedMarkers = {
      columns: release.addedColumns.length,
      functions: release.functions.filter(
        (entry) => entry.predecessorSourceSha256 === undefined,
      ).length,
      constraints: (release.addedConstraints ?? []).length,
      ...((release.addedIndexes ?? []).length > 0
        ? { indexes: release.addedIndexes.length }
        : {}),
      ...((release.addedTriggers ?? []).length > 0
        ? { triggers: release.addedTriggers.length }
        : {}),
    };
    const hasNoMarkers = Object.values(markers).every((count) => count === 0);
    const hasAllMarkers = Object.entries(expectedMarkers).every(
      ([name, count]) => markers[name] === count,
    );
    assert.ok(hasNoMarkers || hasAllMarkers, "preparation catalog is partially applied");
    if (applied) {
      assert.equal(hasAllMarkers, true, "applied preparation catalog is absent");
    }
    const state = applied
      ? "applied"
      : hasAllMarkers
        ? "applied_unrecorded"
        : "pending";
    if (phase === "postflight") assert.equal(state, "applied", "preparation is not applied");

    let catalog;
    if (state === "applied" || state === "applied_unrecorded") {
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
      tables,
      posture,
      postures,
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
      assert.deepEqual(
        previous.postures ?? { [previous.table]: previous.posture },
        evidence.postures,
        "table group posture changed during preparation",
      );
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
