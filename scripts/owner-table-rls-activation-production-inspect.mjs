#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ownerTableRlsActivation,
  verifyOwnerTableRlsActivationSource,
} from "./owner-table-rls-activation-catalog.mjs";
import {
  inspectCartCartItemRlsActivationProduction,
} from "./cart-cartitem-rls-production-inspect.mjs";
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
      assert.notEqual(row.rolled_back_at, null, "migration has an unresolved attempt");
    }
  }
  return successes.length === 1;
}

function functionEvidence(row) {
  return Object.freeze({
    name: row.function_name,
    arguments: row.identity_arguments,
    owner: row.owner_name,
    securityDefiner: row.security_definer,
    configuration: row.configuration,
    runtimeExecute: row.runtime_execute,
    publicExecute: row.public_execute,
    sourceSha256: createHash("sha256").update(row.source, "utf8").digest("hex"),
  });
}

async function readRetainedFunctions(client, verified, tableOwner) {
  const expected = new Map(verified.release.retainedFunctions.map((entry) => [
    `${entry.name}(${entry.arguments})`,
    entry,
  ]));
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
           pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
             AS public_execute
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
     WHERE namespace.nspname = 'public'
       AND procedure.proname = ANY($1::text[])
     ORDER BY procedure.proname, identity_arguments
  `, [verified.release.retainedFunctions.map((entry) => entry.name)])).rows;
  assert.equal(rows.length, expected.size, "retained function count drifted");
  for (const row of rows) {
    const identity = `${row.function_name}(${row.identity_arguments})`;
    assert.ok(expected.has(identity), `unexpected retained function ${identity}`);
    assert.equal(row.owner_name, tableOwner, `${identity} owner drifted`);
    assert.equal(row.owner_bypasses_rls, true, `${identity} owner cannot bypass RLS`);
    assert.equal(row.security_definer, true, `${identity} is not SECURITY DEFINER`);
    assert.deepEqual(row.configuration, ["search_path=pg_catalog"], `${identity} search_path drifted`);
    assert.equal(row.runtime_execute, true, `${identity} runtime EXECUTE is absent`);
    assert.equal(row.public_execute, false, `${identity} PUBLIC EXECUTE is present`);
    assert.equal(
      row.source,
      verified.retainedFunctionSources.get(row.function_name),
      `${identity} body drifted`,
    );
    expected.delete(identity);
  }
  assert.equal(expected.size, 0, "reviewed retained function is absent");
  return rows.map(functionEvidence);
}

async function readPolicies(client, release, runtimeOid) {
  const rows = (await client.query(`
    SELECT policy.polname AS name,
           policy.polcmd AS command,
           policy.polpermissive AS permissive,
           policy.polroles AS role_oids,
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid, true) AS using_expression,
           pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid, true) AS check_expression
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = $1::pg_catalog.regclass
     ORDER BY policy.polname
  `, [`public."${release.table}"`])).rows;
  const expected = new Map(release.policies.map((policy) => [policy.name, policy]));
  assert.equal(rows.length, expected.size, "policy count drifted");
  for (const row of rows) {
    const policy = expected.get(row.name);
    assert.ok(policy, `unexpected policy ${row.name}`);
    assert.equal(row.command, policy.command, `${row.name} command drifted`);
    assert.equal(row.permissive, true, `${row.name} is not permissive`);
    assert.deepEqual(row.role_oids.map(Number), [Number(runtimeOid)], `${row.name} role drifted`);
    if (row.command === "a") {
      assert.equal(row.using_expression, null, `${row.name} has an unexpected USING expression`);
      assert.match(row.check_expression ?? "", /"userId"\s*=\s*NULLIF\(current_setting\('app\.user_id'/u);
    } else {
      assert.match(row.using_expression ?? "", /"userId"\s*=\s*NULLIF\(current_setting\('app\.user_id'/u);
      assert.equal(row.check_expression, null, `${row.name} has an unexpected WITH CHECK expression`);
    }
    expected.delete(row.name);
  }
  assert.equal(expected.size, 0, "reviewed policy is absent");
  return rows.map((row) => Object.freeze({
    name: row.name,
    command: row.command,
    permissive: row.permissive,
    roleOids: row.role_oids.map(Number),
    usingExpression: row.using_expression,
    checkExpression: row.check_expression,
  }));
}

async function readGuard(client, verified, tableOwner) {
  const rows = (await client.query(`
    SELECT procedure.proname AS function_name,
           pg_catalog.oidvectortypes(procedure.proargtypes)::text AS identity_arguments,
           owner.rolname AS owner_name,
           owner.rolsuper OR owner.rolbypassrls AS owner_bypasses_rls,
           procedure.prosecdef AS security_definer,
           procedure.provolatile AS volatility,
           procedure.proparallel AS parallel_safety,
           procedure.proconfig AS configuration,
           procedure.prosrc AS source,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', procedure.oid, 'EXECUTE'
           ) AS runtime_execute,
           pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
             AS public_execute,
           trigger_state.tgname AS trigger_name,
           trigger_state.tgenabled AS trigger_enabled,
           trigger_state.tgisinternal AS trigger_internal
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
      JOIN pg_catalog.pg_trigger AS trigger_state
        ON trigger_state.tgfoid = procedure.oid
       AND trigger_state.tgrelid = $1::pg_catalog.regclass
     WHERE namespace.nspname = 'public'
       AND procedure.proname = $2
  `, [`public."${verified.release.table}"`, verified.release.guardFunction])).rows;
  assert.equal(rows.length, 1, "insert guard function or trigger drifted");
  const row = rows[0];
  assert.equal(row.identity_arguments, "", "insert guard overload drifted");
  assert.equal(row.owner_name, tableOwner, "insert guard owner drifted");
  assert.equal(row.owner_bypasses_rls, true, "insert guard owner cannot bypass RLS");
  assert.equal(row.security_definer, true, "insert guard is not SECURITY DEFINER");
  assert.equal(row.volatility, "v", "insert guard volatility drifted");
  assert.equal(row.parallel_safety, "u", "insert guard parallel safety drifted");
  assert.deepEqual(row.configuration, ["search_path=pg_catalog"], "insert guard search_path drifted");
  assert.equal(row.runtime_execute, false, "runtime has direct insert-guard EXECUTE");
  assert.equal(row.public_execute, false, "PUBLIC has insert-guard EXECUTE");
  assert.equal(row.trigger_name, verified.release.trigger, "insert guard trigger name drifted");
  assert.equal(row.trigger_enabled, "O", "insert guard trigger is not enabled normally");
  assert.equal(row.trigger_internal, false, "insert guard trigger became internal");
  assert.equal(
    row.source,
    verified.guardFunctionSource,
    "insert guard function body drifted",
  );
  return Object.freeze({
    ...functionEvidence(row),
    triggerName: row.trigger_name,
    triggerEnabled: row.trigger_enabled,
  });
}

async function readTableStructure(client, release) {
  const columns = (await client.query(`
    SELECT attribute.attname AS name,
           pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type,
           NOT attribute.attnotnull AS nullable
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = $1::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     ORDER BY attribute.attnum
  `, [`public."${release.table}"`])).rows;
  assert.deepEqual(columns, [
    { name: "id", type: "text", nullable: false },
    { name: "userId", type: "text", nullable: false },
    { name: "blogPostId", type: "text", nullable: false },
    { name: "createdAt", type: "timestamp(3) without time zone", nullable: false },
  ], "SavedBlogPost columns drifted");

  const indexes = (await client.query(`
    SELECT index_class.relname AS name,
           index_state.indisprimary AS primary,
           index_state.indisunique AS unique,
           index_state.indisvalid AS valid,
           index_state.indpred IS NOT NULL AS partial,
           index_state.indexprs IS NOT NULL AS expression,
           pg_catalog.array_agg(attribute.attname::text ORDER BY key.ordinality) AS columns
      FROM pg_catalog.pg_index AS index_state
      JOIN pg_catalog.pg_class AS index_class
        ON index_class.oid = index_state.indexrelid
      CROSS JOIN LATERAL pg_catalog.unnest(index_state.indkey)
        WITH ORDINALITY AS key(attribute_number, ordinality)
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = index_state.indrelid
       AND attribute.attnum = key.attribute_number
     WHERE index_state.indrelid = $1::pg_catalog.regclass
     GROUP BY index_class.relname, index_state.indisprimary,
              index_state.indisunique, index_state.indisvalid,
              index_state.indpred, index_state.indexprs
     ORDER BY index_class.relname
  `, [`public."${release.table}"`])).rows;
  assert.deepEqual(indexes, [
    { name: "SavedBlogPost_blogPostId_idx", primary: false, unique: false, valid: true, partial: false, expression: false, columns: ["blogPostId"] },
    { name: "SavedBlogPost_pkey", primary: true, unique: true, valid: true, partial: false, expression: false, columns: ["id"] },
    { name: "SavedBlogPost_userId_blogPostId_key", primary: false, unique: true, valid: true, partial: false, expression: false, columns: ["userId", "blogPostId"] },
    { name: "SavedBlogPost_userId_idx", primary: false, unique: false, valid: true, partial: false, expression: false, columns: ["userId"] },
  ], "SavedBlogPost indexes drifted");

  const foreignKeys = (await client.query(`
    SELECT constraint_state.conname AS name,
           constraint_state.confdeltype AS delete_action,
           constraint_state.confupdtype AS update_action,
           constraint_state.confrelid::pg_catalog.regclass::text AS referenced_table,
           ARRAY(
             SELECT attribute.attname::text
               FROM pg_catalog.unnest(constraint_state.conkey)
                 WITH ORDINALITY AS key(attribute_number, ordinality)
               JOIN pg_catalog.pg_attribute AS attribute
                 ON attribute.attrelid = constraint_state.conrelid
                AND attribute.attnum = key.attribute_number
              ORDER BY key.ordinality
           ) AS columns,
           ARRAY(
             SELECT attribute.attname::text
               FROM pg_catalog.unnest(constraint_state.confkey)
                 WITH ORDINALITY AS key(attribute_number, ordinality)
               JOIN pg_catalog.pg_attribute AS attribute
                 ON attribute.attrelid = constraint_state.confrelid
                AND attribute.attnum = key.attribute_number
              ORDER BY key.ordinality
           ) AS referenced_columns
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = $1::pg_catalog.regclass
       AND constraint_state.contype = 'f'
     ORDER BY constraint_state.conname
  `, [`public."${release.table}"`])).rows;
  assert.deepEqual(foreignKeys, [
    {
      name: "SavedBlogPost_blogPostId_fkey",
      delete_action: "c",
      update_action: "c",
      referenced_table: '"BlogPost"',
      columns: ["blogPostId"],
      referenced_columns: ["id"],
    },
    {
      name: "SavedBlogPost_userId_fkey",
      delete_action: "c",
      update_action: "c",
      referenced_table: '"User"',
      columns: ["userId"],
      referenced_columns: ["id"],
    },
  ], "SavedBlogPost foreign keys drifted");
  return Object.freeze({ columns, indexes, foreignKeys });
}

export async function inspectOwnerTableRlsActivationProduction(
  env = process.env,
  { Client = pg.Client, rootDir = process.cwd() } = {},
) {
  const directUrl = required(env, "DIRECT_URL");
  const releaseId = required(env, "OWNER_TABLE_RLS_RELEASE_ID");
  const phase = required(env, "OWNER_TABLE_RLS_PHASE");
  const evidencePath = required(env, "OWNER_TABLE_RLS_EVIDENCE_PATH");
  const releaseCommit = required(env, "PRODUCTION_MIGRATION_RELEASE_COMMIT");
  if (!PHASES.has(phase)) throw new Error("owner-table RLS phase is invalid");
  if (!COMMIT.test(releaseCommit)) throw new Error("release commit is invalid");

  const release = ownerTableRlsActivation(releaseId);
  if (release.shape === "cart_cart_item") {
    return inspectCartCartItemRlsActivationProduction(env, { Client, rootDir });
  }
  const verified = verifyOwnerTableRlsActivationSource(releaseId, rootDir);
  const parsed = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    ...postgresChannelBindingClientOptions(parsed),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    application_name: "grainline-owner-table-rls-inspect",
  });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const row = (await client.query(`
      SELECT pg_catalog.current_database() AS database_name,
             current_user AS current_user_name,
             session_user AS session_user_name,
             target.relowner AS table_owner_oid,
             owner.rolname AS table_owner_name,
             owner.rolsuper OR owner.rolbypassrls AS owner_bypasses_rls,
             runtime.oid AS runtime_oid,
             runtime.rolsuper AS runtime_superuser,
             runtime.rolcreatedb AS runtime_create_database,
             runtime.rolcreaterole AS runtime_create_role,
             runtime.rolinherit AS runtime_inherit,
             runtime.rolreplication AS runtime_replication,
             runtime.rolbypassrls AS runtime_bypass_rls,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_auth_members AS membership
               WHERE membership.member = runtime.oid) AS runtime_membership_count,
             target.relrowsecurity AS rls_enabled,
             target.relforcerowsecurity AS rls_forced,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_trigger AS trigger_state
               WHERE trigger_state.tgrelid = target.oid
                 AND NOT trigger_state.tgisinternal) AS noninternal_trigger_count,
             pg_catalog.has_table_privilege('grainline_app_runtime', target.oid, 'SELECT') AS runtime_select,
             pg_catalog.has_table_privilege('grainline_app_runtime', target.oid, 'INSERT') AS runtime_insert,
             pg_catalog.has_table_privilege('grainline_app_runtime', target.oid, 'UPDATE') AS runtime_update,
             pg_catalog.has_table_privilege('grainline_app_runtime', target.oid, 'DELETE') AS runtime_delete,
             pg_catalog.has_table_privilege('grainline_app_runtime', target.oid, 'TRUNCATE') AS runtime_truncate,
             pg_catalog.has_table_privilege('grainline_app_runtime', target.oid, 'REFERENCES') AS runtime_references,
             pg_catalog.has_table_privilege('grainline_app_runtime', target.oid, 'TRIGGER') AS runtime_trigger,
             pg_catalog.has_table_privilege('grainline_staff_read_runtime', target.oid, 'SELECT') AS staff_select,
             pg_catalog.has_table_privilege(0, target.oid, 'SELECT') AS public_select,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.aclexplode(
                  COALESCE(target.relacl, pg_catalog.acldefault('r', target.relowner))
                ) AS acl
               WHERE acl.grantee NOT IN (target.relowner, runtime.oid)
                  OR (acl.grantee = runtime.oid AND acl.is_grantable)) AS unexpected_table_acl_count,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_attribute AS attribute
                CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
               WHERE attribute.attrelid = target.oid
                 AND attribute.attnum > 0
                 AND NOT attribute.attisdropped) AS column_acl_count
        FROM pg_catalog.pg_class AS target
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = target.relowner
        JOIN pg_catalog.pg_roles AS runtime ON runtime.rolname = 'grainline_app_runtime'
       WHERE target.oid = $1::pg_catalog.regclass
         AND target.relkind = 'r'
    `, [`public."${release.table}"`])).rows[0];
    assert.ok(row, "reviewed table is absent");
    assert.equal(row.current_user_name, row.session_user_name, "owner session is indirect");
    assert.equal(row.current_user_name, row.table_owner_name, "session is not table owner");
    assert.equal(row.owner_bypasses_rls, true, "table owner cannot bypass RLS");
    assert.equal(row.runtime_superuser, false, "runtime role is SUPERUSER");
    assert.equal(row.runtime_create_database, false, "runtime role can create databases");
    assert.equal(row.runtime_create_role, false, "runtime role can create roles");
    assert.equal(row.runtime_inherit, false, "runtime role inherits memberships");
    assert.equal(row.runtime_replication, false, "runtime role can replicate");
    assert.equal(row.runtime_bypass_rls, false, "runtime role bypasses RLS");
    assert.equal(row.runtime_membership_count, 0, "runtime role has memberships");

    const ledgerRows = (await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count::integer AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = $1
       ORDER BY started_at
    `, [release.migration])).rows;
    const active = successfulMigration(ledgerRows, release);
    const state = active ? "active" : "ready";
    if (phase === "postflight") assert.equal(state, "active", "activation is not applied");

    const predecessorPrivileges = Object.freeze({
      select: row.runtime_select,
      insert: row.runtime_insert,
      update: row.runtime_update,
      delete: row.runtime_delete,
    });
    assert.equal(row.staff_select, false, "staff direct SELECT drifted");
    assert.equal(row.public_select, false, "PUBLIC direct SELECT drifted");
    assert.equal(row.runtime_truncate, false, "runtime TRUNCATE drifted");
    assert.equal(row.runtime_references, false, "runtime REFERENCES drifted");
    assert.equal(row.runtime_trigger, false, "runtime TRIGGER drifted");
    assert.equal(row.unexpected_table_acl_count, 0, "table ACL drifted");
    assert.equal(row.column_acl_count, 0, "column ACL drifted");

    let policies = [];
    let guard = null;
    if (active) {
      assert.equal(row.rls_enabled, true, "RLS is not enabled");
      assert.equal(row.rls_forced, true, "RLS is not forced");
      assert.equal(row.noninternal_trigger_count, 1, "active trigger count drifted");
      assert.deepEqual(
        predecessorPrivileges,
        { select: true, insert: true, update: false, delete: true },
        "active runtime grants drifted",
      );
      policies = await readPolicies(client, release, row.runtime_oid);
      guard = await readGuard(client, verified, row.table_owner_name);
    } else {
      assert.equal(row.rls_enabled, false, "predecessor RLS is already enabled");
      assert.equal(row.rls_forced, false, "predecessor RLS is already forced");
      assert.equal(row.noninternal_trigger_count, 0, "predecessor has an unreviewed trigger");
      assert.equal(
        (await client.query(`
          SELECT pg_catalog.count(*)::integer AS count
            FROM pg_catalog.pg_policy
           WHERE polrelid = $1::pg_catalog.regclass
        `, [`public."${release.table}"`])).rows[0].count,
        0,
        "predecessor has policies",
      );
      assert.deepEqual(
        predecessorPrivileges,
        { select: true, insert: true, update: row.runtime_update, delete: true },
        "predecessor runtime grants drifted",
      );
      assert.equal(
        (await client.query(`
          SELECT pg_catalog.count(*)::integer AS count
            FROM pg_catalog.pg_proc AS procedure
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = procedure.pronamespace
           WHERE namespace.nspname = 'public'
             AND procedure.proname = $1
        `, [release.guardFunction])).rows[0].count,
        0,
        "predecessor has the activation guard",
      );
    }

    const retainedFunctions = await readRetainedFunctions(
      client,
      verified,
      row.table_owner_name,
    );
    const structure = await readTableStructure(client, release);
    const inventory = (await client.query(`
      WITH owner_counts AS (
        SELECT saved."userId", pg_catalog.count(*)::integer AS row_count
          FROM public."SavedBlogPost" AS saved
         GROUP BY saved."userId"
      )
      SELECT pg_catalog.count(*)::integer AS total_rows,
             pg_catalog.count(DISTINCT saved."userId")::integer AS distinct_users,
             COALESCE((SELECT pg_catalog.max(row_count) FROM owner_counts), 0)::integer
               AS max_rows_per_user,
             pg_catalog.count(*) FILTER (
               WHERE account_user.id IS NULL
             )::integer AS orphan_users,
             pg_catalog.count(*) FILTER (
               WHERE post.id IS NULL
             )::integer AS orphan_posts,
             pg_catalog.count(*) FILTER (
               WHERE post.id IS NOT NULL
                 AND (
                   post.status IS DISTINCT FROM 'PUBLISHED'
                   OR post."publishedAt" IS NULL
                   OR post."publishedAt" > (
                     pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
                   )
                   OR NOT COALESCE(post."authorAccountActive", false)
                   OR (
                     post."sellerProfileId" IS NOT NULL
                     AND NOT COALESCE(post."authorSellerPubliclyOrderable", false)
                   )
                 )
             )::integer AS unavailable_target_rows
        FROM public."SavedBlogPost" AS saved
        LEFT JOIN public."User" AS account_user ON account_user.id = saved."userId"
        LEFT JOIN public."BlogPost" AS post ON post.id = saved."blogPostId"
    `)).rows[0];
    assert.equal(inventory.orphan_users, 0, "SavedBlogPost has orphan users");
    assert.equal(inventory.orphan_posts, 0, "SavedBlogPost has orphan posts");
    await client.query("COMMIT");

    const evidence = Object.freeze({
      releaseId,
      releaseCommit,
      phase,
      state,
      table: release.table,
      migration: release.migration,
      migrationSha256: verified.digest,
      databaseName: row.database_name,
      migrationRole: row.current_user_name,
      posture: Object.freeze({
        rlsEnabled: row.rls_enabled,
        rlsForced: row.rls_forced,
        runtimePrivileges: predecessorPrivileges,
        staffSelect: row.staff_select,
        publicSelect: row.public_select,
        unexpectedTableAclCount: row.unexpected_table_acl_count,
        columnAclCount: row.column_acl_count,
      }),
      policies,
      guard,
      retainedFunctions,
      structure,
      inventory,
      productionChanged: false,
      containsRowData: false,
    });
    const previousPath = env.OWNER_TABLE_RLS_PREVIOUS_EVIDENCE_PATH?.trim();
    if (phase === "postflight") {
      if (!previousPath) throw new Error("previous owner-table RLS evidence is required");
      const previous = JSON.parse(readFileSync(previousPath, "utf8"));
      assert.equal(previous.releaseId, evidence.releaseId, "release evidence drifted");
      assert.equal(previous.releaseCommit, evidence.releaseCommit, "commit evidence drifted");
      assert.equal(previous.migration, evidence.migration, "migration evidence drifted");
      assert.equal(previous.state === "ready" || previous.state === "active", true);
      assert.deepEqual(
        previous.retainedFunctions,
        evidence.retainedFunctions,
        "retained function boundary changed during activation",
      );
    }
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    return evidence;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const evidence = await inspectOwnerTableRlsActivationProduction();
  process.stdout.write(`${evidence.state}\n`);
}
