#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  privilegeRelease,
  verifyPrivilegeReleaseSource,
} from "./privilege-release-catalog.mjs";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";
import { isReviewedSuccessfulMigration } from "./reviewed-manually-applied-migrations.mjs";

const PHASES = new Set(["preflight", "postflight"]);
const COMMIT = /^[0-9a-f]{40}$/u;
const PREDECESSOR_PRIVILEGES = Object.freeze([
  "DELETE",
  "INSERT",
  "SELECT",
  "UPDATE",
]);

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

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function classify(rows, release) {
  const expectedTables = Object.keys(release.tables).sort();
  assert.deepEqual(
    rows.map((row) => row.table_name),
    expectedTables,
    "reviewed table catalog drifted",
  );
  let predecessorCount = 0;
  let successorCount = 0;
  const tables = rows.map((row) => {
    assert.equal(row.current_user_name, row.session_user_name, "session role drifted");
    assert.equal(row.current_user_name, row.table_owner_name, "table owner drifted");
    assert.equal(row.owner_bypasses_rls, true, "table owner cannot bypass RLS");
    assert.equal(row.rls_enabled, false, `${row.table_name} unexpectedly enables RLS`);
    assert.equal(row.rls_forced, false, `${row.table_name} unexpectedly forces RLS`);
    assert.equal(row.policy_count, 0, `${row.table_name} unexpectedly has policies`);
    assert.deepEqual(row.public_privileges, [], `${row.table_name} PUBLIC privileges drifted`);
    assert.deepEqual(row.runtime_grant_options, [], `${row.table_name} grant options drifted`);
    assert.deepEqual(row.runtime_column_privileges, [], `${row.table_name} column grants drifted`);
    const actual = sorted(row.runtime_privileges);
    const successor = sorted(release.tables[row.table_name]);
    if (actual.join("|") === PREDECESSOR_PRIVILEGES.join("|")) predecessorCount += 1;
    else if (actual.join("|") === successor.join("|")) successorCount += 1;
    else assert.fail(`${row.table_name} runtime privileges drifted: ${actual.join(",")}`);
    return Object.freeze({ table: row.table_name, runtimePrivileges: actual });
  });
  assert.ok(
    predecessorCount === rows.length || successorCount === rows.length,
    "privilege release is partially applied",
  );
  return Object.freeze({
    posture: predecessorCount === rows.length ? "predecessor" : "successor",
    tables,
  });
}

