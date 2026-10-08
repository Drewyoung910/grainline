#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;

export const USER_RLS_ENABLE_MIGRATIONS = Object.freeze({
  convergence: Object.freeze({
    name: "20261007160000_converge_user_cross_domain_authorities",
    checksum: "fad2c67b0ed3ed4d762a7a5d7d491ba8cca1ab33dc6f0253d8dff845933c4302",
  }),
  enable: Object.freeze({
    name: "20261008010000_enable_user_rls",
    checksum: "19b274a225e60da129ed3868a0a5e59e13a4dcd1243f58ecf5cc81abbfafaaff",
  }),
});

const EXPECTED_INDEXES = Object.freeze([
  Object.freeze({ index_name: "User_active_email_suppression_key_idx", unique_index: false }),
  Object.freeze({ index_name: "User_banned_deletedAt_idx", unique_index: false }),
  Object.freeze({ index_name: "User_clerkId_key", unique_index: true }),
  Object.freeze({ index_name: "User_deletedAt_idx", unique_index: false }),
  Object.freeze({ index_name: "User_email_key", unique_index: true }),
  Object.freeze({ index_name: "User_pkey", unique_index: true }),
]);

const EXPECTED_TRIGGERS = Object.freeze([
  Object.freeze({
    trigger_name: "grainline_user_public_blog_state_sync",
    function_name: "grainline_user_public_blog_state_sync",
    enabled: "O",
  }),
  Object.freeze({
    trigger_name: "grainline_user_public_review_commission_state_sync",
    function_name: "grainline_user_public_review_commission_state_sync",
    enabled: "O",
  }),
  Object.freeze({
    trigger_name: "grainline_user_public_seller_state_sync",
    function_name: "grainline_user_public_seller_state_sync",
    enabled: "O",
  }),
]);

const EXPECTED_CONSTRAINTS = Object.freeze([
  Object.freeze({ constraint_name: "User_notificationPreferences_shape_chk", constraint_type: "c", validated: true }),
  Object.freeze({ constraint_name: "User_notificationPreferences_size_chk", constraint_type: "c", validated: true }),
  Object.freeze({ constraint_name: "User_pkey", constraint_type: "p", validated: true }),
]);

function exactApplied(row, expected) {
  return row?.migration_name === expected.name
    && row.checksum === expected.checksum
    && row.finished === true
    && row.rolled_back === false
    && row.applied_steps_count === "1";
}

