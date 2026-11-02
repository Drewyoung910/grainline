#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

function quoteIdentifier(value) {
  assert.match(value, /^[A-Za-z][A-Za-z0-9_]*$/u, "catalog identifier is unsafe");
  return `"${value}"`;
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
    assert.deepEqual(row.staff_privileges, [], `${row.table_name} staff privileges drifted`);
    assert.deepEqual(row.runtime_grant_options, [], `${row.table_name} grant options drifted`);
    assert.deepEqual(row.staff_grant_options, [], `${row.table_name} staff grant options drifted`);
    assert.deepEqual(row.runtime_column_privileges, [], `${row.table_name} column grants drifted`);
    assert.deepEqual(row.staff_column_privileges, [], `${row.table_name} staff column grants drifted`);
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

function classifyFunctions(rows, release) {
  const expected = Object.keys(release.functions ?? {}).sort();
  assert.deepEqual(
    rows.map((row) => row.signature),
    expected,
    "reviewed function catalog drifted",
  );
  return rows.map((row) => {
    assert.equal(row.exists, true, `${row.signature} is missing`);
    assert.equal(row.security_definer, true, `${row.signature} is not SECURITY DEFINER`);
    assert.deepEqual(
      row.configuration,
      ["search_path=pg_catalog"],
      `${row.signature} search_path drifted`,
    );
    assert.equal(row.owner_bypasses_rls, true, `${row.signature} owner posture drifted`);
    assert.equal(row.public_execute, false, `${row.signature} is executable by PUBLIC`);
    assert.equal(row.runtime_execute, true, `${row.signature} runtime EXECUTE drifted`);
    const sourceSha256 = createHash("sha256").update(row.source).digest("hex");
    assert.equal(
      sourceSha256,
      release.functions[row.signature],
      `${row.signature} source drifted`,
    );
    return Object.freeze({ signature: row.signature, sourceSha256 });
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
                WHERE acl.grantee = staff_role.oid
             ), ARRAY[]::text[]) AS staff_privileges,
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
               SELECT pg_catalog.array_agg(DISTINCT pg_catalog.upper(acl.privilege_type)
                        ORDER BY pg_catalog.upper(acl.privilege_type))
                 FROM pg_catalog.aclexplode(coalesce(
                        target.relacl,
                        pg_catalog.acldefault('r', target.relowner)
                      )) AS acl
                WHERE acl.grantee = staff_role.oid AND acl.is_grantable
             ), ARRAY[]::text[]) AS staff_grant_options,
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
                  AND attribute.attacl IS NOT NULL
                  AND acl.grantee = runtime_role.oid
             ), ARRAY[]::text[]) AS runtime_column_privileges,
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
                  AND attribute.attacl IS NOT NULL
                  AND acl.grantee = staff_role.oid
             ), ARRAY[]::text[]) AS staff_column_privileges
        FROM pg_catalog.pg_class AS target
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = target.relnamespace
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = target.relowner
        CROSS JOIN pg_catalog.pg_roles AS runtime_role
        CROSS JOIN pg_catalog.pg_roles AS staff_role
       WHERE namespace.nspname = 'public'
         AND target.relkind = 'r'
         AND target.relname = ANY($1::text[])
         AND runtime_role.rolname = 'grainline_app_runtime'
         AND staff_role.rolname = 'grainline_staff_read_runtime'
       ORDER BY target.relname
    `, [tableNames])).rows;
    const catalog = classify(rows, release);
    const functionSignatures = Object.keys(release.functions ?? {}).sort();
    const functionRows = functionSignatures.length === 0 ? [] : (await client.query(`
      WITH expected(signature) AS (
        SELECT pg_catalog.unnest($1::text[])
      )
      SELECT expected.signature,
             routine.oid IS NOT NULL AS exists,
             routine.prosrc AS source,
             routine.prosecdef AS security_definer,
             routine.proconfig AS configuration,
             owner.rolsuper OR owner.rolbypassrls AS owner_bypasses_rls,
             EXISTS (
               SELECT 1
                 FROM pg_catalog.aclexplode(coalesce(
                        routine.proacl,
                        pg_catalog.acldefault('f', routine.proowner)
                      )) AS acl
                WHERE acl.grantee = 0
                  AND acl.privilege_type = 'EXECUTE'
             ) AS public_execute,
             pg_catalog.has_function_privilege(runtime_role.oid, routine.oid, 'EXECUTE') AS runtime_execute
        FROM expected
        LEFT JOIN pg_catalog.pg_proc AS routine
          ON routine.oid = pg_catalog.to_regprocedure(expected.signature)
        LEFT JOIN pg_catalog.pg_roles AS owner ON owner.oid = routine.proowner
        CROSS JOIN pg_catalog.pg_roles AS runtime_role
       WHERE runtime_role.rolname = 'grainline_app_runtime'
       ORDER BY expected.signature
    `, [functionSignatures])).rows;
    const functions = classifyFunctions(functionRows, release);
    for (const table of release.emptyTables ?? []) {
      assert.ok(Object.hasOwn(release.tables, table), "empty table is outside release catalog");
      const result = await client.query(
        `SELECT 1 AS present FROM public.${quoteIdentifier(table)} LIMIT 1`,
      );
      assert.equal(result.rows.length, 0, `${table} is not empty`);
    }
    const ledger = (await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count::integer AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = $1
       ORDER BY started_at
    `, [release.migration])).rows;
    const applied = successfulMigration(ledger, release);
    if (release.preparationMigration) {
      const preparationLedger = (await client.query(`
        SELECT migration_name, checksum, finished_at, rolled_back_at,
               applied_steps_count::integer AS applied_steps_count
          FROM public._prisma_migrations
         WHERE migration_name = $1
         ORDER BY started_at
      `, [release.preparationMigration.name])).rows;
      const preparationApplied = successfulMigration(preparationLedger, {
        migration: release.preparationMigration.name,
        migrationSha256: release.preparationMigration.sha256,
      });
      assert.equal(preparationApplied, true, "preparation migration is not applied");
    }
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
      functions,
      emptyTables: release.emptyTables ?? [],
      rollbackSha256: verified.rollbackDigest,
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
