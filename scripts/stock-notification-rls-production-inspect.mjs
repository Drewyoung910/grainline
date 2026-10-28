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
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";
import {
  isReviewedSuccessfulMigration,
} from "./reviewed-manually-applied-migrations.mjs";

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

async function readFunctions(client, verified, tableOwner) {
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
    assert.deepEqual(
      row.configuration,
      ["search_path=pg_catalog"],
      `${identity} search_path drifted`,
    );
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
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
             AS using_expression,
           pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
             AS check_expression
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."StockNotification"'::pg_catalog.regclass
     ORDER BY policy.polname
  `)).rows;
  const expected = new Map(release.policies.map((policy) => [policy.name, policy]));
  assert.equal(rows.length, expected.size, "policy count drifted");
  for (const row of rows) {
    const policy = expected.get(row.name);
    assert.ok(policy, `unexpected policy ${row.name}`);
    assert.equal(row.command, policy.command, `${row.name} command drifted`);
    assert.equal(row.permissive, true, `${row.name} is not permissive`);
    assert.deepEqual(
      row.role_oids.map(Number),
      [Number(runtimeOid)],
      `${row.name} role drifted`,
    );
    assert.equal(
      row.using_expression,
      policy.usingExpression,
      `${row.name} owner expression drifted`,
    );
    assert.equal(row.check_expression, null, `${row.name} has WITH CHECK`);
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

async function readStructure(client) {
  const columns = (await client.query(`
    SELECT attribute.attname AS name,
           pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type,
           NOT attribute.attnotnull AS nullable
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'public."StockNotification"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     ORDER BY attribute.attnum
  `)).rows;
  assert.deepEqual(columns, [
    { name: "id", type: "text", nullable: false },
    { name: "listingId", type: "text", nullable: false },
    { name: "userId", type: "text", nullable: false },
    { name: "createdAt", type: "timestamp(3) without time zone", nullable: false },
  ], "StockNotification columns drifted");

  const indexes = (await client.query(`
    SELECT index_class.relname AS name,
           index_state.indisprimary AS primary,
           index_state.indisunique AS unique,
           index_state.indisvalid AS valid,
           index_state.indisready AS ready,
           index_state.indpred IS NOT NULL AS partial,
           index_state.indexprs IS NOT NULL AS expression,
           index_state.indnatts = index_state.indnkeyatts AS no_includes,
           pg_catalog.array_agg(attribute.attname::text ORDER BY key.ordinality)
             AS columns
      FROM pg_catalog.pg_index AS index_state
      JOIN pg_catalog.pg_class AS index_class
        ON index_class.oid = index_state.indexrelid
      CROSS JOIN LATERAL pg_catalog.unnest(index_state.indkey)
        WITH ORDINALITY AS key(attribute_number, ordinality)
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = index_state.indrelid
       AND attribute.attnum = key.attribute_number
     WHERE index_state.indrelid =
           'public."StockNotification"'::pg_catalog.regclass
     GROUP BY index_class.relname, index_state.indisprimary,
              index_state.indisunique, index_state.indisvalid,
              index_state.indisready, index_state.indpred,
              index_state.indexprs, index_state.indnatts,
              index_state.indnkeyatts
     ORDER BY index_class.relname
  `)).rows;
  assert.deepEqual(indexes, [
    {
      name: "StockNotification_listingId_idx",
      primary: false,
      unique: false,
      valid: true,
      ready: true,
      partial: false,
      expression: false,
      no_includes: true,
      columns: ["listingId"],
    },
    {
      name: "StockNotification_listingId_userId_key",
      primary: false,
      unique: true,
      valid: true,
      ready: true,
      partial: false,
      expression: false,
      no_includes: true,
      columns: ["listingId", "userId"],
    },
    {
      name: "StockNotification_pkey",
      primary: true,
      unique: true,
      valid: true,
      ready: true,
      partial: false,
      expression: false,
      no_includes: true,
      columns: ["id"],
    },
    {
      name: "StockNotification_userId_idx",
      primary: false,
      unique: false,
      valid: true,
      ready: true,
      partial: false,
      expression: false,
      no_includes: true,
      columns: ["userId"],
    },
  ], "StockNotification indexes drifted");

  const foreignKeys = (await client.query(`
    SELECT constraint_state.conname AS name,
           constraint_state.confdeltype AS delete_action,
           constraint_state.confupdtype AS update_action,
           constraint_state.confrelid::pg_catalog.regclass::text AS referenced_table,
           constraint_state.convalidated AS valid,
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
     WHERE constraint_state.conrelid =
           'public."StockNotification"'::pg_catalog.regclass
       AND constraint_state.contype = 'f'
     ORDER BY constraint_state.conname
  `)).rows;
  assert.deepEqual(foreignKeys, [
    {
      name: "StockNotification_listingId_fkey",
      delete_action: "c",
      update_action: "c",
      referenced_table: '"Listing"',
      valid: true,
      columns: ["listingId"],
      referenced_columns: ["id"],
    },
    {
      name: "StockNotification_userId_fkey",
      delete_action: "c",
      update_action: "c",
      referenced_table: '"User"',
      valid: true,
      columns: ["userId"],
      referenced_columns: ["id"],
    },
  ], "StockNotification foreign keys drifted");
  return Object.freeze({ columns, indexes, foreignKeys });
}

export async function inspectStockNotificationRlsActivationProduction(
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
  assert.equal(release.shape, "stock_notification", "release shape drifted");
  const verified = verifyOwnerTableRlsActivationSource(releaseId, rootDir);
  const parsed = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    ...postgresChannelBindingClientOptions(parsed),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    application_name: "grainline-stock-notification-rls-inspect",
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
                FROM pg_catalog.pg_policy AS policy
               WHERE policy.polrelid = target.oid) AS policy_count,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_trigger AS trigger_state
               WHERE trigger_state.tgrelid = target.oid
                 AND NOT trigger_state.tgisinternal) AS trigger_count,
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
               'grainline_app_runtime', target.oid, 'TRUNCATE'
             ) AS runtime_truncate,
             pg_catalog.has_table_privilege(
               'grainline_app_runtime', target.oid, 'REFERENCES'
             ) AS runtime_references,
             pg_catalog.has_table_privilege(
               'grainline_app_runtime', target.oid, 'TRIGGER'
             ) AS runtime_trigger,
             pg_catalog.has_table_privilege(
               'grainline_staff_read_runtime', target.oid, 'SELECT'
             ) AS staff_select,
             pg_catalog.has_table_privilege(0, target.oid, 'SELECT') AS public_select,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.aclexplode(
                  COALESCE(
                    target.relacl,
                    pg_catalog.acldefault('r', target.relowner)
                  )
                ) AS acl
               WHERE acl.grantee NOT IN (target.relowner, runtime.oid)
                  OR (acl.grantee = runtime.oid AND acl.is_grantable))
               AS unexpected_table_acl_count,
             (SELECT pg_catalog.count(*)::integer
                FROM pg_catalog.pg_attribute AS attribute
                CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
               WHERE attribute.attrelid = target.oid
                 AND attribute.attnum > 0
                 AND NOT attribute.attisdropped) AS column_acl_count
        FROM pg_catalog.pg_class AS target
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = target.relnamespace
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = target.relowner
        JOIN pg_catalog.pg_roles AS runtime
          ON runtime.rolname = 'grainline_app_runtime'
       WHERE namespace.nspname = 'public'
         AND target.relname = 'StockNotification'
         AND target.relkind = 'r'
    `)).rows[0];
    assert.ok(row, "StockNotification table or runtime role is absent");
    assert.equal(row.current_user_name, row.session_user_name);
    assert.equal(row.current_user_name, row.table_owner_name);
    assert.equal(row.owner_bypasses_rls, true);
    assert.equal(row.runtime_superuser, false);
    assert.equal(row.runtime_create_database, false);
    assert.equal(row.runtime_create_role, false);
    assert.equal(row.runtime_inherit, false);
    assert.equal(row.runtime_replication, false);
    assert.equal(row.runtime_bypass_rls, false);
    assert.equal(row.runtime_membership_count, 0);
    assert.equal(row.trigger_count, 0);
    assert.equal(row.staff_select, false);
    assert.equal(row.public_select, false);
    assert.equal(row.runtime_truncate, false, "runtime TRUNCATE drifted");
    assert.equal(row.runtime_references, false, "runtime REFERENCES drifted");
    assert.equal(row.runtime_trigger, false, "runtime TRIGGER drifted");
    assert.equal(row.unexpected_table_acl_count, 0, "table ACL drifted");
    assert.equal(row.column_acl_count, 0, "column ACL drifted");

    const ledger = (await client.query(`
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count::integer AS applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = $1
       ORDER BY started_at
    `, [release.migration])).rows;
    const applied = successfulMigration(ledger, release);
    const predecessorPosture = (
      row.rls_enabled === false
      && row.rls_forced === false
      && row.policy_count === 0
      && row.runtime_select === true
      && row.runtime_insert === true
      && row.runtime_update === true
      && row.runtime_delete === true
    );
    const activePosture = (
      row.rls_enabled === true
      && row.rls_forced === true
      && row.policy_count === 2
      && row.runtime_select === true
      && row.runtime_insert === false
      && row.runtime_update === false
      && row.runtime_delete === true
    );
    let state;
    if (applied) {
      assert.equal(activePosture, true, "applied activation posture drifted");
      state = "active";
    } else if (predecessorPosture) {
      state = "ready";
    } else if (activePosture) {
      state = "record";
    } else {
      assert.fail("StockNotification activation posture is partial or unknown");
    }
    if (phase === "postflight") assert.equal(state, "active", "activation is not applied");

    const structure = await readStructure(client);
    const retainedFunctions = await readFunctions(
      client,
      verified,
      row.table_owner_name,
    );
    const policies = state === "active" || state === "record"
      ? await readPolicies(client, release, row.runtime_oid)
      : [];
    const inventory = (await client.query(`
      SELECT pg_catalog.count(*)::integer AS total_rows,
             pg_catalog.count(*) FILTER (
               WHERE subscription."userId" = seller."userId"
             )::integer AS self_subscriptions,
             pg_catalog.count(*) FILTER (
               WHERE account_user.id IS NULL OR listing.id IS NULL
             )::integer AS orphaned_rows
        FROM public."StockNotification" AS subscription
        LEFT JOIN public."User" AS account_user
          ON account_user.id = subscription."userId"
        LEFT JOIN public."Listing" AS listing
          ON listing.id = subscription."listingId"
        LEFT JOIN public."SellerProfile" AS seller
          ON seller.id = listing."sellerId"
    `)).rows[0];
    assert.equal(inventory.orphaned_rows, 0, "StockNotification has orphaned rows");
    await client.query("COMMIT");

    const evidence = Object.freeze({
      releaseId,
      releaseCommit,
      phase,
      state,
      migration: release.migration,
      migrationSha256: release.migrationSha256,
      databaseName: row.database_name,
      migrationRole: row.current_user_name,
      table: release.table,
      posture: Object.freeze({
        rlsEnabled: row.rls_enabled,
        rlsForced: row.rls_forced,
        policyCount: row.policy_count,
        runtimeSelect: row.runtime_select,
        runtimeInsert: row.runtime_insert,
        runtimeUpdate: row.runtime_update,
        runtimeDelete: row.runtime_delete,
      }),
      structure,
      policies,
      retainedFunctions,
      inventory,
      productionChanged: false,
      containsRowData: false,
    });
    const previousPath = env.OWNER_TABLE_RLS_PREVIOUS_EVIDENCE_PATH?.trim();
    if (phase === "postflight") {
      if (!previousPath) throw new Error("previous owner-table evidence is required");
      const previous = JSON.parse(readFileSync(previousPath, "utf8"));
      assert.equal(previous.releaseId, evidence.releaseId, "release evidence drifted");
      assert.equal(previous.releaseCommit, evidence.releaseCommit, "commit evidence drifted");
      assert.equal(previous.migration, evidence.migration, "migration evidence drifted");
      assert.deepEqual(previous.structure, evidence.structure, "table structure drifted");
      assert.deepEqual(
        previous.retainedFunctions,
        evidence.retainedFunctions,
        "retained functions drifted",
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
  inspectStockNotificationRlsActivationProduction()
    .then((evidence) => process.stdout.write(`${evidence.state}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
