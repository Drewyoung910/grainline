import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

import {
  ownerTableRlsActivation,
  verifyOwnerTableRlsActivationSource,
} from "./owner-table-rls-activation-catalog.mjs";
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

async function readFunctions(client, entries, tableOwner) {
  const expected = new Map(entries.map((entry) => [
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
  `, [entries.map((entry) => entry.name)])).rows;
  assert.equal(rows.length, expected.size, "reviewed function count drifted");
  for (const row of rows) {
    const identity = `${row.function_name}(${row.identity_arguments})`;
    assert.ok(expected.has(identity), `unexpected reviewed function ${identity}`);
    assert.equal(row.owner_name, tableOwner, `${identity} owner drifted`);
    assert.equal(row.owner_bypasses_rls, true, `${identity} owner cannot bypass RLS`);
    assert.equal(row.security_definer, true, `${identity} is not SECURITY DEFINER`);
    assert.deepEqual(row.configuration, ["search_path=pg_catalog"], `${identity} search_path drifted`);
    assert.equal(
      row.runtime_execute,
      expected.get(identity).runtimeExecute ?? true,
      `${identity} runtime EXECUTE drifted`,
    );
    assert.equal(row.public_execute, false, `${identity} PUBLIC EXECUTE is present`);
    expected.delete(identity);
  }
  assert.equal(expected.size, 0, "reviewed function is absent");
  return rows;
}

async function readPolicies(client, release, runtimeOid) {
  const rows = (await client.query(`
    SELECT target.relname AS table_name,
           policy.polname AS name,
           policy.polcmd AS command,
           policy.polpermissive AS permissive,
           policy.polroles AS role_oids,
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid, true) AS using_expression,
           pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid, true) AS check_expression
      FROM pg_catalog.pg_policy AS policy
      JOIN pg_catalog.pg_class AS target ON target.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = target.relnamespace
     WHERE namespace.nspname = 'public'
       AND target.relname = ANY($1::text[])
     ORDER BY target.relname, policy.polname
  `, [release.tables])).rows;
  const expected = new Map(release.policies.map((policy) => [
    `${policy.table}.${policy.name}`,
    policy,
  ]));
  assert.equal(rows.length, expected.size, "Cart policy count drifted");
  for (const row of rows) {
    const identity = `${row.table_name}.${row.name}`;
    const policy = expected.get(identity);
    assert.ok(policy, `unexpected Cart policy ${identity}`);
    assert.equal(row.command, policy.command, `${identity} command drifted`);
    assert.equal(row.permissive, true, `${identity} is not permissive`);
    assert.deepEqual(row.role_oids.map(Number), [Number(runtimeOid)], `${identity} role drifted`);
    const expressions = [row.using_expression, row.check_expression].filter(Boolean);
    assert.ok(expressions.length > 0, `${identity} has no owner expression`);
    for (const expression of expressions) {
      assert.match(expression, /current_setting\('app\.user_id'/u, `${identity} lost user context`);
      if (policy.table === "Cart") {
        assert.match(expression, /"userId"\s*=\s*NULLIF/u, `${identity} lost direct ownership`);
      } else {
        assert.match(expression, /EXISTS/u, `${identity} lost parent ownership`);
        assert.match(expression, /"Cart"/u, `${identity} lost Cart parent boundary`);
      }
    }
    if (row.command === "a") {
      assert.equal(row.using_expression, null, `${identity} has unexpected USING`);
      assert.ok(row.check_expression, `${identity} lacks WITH CHECK`);
    } else if (row.command === "w") {
      assert.ok(row.using_expression, `${identity} lacks USING`);
      assert.ok(row.check_expression, `${identity} lacks WITH CHECK`);
    } else {
      assert.ok(row.using_expression, `${identity} lacks USING`);
      assert.equal(row.check_expression, null, `${identity} has unexpected WITH CHECK`);
    }
    expected.delete(identity);
  }
  assert.equal(expected.size, 0, "reviewed Cart policy is absent");
  return rows.map((row) => Object.freeze({
    table: row.table_name,
    name: row.name,
    command: row.command,
    permissive: row.permissive,
    roleOids: row.role_oids.map(Number),
    usingExpression: row.using_expression,
    checkExpression: row.check_expression,
  }));
}

export async function inspectCartCartItemRlsActivationProduction(
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
  assert.equal(release.shape, "cart_cart_item", "release is not the Cart group");
  const verified = verifyOwnerTableRlsActivationSource(releaseId, rootDir);
  const parsed = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    ...postgresChannelBindingClientOptions(parsed),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 25_000,
    application_name: "grainline-cart-cartitem-rls-inspect",
  });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const rows = (await client.query(`
      SELECT target.relname AS table_name,
             pg_catalog.current_database() AS database_name,
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
                  OR (acl.grantee = runtime.oid AND acl.is_grantable)) AS unexpected_table_acl_count
        FROM pg_catalog.pg_class AS target
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = target.relnamespace
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = target.relowner
        JOIN pg_catalog.pg_roles AS runtime ON runtime.rolname = 'grainline_app_runtime'
       WHERE namespace.nspname = 'public'
         AND target.relname = ANY($1::text[])
         AND target.relkind = 'r'
       ORDER BY target.relname
    `, [release.tables])).rows;
    assert.equal(rows.length, 2, "Cart tables are absent");
    const [first, second] = rows;
    assert.equal(first.table_owner_oid, second.table_owner_oid, "Cart table owners differ");
    assert.equal(first.table_owner_name, second.table_owner_name, "Cart owners differ");
    assert.equal(first.current_user_name, first.session_user_name, "owner session is indirect");
    assert.equal(first.current_user_name, first.table_owner_name, "session is not Cart owner");
    assert.equal(first.owner_bypasses_rls, true, "Cart owner cannot bypass RLS");
    for (const row of rows) {
      assert.equal(row.runtime_superuser, false, "runtime role is SUPERUSER");
      assert.equal(row.runtime_create_database, false, "runtime role can create databases");
      assert.equal(row.runtime_create_role, false, "runtime role can create roles");
      assert.equal(row.runtime_inherit, false, "runtime role inherits memberships");
      assert.equal(row.runtime_replication, false, "runtime role can replicate");
      assert.equal(row.runtime_bypass_rls, false, "runtime role bypasses RLS");
      assert.equal(row.runtime_membership_count, 0, "runtime role has memberships");
      assert.equal(row.noninternal_trigger_count, 0, `${row.table_name} has an unreviewed trigger`);
      assert.equal(row.staff_select, false, `${row.table_name} staff SELECT drifted`);
      assert.equal(row.public_select, false, `${row.table_name} PUBLIC SELECT drifted`);
      assert.equal(row.runtime_truncate, false, `${row.table_name} runtime TRUNCATE drifted`);
      assert.equal(row.runtime_references, false, `${row.table_name} runtime REFERENCES drifted`);
      assert.equal(row.runtime_trigger, false, `${row.table_name} runtime TRIGGER drifted`);
      assert.equal(row.unexpected_table_acl_count, 0, `${row.table_name} table ACL drifted`);
    }

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

    const columnPrivileges = (await client.query(`
      SELECT target.relname AS table_name,
             attribute.attname AS column_name,
             acl.privilege_type::text AS privilege_type,
             acl.is_grantable
        FROM pg_catalog.pg_class AS target
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = target.relnamespace
        JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = target.oid
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
       WHERE namespace.nspname = 'public'
         AND target.relname = ANY($1::text[])
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND acl.grantee = $2::oid
       ORDER BY target.relname, attribute.attname, acl.privilege_type
    `, [release.tables, first.runtime_oid])).rows;
    const constraints = (await client.query(`
      SELECT constraint_state.conname AS name,
             constraint_state.convalidated AS validated,
             pg_catalog.pg_get_constraintdef(constraint_state.oid, true) AS definition
        FROM pg_catalog.pg_constraint AS constraint_state
       WHERE constraint_state.conrelid = 'public."CartItem"'::pg_catalog.regclass
         AND constraint_state.conname = ANY($1::text[])
       ORDER BY constraint_state.conname
    `, [[
      "CartItem_priceCents_bounds_check",
      "CartItem_priceVersion_positive_check",
      "CartItem_quantity_bounds_check",
      "CartItem_selectedVariantOptionIds_bounds_check",
    ]])).rows;

    let policies = [];
    let serviceFunctions = [];
    if (active) {
      for (const row of rows) {
        assert.equal(row.rls_enabled, true, `${row.table_name} RLS is not enabled`);
        assert.equal(row.rls_forced, true, `${row.table_name} RLS is not forced`);
        assert.equal(row.runtime_select, true, `${row.table_name} runtime SELECT is absent`);
        assert.equal(row.runtime_insert, true, `${row.table_name} runtime INSERT is absent`);
        assert.equal(row.runtime_update, false, `${row.table_name} has whole-table UPDATE`);
        assert.equal(row.runtime_delete, true, `${row.table_name} runtime DELETE is absent`);
      }
      assert.deepEqual(columnPrivileges, [
        { table_name: "Cart", column_name: "updatedAt", privilege_type: "UPDATE", is_grantable: false },
        { table_name: "CartItem", column_name: "priceCents", privilege_type: "UPDATE", is_grantable: false },
        { table_name: "CartItem", column_name: "priceVersion", privilege_type: "UPDATE", is_grantable: false },
        { table_name: "CartItem", column_name: "quantity", privilege_type: "UPDATE", is_grantable: false },
        { table_name: "CartItem", column_name: "selectedVariantOptionIds", privilege_type: "UPDATE", is_grantable: false },
      ], "Cart column UPDATE grants drifted");
      assert.deepEqual(
        constraints.map((constraint) => [constraint.name, constraint.validated]),
        [
          ["CartItem_priceCents_bounds_check", true],
          ["CartItem_priceVersion_positive_check", true],
          ["CartItem_quantity_bounds_check", true],
          ["CartItem_selectedVariantOptionIds_bounds_check", true],
        ],
        "CartItem constraint set drifted",
      );
      assert.match(constraints[0].definition, /"priceCents"\s*>=\s*1[\s\S]*"priceCents"\s*<=\s*10000000/u);
      assert.match(constraints[1].definition, /"priceVersion"\s*>=\s*1/u);
      assert.match(constraints[2].definition, /quantity\s*>=\s*1[\s\S]*quantity\s*<=\s*99/u);
      assert.match(constraints[3].definition, /cardinality\("selectedVariantOptionIds"\)\s*<=\s*30/u);
      assert.match(constraints[3].definition, /array_position\("selectedVariantOptionIds",\s*NULL::text\)\s+IS\s+NULL/u);
      policies = await readPolicies(client, release, first.runtime_oid);
      serviceFunctions = await readFunctions(client, release.serviceFunctions, first.table_owner_name);
      for (const row of serviceFunctions) {
        assert.equal(
          row.source,
          verified.serviceFunctionSources.get(row.function_name),
          `${row.function_name} body drifted`,
        );
      }
    } else {
      for (const row of rows) {
        assert.equal(row.rls_enabled, false, `${row.table_name} RLS is already enabled`);
        assert.equal(row.rls_forced, false, `${row.table_name} RLS is already forced`);
        assert.equal(row.runtime_select, true, `${row.table_name} predecessor SELECT drifted`);
        assert.equal(row.runtime_insert, true, `${row.table_name} predecessor INSERT drifted`);
        assert.equal(row.runtime_update, true, `${row.table_name} predecessor UPDATE drifted`);
        assert.equal(row.runtime_delete, true, `${row.table_name} predecessor DELETE drifted`);
      }
      assert.deepEqual(columnPrivileges, [], "Cart predecessor has column grants");
      assert.deepEqual(constraints, [], "Cart predecessor has activation constraints");
      assert.equal(
        (await client.query(`
          SELECT pg_catalog.count(*)::integer AS count
            FROM pg_catalog.pg_policy AS policy
            JOIN pg_catalog.pg_class AS target ON target.oid = policy.polrelid
           WHERE target.relname = ANY($1::text[])
        `, [release.tables])).rows[0].count,
        0,
        "Cart predecessor has policies",
      );
      assert.equal(
        (await client.query(`
          SELECT pg_catalog.count(*)::integer AS count
            FROM pg_catalog.pg_proc AS procedure
            JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
           WHERE namespace.nspname = 'public'
             AND procedure.proname = ANY($1::text[])
        `, [release.serviceFunctions.map((entry) => entry.name)])).rows[0].count,
        0,
        "Cart predecessor has activation service functions",
      );
    }

    const retainedRows = await readFunctions(client, release.retainedFunctions, first.table_owner_name);
    const inventory = (await client.query(`
      SELECT (SELECT pg_catalog.count(*)::integer FROM public."Cart") AS cart_count,
             (SELECT pg_catalog.count(*)::integer FROM public."CartItem") AS item_count,
             (SELECT pg_catalog.count(*)::integer
                FROM public."Cart" AS cart
                LEFT JOIN public."User" AS account ON account.id = cart."userId"
               WHERE account.id IS NULL) AS orphan_users,
             (SELECT pg_catalog.count(*)::integer
                FROM public."CartItem" AS item
                LEFT JOIN public."Cart" AS cart ON cart.id = item."cartId"
                LEFT JOIN public."Listing" AS listing ON listing.id = item."listingId"
               WHERE cart.id IS NULL OR listing.id IS NULL) AS orphan_items,
             (SELECT pg_catalog.count(*)::integer
                FROM public."CartItem" AS item
               WHERE item.quantity < 1 OR item.quantity > 99
                  OR item."priceCents" < 1 OR item."priceCents" > 10000000
                  OR item."priceVersion" < 1
                  OR pg_catalog.cardinality(item."selectedVariantOptionIds") > 30
                  OR pg_catalog.array_position(item."selectedVariantOptionIds", NULL) IS NOT NULL
                  OR pg_catalog.char_length(item."variantKey") > 255) AS invalid_items
    `)).rows[0];
    assert.equal(inventory.orphan_users, 0, "Cart has orphan users");
    assert.equal(inventory.orphan_items, 0, "CartItem has orphan parents");
    assert.equal(inventory.invalid_items, 0, "CartItem has values outside reviewed bounds");
    await client.query("COMMIT");

    const evidence = Object.freeze({
      releaseId,
      releaseCommit,
      phase,
      state,
      tables: release.tables,
      migration: release.migration,
      migrationSha256: verified.digest,
      databaseName: first.database_name,
      migrationRole: first.current_user_name,
      posture: rows.map((row) => Object.freeze({
        table: row.table_name,
        rlsEnabled: row.rls_enabled,
        rlsForced: row.rls_forced,
        runtimePrivileges: Object.freeze({
          select: row.runtime_select,
          insert: row.runtime_insert,
          update: row.runtime_update,
          delete: row.runtime_delete,
        }),
      })),
      columnPrivileges,
      constraints,
      policies,
      serviceFunctions: serviceFunctions.map(functionEvidence),
      retainedFunctions: retainedRows.map(functionEvidence),
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
      assert.deepEqual(
        previous.retainedFunctions,
        evidence.retainedFunctions,
        "retained Cart function boundary changed during activation",
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