export async function inspectPrivilegeReleaseProduction(
  env = process.env,
  { Client = pg.Client, rootDir = process.cwd(), migrationPath } = {},
) {
  const directUrl = required(env, "DIRECT_URL");
  const releaseId = required(env, "PRIVILEGE_RELEASE_ID");
  const phase = required(env, "PRIVILEGE_RELEASE_PHASE");
  const evidencePath = required(env, "PRIVILEGE_RELEASE_EVIDENCE_PATH");
  const releaseCommit = required(env, "PRODUCTION_MIGRATION_RELEASE_COMMIT");
  if (!PHASES.has(phase)) throw new Error("privilege release phase is invalid");
  if (!COMMIT.test(releaseCommit)) throw new Error("release commit is invalid");
  const verified = verifyPrivilegeReleaseSource(releaseId, rootDir, migrationPath);
  const release = privilegeRelease(releaseId);
  const parsed = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    ...postgresChannelBindingClientOptions(parsed),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    application_name: "grainline-privilege-release-inspect",
  });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tableNames = Object.keys(release.tables).sort();
    const rows = (await client.query(`
      SELECT target.relname AS table_name,
             pg_catalog.current_database() AS database_name,
             current_user AS current_user_name,
             session_user AS session_user_name,
             owner.rolname AS table_owner_name,
             owner.rolsuper OR owner.rolbypassrls AS owner_bypasses_rls,
             target.relrowsecurity AS rls_enabled,
             target.relforcerowsecurity AS rls_forced,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_policy AS policy
               WHERE policy.polrelid = target.oid) AS policy_count,
             coalesce((
               SELECT pg_catalog.array_agg(DISTINCT pg_catalog.upper(acl.privilege_type)
                        ORDER BY pg_catalog.upper(acl.privilege_type))
                 FROM pg_catalog.aclexplode(coalesce(
                        target.relacl,
                        pg_catalog.acldefault('r', target.relowner)
                      )) AS acl
                WHERE acl.grantee = runtime_role.oid
             ), ARRAY[]::text[]) AS runtime_privileges,
             coalesce((
               SELECT pg_catalog.array_agg(DISTINCT pg_catalog.upper(acl.privilege_type)
                        ORDER BY pg_catalog.upper(acl.privilege_type))
                 FROM pg_catalog.aclexplode(coalesce(
                        target.relacl,
                        pg_catalog.acldefault('r', target.relowner)
                      )) AS acl
                WHERE acl.grantee = 0
             ), ARRAY[]::text[]) AS public_privileges,
             coalesce((
               SELECT pg_catalog.array_agg(DISTINCT pg_catalog.upper(acl.privilege_type)
                        ORDER BY pg_catalog.upper(acl.privilege_type))
                 FROM pg_catalog.aclexplode(coalesce(
                        target.relacl,
                        pg_catalog.acldefault('r', target.relowner)
                      )) AS acl
                WHERE acl.grantee = runtime_role.oid AND acl.is_grantable
             ), ARRAY[]::text[]) AS runtime_grant_options,
             coalesce((
               SELECT pg_catalog.array_agg(
                        DISTINCT pg_catalog.format('%I:%s', attribute.attname,
                          pg_catalog.upper(acl.privilege_type))
                        ORDER BY pg_catalog.format('%I:%s', attribute.attname,
                          pg_catalog.upper(acl.privilege_type)))
                 FROM pg_catalog.pg_attribute AS attribute
                 CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
                WHERE attribute.attrelid = target.oid
                  AND attribute.attnum > 0
                  AND NOT attribute.attisdropped
                  AND acl.grantee = runtime_role.oid
             ), ARRAY[]::text[]) AS runtime_column_privileges
        FROM pg_catalog.pg_class AS target
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = target.relnamespace
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = target.relowner
        CROSS JOIN pg_catalog.pg_roles AS runtime_role
       WHERE namespace.nspname = 'public'
         AND target.relkind = 'r'
         AND target.relname = ANY($1::text[])
         AND runtime_role.rolname = 'grainline_app_runtime'
       ORDER BY target.relname
    `, [tableNames])).rows;
    const catalog = classify(rows, release);
    const ledger = (await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count::integer AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = $1
       ORDER BY started_at
    `, [release.migration])).rows;
    const applied = successfulMigration(ledger, release);
    if (applied) assert.equal(catalog.posture, "successor", "applied release posture drifted");
    const state = applied
      ? "applied"
      : catalog.posture === "successor"
        ? "applied_unrecorded"
        : "pending";
    if (phase === "postflight") assert.equal(state, "applied", "privilege release is not applied");
    await client.query("COMMIT");
    const evidence = Object.freeze({
      releaseId,
      releaseCommit,
      phase,
      state,
      migration: release.migration,
      migrationSha256: verified.digest,
      databaseName: rows[0]?.database_name,
      migrationRole: rows[0]?.current_user_name,
      catalog,
      productionChanged: false,
      containsRowData: false,
    });
    const previousPath = env.PRIVILEGE_RELEASE_PREVIOUS_EVIDENCE_PATH?.trim();
    if (phase === "postflight") {
      if (!previousPath) throw new Error("previous privilege release evidence is required");
      const previous = JSON.parse(readFileSync(previousPath, "utf8"));
      assert.equal(previous.releaseId, evidence.releaseId, "release evidence drifted");
      assert.equal(previous.releaseCommit, evidence.releaseCommit, "commit evidence drifted");
      assert.equal(previous.migration, evidence.migration, "migration evidence drifted");
      assert.ok(
        previous.state === "pending" || previous.state === "applied_unrecorded" || previous.state === "applied",
        "preflight state is invalid",
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
  inspectPrivilegeReleaseProduction()
    .then((evidence) => process.stdout.write(`${evidence.state}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
