#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  privateTableEnable,
  verifyPrivateTableEnableSource,
} from "./private-table-enable-catalog.mjs";
import { verifyPrivateTablePreparationSource } from
  "./private-table-preparation-catalog.mjs";
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

function successfulMigration(rows, name, checksum) {
  const attempts = rows.filter((row) => row.migration_name === name);
  for (const row of attempts) assert.equal(row.checksum, checksum, `${name} checksum drifted`);
  const successes = attempts.filter((row) => (
    row.finished_at !== null
    && row.rolled_back_at === null
    && Number(row.applied_steps_count) === 1
  ));
  assert.ok(successes.length <= 1, `${name} has duplicate successful rows`);
  for (const row of attempts) {
    if (!successes.includes(row)) {
      assert.notEqual(row.rolled_back_at, null, `${name} has an unresolved failed attempt`);
    }
  }
  return successes.length === 1;
}

function postureFromRow(row) {
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
    runtimeAnyColumn: row.runtime_any_column,
    staffAnyColumn: row.staff_any_column,
    nonOwnerTableAclCount: row.non_owner_table_acl_count,
    nonOwnerColumnAclCount: row.non_owner_column_acl_count,
  });
}

function assertReadyPosture(posture, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(posture[key], value, `${key} drifted before ENABLE`);
  }
  assert.equal(posture.runtimeAnyColumn, true, "runtime predecessor column authority drifted");
  assert.equal(posture.staffAnyColumn, false, "staff predecessor column authority drifted");
  assert.equal(posture.nonOwnerTableAclCount, 4, "table ACL drifted before ENABLE");
  assert.equal(posture.nonOwnerColumnAclCount, 0, "column ACL drifted before ENABLE");
}

function assertEnabledPosture(posture) {
  assert.deepEqual(posture, {
    rlsEnabled: true,
    rlsForced: false,
    policyCount: 0,
    runtimeSelect: false,
    runtimeInsert: false,
    runtimeUpdate: false,
    runtimeDelete: false,
    staffSelect: false,
    publicSelect: false,
    runtimeAnyColumn: false,
    staffAnyColumn: false,
    nonOwnerTableAclCount: 0,
    nonOwnerColumnAclCount: 0,
  });
}

async function readFunctions(client, preparation, tableOwner) {
  const names = preparation.release.functions.map((entry) => entry.name);
  const rows = (await client.query(`
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
  `, [names])).rows;
  assert.equal(rows.length, preparation.release.functions.length, "function count drifted");
  const expected = new Map(preparation.release.functions.map((entry) => [
    `${entry.name}(${entry.arguments})`,
    entry,
  ]));
  for (const row of rows) {
    const identity = `${row.function_name}(${row.identity_arguments})`;
    assert.ok(expected.has(identity), `unexpected function overload ${identity}`);
    assert.equal(row.owner_name, tableOwner, `${identity} owner drifted`);
    assert.equal(row.owner_bypasses_rls, true, `${identity} owner cannot bypass RLS`);
    assert.equal(row.security_definer, true, `${identity} is not SECURITY DEFINER`);
    assert.deepEqual(row.configuration, ["search_path=pg_catalog"], `${identity} search_path drifted`);
    assert.equal(row.runtime_execute, true, `${identity} runtime EXECUTE is absent`);
    assert.equal(row.staff_execute, false, `${identity} staff EXECUTE is present`);
    assert.equal(row.public_execute, false, `${identity} PUBLIC EXECUTE is present`);
    assert.equal(
      row.source,
      preparation.functionSources.get(row.function_name),
      `${identity} body drifted`,
    );
    expected.delete(identity);
  }
  assert.equal(expected.size, 0, "reviewed function is absent");
  return rows.map((row) => Object.freeze({
    name: row.function_name,
    arguments: row.identity_arguments,
    owner: row.owner_name,
    securityDefiner: row.security_definer,
    configuration: row.configuration,
    runtimeExecute: row.runtime_execute,
    staffExecute: row.staff_execute,
    publicExecute: row.public_execute,
    sourceSha256: createHash("sha256").update(row.source, "utf8").digest("hex"),
  }));
}