export async function readUserRlsEnableCatalog(client) {
  const identity = await client.query(`
    SELECT CURRENT_USER::text AS current_user,
           SESSION_USER::text AS session_user,
           pg_catalog.current_database()::text AS database_name,
           pg_catalog.current_setting('transaction_read_only') AS read_only,
           pg_catalog.current_setting('transaction_isolation') AS isolation,
           owner_role.rolbypassrls AS owner_bypass_rls,
           runtime_role.rolbypassrls AS runtime_bypass_rls,
           runtime_role.rolsuper AS runtime_superuser,
           runtime_role.rolinherit AS runtime_inherit,
           staff_role.rolbypassrls AS staff_bypass_rls,
           staff_role.rolsuper AS staff_superuser,
           staff_role.rolinherit AS staff_inherit
      FROM pg_catalog.pg_roles AS owner_role
      JOIN pg_catalog.pg_roles AS runtime_role
        ON runtime_role.rolname = 'grainline_app_runtime'
      JOIN pg_catalog.pg_roles AS staff_role
        ON staff_role.rolname = 'grainline_staff_read_runtime'
     WHERE owner_role.rolname = CURRENT_USER
  `);
  const ledger = await client.query(`
    SELECT migration_name,
           checksum,
           finished_at IS NOT NULL AS finished,
           rolled_back_at IS NOT NULL AS rolled_back,
           applied_steps_count::text AS applied_steps_count
      FROM public._prisma_migrations
     WHERE migration_name = ANY($1::text[])
     ORDER BY migration_name, started_at, id
  `, [Object.values(USER_RLS_ENABLE_MIGRATIONS).map(({ name }) => name)]);
  const table = await client.query(`
    SELECT class.relname::text AS table_name,
           pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name,
           class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS policy_count,
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'SELECT') AS runtime_select,
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'INSERT') AS runtime_insert,
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'UPDATE') AS runtime_update,
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'DELETE') AS runtime_delete,
           pg_catalog.has_table_privilege('grainline_staff_read_runtime', class.oid, 'SELECT') AS staff_select,
           pg_catalog.has_table_privilege('grainline_staff_read_runtime', class.oid, 'INSERT') AS staff_insert,
           pg_catalog.has_table_privilege('grainline_staff_read_runtime', class.oid, 'UPDATE') AS staff_update,
           pg_catalog.has_table_privilege('grainline_staff_read_runtime', class.oid, 'DELETE') AS staff_delete,
           ARRAY(
             SELECT pg_catalog.format(
               '%s:%s:%s',
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
               acl.privilege_type,
               CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
             )
               FROM pg_catalog.aclexplode(
                 COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
               ) AS acl
              WHERE acl.grantee <> class.relowner
              ORDER BY 1
           ) AS nonowner_acl,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_attribute AS attribute
              CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
             WHERE attribute.attrelid = class.oid
               AND attribute.attnum > 0
               AND NOT attribute.attisdropped
               AND acl.grantee <> class.relowner) AS nonowner_column_acl_count
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'User'
       AND class.relkind = 'r'
  `);
  const indexes = await client.query(`
    SELECT index_class.relname::text AS index_name,
           index_row.indisunique AS unique_index,
           index_row.indisvalid AS valid,
           index_row.indisready AS ready,
           index_row.indislive AS live
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_row.indexrelid
     WHERE index_row.indrelid = 'public."User"'::pg_catalog.regclass
     ORDER BY index_class.relname
  `);
  const triggers = await client.query(`
    SELECT trigger_row.tgname::text AS trigger_name,
           procedure.proname::text AS function_name,
           trigger_row.tgenabled::text AS enabled
      FROM pg_catalog.pg_trigger AS trigger_row
      JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger_row.tgfoid
     WHERE trigger_row.tgrelid = 'public."User"'::pg_catalog.regclass
       AND NOT trigger_row.tgisinternal
     ORDER BY trigger_row.tgname
  `);
  const constraints = await client.query(`
    SELECT constraint_row.conname::text AS constraint_name,
           constraint_row.contype::text AS constraint_type,
           constraint_row.convalidated AS validated
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public."User"'::pg_catalog.regclass
     ORDER BY constraint_row.conname
  `);
  const readers = await client.query(`
    SELECT pg_catalog.count(*)::integer AS direct_reader_count,
           pg_catalog.count(*) FILTER (WHERE procedure.prosecdef)::integer
             AS security_definer_count
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND pg_catalog.strpos(procedure.prosrc, 'public."User"') > 0
  `);
  const convergence = await client.query(`
    SELECT procedure.proname::text AS function_name,
           procedure.prosecdef AS security_definer,
           pg_catalog.md5(procedure.prosrc) AS source_md5,
           pg_catalog.strpos(procedure.prosrc, 'public."User"') > 0 AS uses_user_table,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', procedure.oid, 'EXECUTE'
           ) AS runtime_execute
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = ANY(ARRAY[
       pg_catalog.to_regprocedure(
         'public.grainline_conversation_inbox(text,boolean,text,timestamp without time zone,text,integer)'
       ),
       pg_catalog.to_regprocedure('public.grainline_case_resolution_claim_immutable()')
     ]::oid[])
     ORDER BY procedure.proname
  `);
  assert.equal(identity.rows.length, 1, "User RLS inspection roles are missing or ambiguous");
  assert.equal(table.rows.length, 1, "User RLS inspection table is missing or ambiguous");
  assert.equal(readers.rows.length, 1, "User RLS reader inventory is missing");
  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    ledger: Object.freeze(ledger.rows.map((row) => Object.freeze(row))),
    table: Object.freeze({
      ...table.rows[0],
      nonowner_acl: Object.freeze([...(table.rows[0].nonowner_acl ?? [])]),
    }),
    indexes: Object.freeze(indexes.rows.map((row) => Object.freeze(row))),
    triggers: Object.freeze(triggers.rows.map((row) => Object.freeze(row))),
    constraints: Object.freeze(constraints.rows.map((row) => Object.freeze(row))),
    readers: Object.freeze(readers.rows[0]),
    convergence: Object.freeze(convergence.rows.map((row) => Object.freeze(row))),
  });
}

