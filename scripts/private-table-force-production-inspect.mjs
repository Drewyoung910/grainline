#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  privateTableForce,
  verifyPrivateTableForceSource,
} from "./private-table-force-catalog.mjs";
import {
  functionSourceFromMigration,
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

function successfulMigration(rows, entry, acceptedSteps = new Set([1])) {
  const attempts = rows.filter((row) => row.migration_name === entry.migration);
  for (const row of attempts) {
    assert.equal(row.checksum, entry.migrationSha256, `${entry.migration} checksum drifted`);
  }
  const successes = attempts.filter((row) => (
    row.finished_at !== null
    && row.rolled_back_at === null
    && acceptedSteps.has(Number(row.applied_steps_count))
  ));
  assert.ok(successes.length <= 1, `${entry.migration} has duplicate successful rows`);
  for (const row of attempts) {
    if (!successes.includes(row)) {
      assert.notEqual(row.rolled_back_at, null, `${entry.migration} has an unresolved attempt`);
    }
  }
  return successes.length === 1;
}

function reviewedFunctionSources(rootDir, release) {
  const preparation = verifyPrivateTablePreparationSource(
    release.enable.preparationReleaseId,
    rootDir,
  );
  const sources = new Map(preparation.functionSources);
  for (const prerequisite of release.prerequisites) {
    const sql = readFileSync(
      `${rootDir}/prisma/migrations/${prerequisite.migration}/migration.sql`,
      "utf8",
    );
    for (const entry of preparation.release.functions) {
      if (sql.includes(`CREATE OR REPLACE FUNCTION public.${entry.name}(`)) {
        sources.set(entry.name, functionSourceFromMigration(sql, entry.name));
      }
    }
  }
  return Object.freeze({ preparation, sources });
}

async function readFunctions(client, release, rootDir, tableOwner) {
  const { preparation, sources } = reviewedFunctionSources(rootDir, release);
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
    assert.equal(row.source, sources.get(row.function_name), `${identity} body drifted`);
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

export async function inspectPrivateTableForceProduction(
  env = process.env,
  { Client = pg.Client, rootDir = process.cwd() } = {},
) {
  const directUrl = required(env, "DIRECT_URL");
  const releaseId = required(env, "PRIVATE_TABLE_FORCE_RELEASE_ID");
  const phase = required(env, "PRIVATE_TABLE_FORCE_PHASE");
  const evidencePath = required(env, "PRIVATE_TABLE_FORCE_EVIDENCE_PATH");
  const releaseCommit = required(env, "PRODUCTION_MIGRATION_RELEASE_COMMIT");
  if (!PHASES.has(phase)) throw new Error("FORCE phase is invalid");
  if (!COMMIT.test(releaseCommit)) throw new Error("release commit is invalid");

  const verified = verifyPrivateTableForceSource(releaseId, rootDir);
  const release = privateTableForce(releaseId);
  const parsed = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    ...postgresChannelBindingClientOptions(parsed),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    application_name: "grainline-private-table-force-inspect",
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
    assert.equal(row.owner_bypasses_rls, true, "table owner cannot bypass FORCE");

    const posture = Object.freeze({
      rlsEnabled: row.rls_enabled,
      rlsForced: row.rls_forced,
      policyCount: row.policy_count,
      runtimeSelect: row.runtime_select,
      runtimeInsert: row.runtime_insert,
      runtimeUpdate: row.runtime_update,
      runtimeDelete: row.runtime_delete,
      staffSelect: row.staff_select,
      publicSelect: row.public_select,
      nonOwnerTableAclCount: row.non_owner_table_acl_count,
      nonOwnerColumnAclCount: row.non_owner_column_acl_count,
    });
    assert.equal(posture.rlsEnabled, true, "policyless ENABLE is absent");
    assert.equal(posture.policyCount, 0, "policyless posture drifted");
    for (const key of [
      "runtimeSelect", "runtimeInsert", "runtimeUpdate", "runtimeDelete",
      "staffSelect", "publicSelect",
    ]) assert.equal(posture[key], false, `${key} drifted`);
    assert.equal(posture.nonOwnerTableAclCount, 0, "table ACL drifted");
    assert.equal(posture.nonOwnerColumnAclCount, 0, "column ACL drifted");

    const ledgerEntries = [
      release.enable.preparation,
      release.enable,
      ...release.prerequisites,
      { migration: release.migration, migrationSha256: release.migrationSha256 },
    ];
    const ledger = (await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count::integer AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = ANY($1::text[])
       ORDER BY migration_name, started_at
    `, [ledgerEntries.map((entry) => entry.migration)])).rows;
    assert.equal(successfulMigration(ledger, release.enable.preparation), true, "preparation is not applied");
    assert.equal(successfulMigration(ledger, release.enable), true, "ENABLE is not applied");
    for (const prerequisite of release.prerequisites) {
      assert.equal(
        successfulMigration(ledger, prerequisite, new Set([0, 1])),
        true,
        `${prerequisite.migration} is not applied`,
      );
    }
    const forced = successfulMigration(
      ledger,
      { migration: release.migration, migrationSha256: release.migrationSha256 },
    );
    const state = forced ? "forced" : "ready";
    assert.equal(posture.rlsForced, forced, "FORCE catalog and ledger disagree");
    if (phase === "postflight") assert.equal(state, "forced", "FORCE is not applied");

    const functions = await readFunctions(client, release, rootDir, row.table_owner_name);
    await client.query("COMMIT");
    const evidence = Object.freeze({
      releaseId,
      releaseCommit,
      phase,
      state,
      table: release.table,
      enableMigration: release.enable.migration,
      prerequisiteMigrations: release.prerequisites.map((entry) => entry.migration),
      forceMigration: release.migration,
      forceMigrationSha256: verified.digest,
      databaseName: row.database_name,
      migrationRole: row.current_user_name,
      posture,
      functions,
      productionChanged: false,
      containsRowData: false,
    });
    const previousPath = env.PRIVATE_TABLE_FORCE_PREVIOUS_EVIDENCE_PATH?.trim();
    if (phase === "postflight") {
      if (!previousPath) throw new Error("previous FORCE evidence is required");
      const previous = JSON.parse(readFileSync(previousPath, "utf8"));
      assert.equal(previous.releaseId, evidence.releaseId, "release evidence drifted");
      assert.equal(previous.releaseCommit, evidence.releaseCommit, "commit evidence drifted");
      assert.equal(previous.forceMigration, evidence.forceMigration, "migration evidence drifted");
      assert.equal(previous.state === "ready" || previous.state === "forced", true);
      assert.deepEqual(previous.functions, evidence.functions, "function boundary changed during FORCE");
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
  inspectPrivateTableForceProduction()
    .then((evidence) => process.stdout.write(`${evidence.state}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