export async function inspectPrivateTableEnableProduction(
  env = process.env,
  { Client = pg.Client, rootDir = process.cwd() } = {},
) {
  const directUrl = required(env, "DIRECT_URL");
  const releaseId = required(env, "PRIVATE_TABLE_ENABLE_RELEASE_ID");
  const phase = required(env, "PRIVATE_TABLE_ENABLE_PHASE");
  const evidencePath = required(env, "PRIVATE_TABLE_ENABLE_EVIDENCE_PATH");
  const releaseCommit = required(env, "PRODUCTION_MIGRATION_RELEASE_COMMIT");
  if (!PHASES.has(phase)) throw new Error("ENABLE phase is invalid");
  if (!COMMIT.test(releaseCommit)) throw new Error("release commit is invalid");

  const verified = verifyPrivateTableEnableSource(releaseId, rootDir);
  const release = privateTableEnable(releaseId);
  const preparation = verifyPrivateTablePreparationSource(
    release.preparationReleaseId,
    rootDir,
  );
  const parsed = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    ...postgresChannelBindingClientOptions(parsed),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    application_name: "grainline-private-table-enable-inspect",
  });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const row = (await client.query(`
      SELECT pg_catalog.current_database() AS database_name,
             current_user AS current_user_name,
             session_user AS session_user_name,
             owner.rolname AS table_owner_name,
             owner.rolsuper OR owner.rolbypassrls AS owner_bypasses_rls,
             target.relrowsecurity AS rls_enabled,
             target.relforcerowsecurity AS rls_forced,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_policy AS policy
               WHERE policy.polrelid = target.oid) AS policy_count,
             pg_catalog.has_table_privilege('grainline_app_runtime', target.oid, 'SELECT') AS runtime_select,
             pg_catalog.has_table_privilege('grainline_app_runtime', target.oid, 'INSERT') AS runtime_insert,
             pg_catalog.has_table_privilege('grainline_app_runtime', target.oid, 'UPDATE') AS runtime_update,
             pg_catalog.has_table_privilege('grainline_app_runtime', target.oid, 'DELETE') AS runtime_delete,
             pg_catalog.has_table_privilege('grainline_staff_read_runtime', target.oid, 'SELECT') AS staff_select,
             pg_catalog.has_table_privilege(0, target.oid, 'SELECT') AS public_select,
             pg_catalog.has_any_column_privilege(
               'grainline_app_runtime', target.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
             ) AS runtime_any_column,
             pg_catalog.has_any_column_privilege(
               'grainline_staff_read_runtime', target.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
             ) AS staff_any_column,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.aclexplode(
                  COALESCE(target.relacl, pg_catalog.acldefault('r', target.relowner))
                ) AS acl
               WHERE acl.grantee <> target.relowner) AS non_owner_table_acl_count,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_attribute AS attribute
                CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
               WHERE attribute.attrelid = target.oid
                 AND attribute.attnum > 0
                 AND NOT attribute.attisdropped
                 AND acl.grantee <> target.relowner) AS non_owner_column_acl_count
        FROM pg_catalog.pg_class AS target
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = target.relowner
       WHERE target.oid = $1::pg_catalog.regclass
         AND target.relkind = 'r'
    `, [`public."${release.table}"`])).rows[0];
    assert.ok(row, "reviewed table is absent");
    assert.equal(row.current_user_name, row.session_user_name, "owner session is indirect");
    assert.equal(row.current_user_name, row.table_owner_name, "session is not table owner");
    assert.equal(row.owner_bypasses_rls, true, "table owner cannot bypass later FORCE");

    const ledger = (await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count::integer AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = ANY($1::text[])
       ORDER BY migration_name, started_at
    `, [[release.preparation.migration, release.migration]])).rows;
    assert.equal(successfulMigration(
      ledger,
      release.preparation.migration,
      release.preparation.migrationSha256,
    ), true, "preparation is not applied");
    const enabled = successfulMigration(ledger, release.migration, release.migrationSha256);
    const posture = postureFromRow(row);
    const state = enabled ? "enabled" : "ready";
    if (enabled) assertEnabledPosture(posture);
    else assertReadyPosture(posture, release.preparation.expectedPredecessorPosture);
    if (phase === "postflight") assert.equal(state, "enabled", "ENABLE is not applied");

    const functions = await readFunctions(client, preparation, row.table_owner_name);
    await client.query("COMMIT");
    const evidence = Object.freeze({
      releaseId,
      releaseCommit,
      phase,
      state,
      preparationMigration: release.preparation.migration,
      enableMigration: release.migration,
      enableMigrationSha256: verified.digest,
      databaseName: row.database_name,
      migrationRole: row.current_user_name,
      table: release.table,
      posture,
      functions,
      productionChanged: false,
      containsRowData: false,
    });
    const previousPath = env.PRIVATE_TABLE_ENABLE_PREVIOUS_EVIDENCE_PATH?.trim();
    if (phase === "postflight") {
      if (!previousPath) throw new Error("previous ENABLE evidence is required");
      const previous = JSON.parse(readFileSync(previousPath, "utf8"));
      assert.equal(previous.releaseId, evidence.releaseId, "release evidence drifted");
      assert.equal(previous.releaseCommit, evidence.releaseCommit, "commit evidence drifted");
      assert.equal(previous.enableMigration, evidence.enableMigration, "migration evidence drifted");
      assert.equal(previous.state === "ready" || previous.state === "enabled", true);
      assert.deepEqual(previous.functions, evidence.functions, "function boundary changed during ENABLE");
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
  inspectPrivateTableEnableProduction()
    .then((evidence) => process.stdout.write(`${evidence.state}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