export function verifyUserRlsEnableCatalog(catalog, expectedState) {
  assert.ok(
    expectedState === "predecessor" || expectedState === "enabled",
    "User RLS expected state must be predecessor or enabled",
  );
  assert.deepEqual(catalog?.identity, {
    current_user: "neondb_owner",
    session_user: "neondb_owner",
    database_name: "neondb",
    read_only: "on",
    isolation: "repeatable read",
    owner_bypass_rls: true,
    runtime_bypass_rls: false,
    runtime_superuser: false,
    runtime_inherit: false,
    staff_bypass_rls: false,
    staff_superuser: false,
    staff_inherit: false,
  });
  const convergenceRows = catalog.ledger.filter((row) =>
    row.migration_name === USER_RLS_ENABLE_MIGRATIONS.convergence.name);
  const enableRows = catalog.ledger.filter((row) =>
    row.migration_name === USER_RLS_ENABLE_MIGRATIONS.enable.name);
  assert.equal(convergenceRows.length, 1, "User convergence ledger row drifted");
  assert.equal(
    exactApplied(convergenceRows[0], USER_RLS_ENABLE_MIGRATIONS.convergence),
    true,
    "User convergence ledger was not accepted",
  );
  assert.equal(enableRows.length, expectedState === "enabled" ? 1 : 0);
  if (expectedState === "enabled") {
    assert.equal(
      exactApplied(enableRows[0], USER_RLS_ENABLE_MIGRATIONS.enable),
      true,
      "User ENABLE ledger was not accepted",
    );
  }
  assert.equal(catalog.ledger.length, 1 + enableRows.length);

  const directEnabled = expectedState === "predecessor";
  assert.deepEqual(catalog.table, {
    table_name: "User",
    owner_name: "neondb_owner",
    rls_enabled: expectedState === "enabled",
    rls_forced: false,
    policy_count: 0,
    runtime_select: directEnabled,
    runtime_insert: directEnabled,
    runtime_update: directEnabled,
    runtime_delete: directEnabled,
    staff_select: false,
    staff_insert: false,
    staff_update: false,
    staff_delete: false,
    nonowner_acl: directEnabled ? [
      "grainline_app_runtime:DELETE:false",
      "grainline_app_runtime:INSERT:false",
      "grainline_app_runtime:SELECT:false",
      "grainline_app_runtime:UPDATE:false",
    ] : [],
    nonowner_column_acl_count: 0,
  });
  assert.deepEqual(
    catalog.indexes,
    EXPECTED_INDEXES.map((entry) => ({ ...entry, valid: true, ready: true, live: true })),
  );
  assert.deepEqual(catalog.triggers, EXPECTED_TRIGGERS);
  assert.deepEqual(catalog.constraints, EXPECTED_CONSTRAINTS);
  assert.ok(catalog.readers.direct_reader_count >= 53, "User direct-reader coverage regressed");
  assert.equal(
    catalog.readers.security_definer_count,
    catalog.readers.direct_reader_count,
    "A direct User reader is not SECURITY DEFINER",
  );
  assert.deepEqual(catalog.convergence, [
    {
      function_name: "grainline_case_resolution_claim_immutable",
      security_definer: true,
      source_md5: "06289e9db780c559e07188c20e680887",
      uses_user_table: true,
      runtime_execute: false,
    },
    {
      function_name: "grainline_conversation_inbox",
      security_definer: false,
      source_md5: "4b2884765f4ca0db432c4678f98b1bdd",
      uses_user_table: false,
      runtime_execute: true,
    },
  ]);
  return Object.freeze({
    expectedState,
    directReaderCount: catalog.readers.direct_reader_count,
    indexCount: catalog.indexes.length,
    triggerCount: catalog.triggers.length,
    constraintCount: catalog.constraints.length,
    userRlsEnabled: catalog.table.rls_enabled,
    userRlsForced: catalog.table.rls_forced,
    runtimeDirectCrud: directEnabled,
    rowDataRead: false,
    productionChanged: false,
  });
}

export async function inspectUserRlsEnableProduction({
  directUrl = process.env.DIRECT_URL,
  expectedState = process.env.EXPECTED_USER_RLS_STATE,
} = {}) {
  if (typeof directUrl !== "string" || directUrl === "") {
    throw new Error("DIRECT_URL is required");
  }
  const parsed = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-user-rls-enable-production-inspection",
    ...postgresChannelBindingClientOptions(parsed),
  });
  await client.connect();
  let open = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    open = true;
    const catalog = await readUserRlsEnableCatalog(client);
    const result = verifyUserRlsEnableCatalog(catalog, expectedState);
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze({ catalog, result, transaction: Object.freeze({
      isolation: "repeatable read", readOnly: true, rolledBack: true,
    }) });
  } finally {
    if (open) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await inspectUserRlsEnableProduction();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
