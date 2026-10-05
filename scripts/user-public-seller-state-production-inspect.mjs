#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;

export const USER_PUBLIC_SELLER_STATE_FUNCTIONS = Object.freeze([
  Object.freeze({
    name: "grainline_seller_owner_public_state_bind",
    identityArguments: "",
    sourceMd5: "30616fc4688aa025d4a4e6cf0b6bbe89",
  }),
  Object.freeze({
    name: "grainline_user_public_seller_state_sync",
    identityArguments: "",
    sourceMd5: "c6ec5db8fb7ce7e3f2887571334affda",
  }),
]);

export const USER_PUBLIC_SELLER_STATE_TRIGGERS = Object.freeze([
  Object.freeze({
    tableName: "SellerProfile",
    triggerName: "grainline_seller_owner_public_state_bind",
    functionName: "grainline_seller_owner_public_state_bind",
  }),
  Object.freeze({
    tableName: "User",
    triggerName: "grainline_user_public_seller_state_sync",
    functionName: "grainline_user_public_seller_state_sync",
  }),
]);

function exactArray(left, right) {
  return (
    Array.isArray(left)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index])
  );
}

export async function readUserPublicSellerStateCatalog(client) {
  const identity = await client.query(`
    SELECT
      CURRENT_USER::text AS current_user,
      SESSION_USER::text AS session_user,
      pg_catalog.current_database()::text AS database_name,
      pg_catalog.current_setting('transaction_read_only') AS read_only,
      pg_catalog.current_setting('transaction_isolation') AS isolation,
      owner_role.rolbypassrls AS owner_bypass_rls,
      runtime_role.rolbypassrls AS runtime_bypass_rls,
      runtime_role.rolsuper AS runtime_superuser,
      runtime_role.rolinherit AS runtime_inherit
    FROM pg_catalog.pg_roles AS owner_role
    JOIN pg_catalog.pg_roles AS runtime_role
      ON runtime_role.rolname = 'grainline_app_runtime'
    WHERE owner_role.rolname = CURRENT_USER
  `);
  if (identity.rows.length !== 1) {
    throw new Error("User public seller-state database roles are missing or ambiguous");
  }

  const tables = await client.query(`
    SELECT
      class.relname::text AS table_name,
      pg_catalog.pg_get_userbyid(class.relowner)::text AS owner_name,
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid) AS policy_count,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', class.oid, 'SELECT'
      ) AS runtime_select,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', class.oid, 'INSERT'
      ) AS runtime_insert,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', class.oid, 'UPDATE'
      ) AS runtime_update,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', class.oid, 'DELETE'
      ) AS runtime_delete
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = ANY(ARRAY['SellerProfile', 'User']::text[])
      AND class.relkind = 'r'
    ORDER BY class.relname
  `);
  if (tables.rows.length !== 2) {
    throw new Error("User public seller-state tables are missing or ambiguous");
  }

  const columns = await client.query(`
    SELECT
      class.relname::text AS table_name,
      attribute.attname::text AS column_name,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)::text AS data_type,
      attribute.attnotnull AS not_null,
      pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid) AS default_expression
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE namespace.nspname = 'public'
      AND class.relname = 'SellerProfile'
      AND attribute.attname = ANY(ARRAY['ownerAccountActive', 'ownerImageUrl']::text[])
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY attribute.attname
  `);

  const functions = await client.query(`
    SELECT
      procedure.proname::text AS function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)::text AS identity_arguments,
      pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner_name,
      language.lanname::text AS language_name,
      procedure.prokind AS function_kind,
      procedure.prosecdef AS security_definer,
      procedure.proleakproof AS leakproof,
      procedure.provolatile AS volatility,
      procedure.proparallel AS parallel_safety,
      COALESCE(procedure.proconfig, ARRAY[]::text[]) AS function_config,
      pg_catalog.md5(procedure.prosrc) AS source_md5,
      pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') > 0
        AS contains_dynamic_execute,
      ARRAY(
        SELECT pg_catalog.format(
          '%s:%s:%s',
          CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
               ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
          acl.privilege_type,
          CASE WHEN acl.is_grantable THEN 'true' ELSE 'false' END
        )
        FROM pg_catalog.aclexplode(
          COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
        ) AS acl
        WHERE acl.grantee <> procedure.proowner
        ORDER BY 1
      ) AS nonowner_acl
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
    WHERE namespace.nspname = 'public'
      AND procedure.proname = ANY(ARRAY[
        'grainline_seller_owner_public_state_bind',
        'grainline_user_public_seller_state_sync'
      ]::text[])
    ORDER BY procedure.proname, identity_arguments
  `);

  const triggers = await client.query(`
    SELECT
      class.relname::text AS table_name,
      trigger_row.tgname::text AS trigger_name,
      procedure.proname::text AS function_name,
      trigger_row.tgenabled AS enabled,
      trigger_row.tgisinternal AS internal
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS class ON class.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger_row.tgfoid
    WHERE namespace.nspname = 'public'
      AND trigger_row.tgname = ANY(ARRAY[
        'grainline_seller_owner_public_state_bind',
        'grainline_user_public_seller_state_sync'
      ]::text[])
    ORDER BY class.relname, trigger_row.tgname
  `);

  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    tables: Object.freeze(tables.rows.map((row) => Object.freeze(row))),
    columns: Object.freeze(columns.rows.map((row) => Object.freeze(row))),
    functions: Object.freeze(functions.rows.map((row) => Object.freeze({
      ...row,
      function_config: Object.freeze([...(row.function_config ?? [])]),
      nonowner_acl: Object.freeze([...(row.nonowner_acl ?? [])]),
    }))),
    triggers: Object.freeze(triggers.rows.map((row) => Object.freeze(row))),
  });
}

export function verifyUserPublicSellerStateCatalog(catalog, expectedState) {
  assert.ok(
    expectedState === "pending" || expectedState === "applied",
    "User public seller-state state must be pending or applied",
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
  });

  assert.deepEqual(catalog?.tables?.map((table) => table.table_name), [
    "SellerProfile",
    "User",
  ]);
  for (const table of catalog.tables) {
    assert.equal(table.owner_name, "neondb_owner");
    assert.equal(typeof table.rls_enabled, "boolean");
    assert.equal(typeof table.rls_forced, "boolean");
    assert.ok(Number.isSafeInteger(Number(table.policy_count)));
    for (const key of ["runtime_select", "runtime_insert", "runtime_update", "runtime_delete"]) {
      assert.equal(typeof table[key], "boolean", `${table.table_name}.${key} is missing`);
    }
  }

  const expectedColumns = expectedState === "applied" ? [
    {
      table_name: "SellerProfile",
      column_name: "ownerAccountActive",
      data_type: "boolean",
      not_null: true,
      default_expression: "false",
    },
    {
      table_name: "SellerProfile",
      column_name: "ownerImageUrl",
      data_type: "character varying(2048)",
      not_null: false,
      default_expression: null,
    },
  ] : [];
  assert.deepEqual(catalog?.columns, expectedColumns);

  const functions = catalog?.functions ?? [];
  assert.equal(
    functions.length,
    expectedState === "applied" ? USER_PUBLIC_SELLER_STATE_FUNCTIONS.length : 0,
    "User public seller-state function count drifted",
  );
  if (expectedState === "applied") {
    for (const [index, expected] of USER_PUBLIC_SELLER_STATE_FUNCTIONS.entries()) {
      const actual = functions[index];
      assert.equal(actual?.function_name, expected.name);
      assert.equal(actual.identity_arguments, expected.identityArguments);
      assert.equal(actual.owner_name, "neondb_owner");
      assert.equal(actual.language_name, "plpgsql");
      assert.equal(actual.function_kind, "f");
      assert.equal(actual.security_definer, true);
      assert.equal(actual.leakproof, false);
      assert.equal(actual.volatility, "v");
      assert.equal(actual.parallel_safety, "u");
      assert.equal(actual.source_md5, expected.sourceMd5);
      assert.equal(actual.contains_dynamic_execute, false);
      assert.equal(exactArray(actual.function_config, ["search_path=pg_catalog"]), true);
      assert.deepEqual(actual.nonowner_acl, []);
    }
  }

  const triggers = catalog?.triggers ?? [];
  assert.equal(
    triggers.length,
    expectedState === "applied" ? USER_PUBLIC_SELLER_STATE_TRIGGERS.length : 0,
    "User public seller-state trigger count drifted",
  );
  if (expectedState === "applied") {
    for (const [index, expected] of USER_PUBLIC_SELLER_STATE_TRIGGERS.entries()) {
      const actual = triggers[index];
      assert.equal(actual?.table_name, expected.tableName);
      assert.equal(actual.trigger_name, expected.triggerName);
      assert.equal(actual.function_name, expected.functionName);
      assert.equal(actual.enabled, "O");
      assert.equal(actual.internal, false);
    }
  }

  return Object.freeze({
    databaseMode: "owner-catalog-read-only",
    expectedState,
    tableCount: catalog.tables.length,
    columnCount: catalog.columns.length,
    functionCount: functions.length,
    triggerCount: triggers.length,
    rowDataRead: false,
    productionChanged: false,
  });
}

async function main() {
  const directUrl = process.env.DIRECT_URL;
  assert.ok(directUrl, "DIRECT_URL is required");
  assert.equal(
    Object.hasOwn(process.env, "DATABASE_URL"),
    false,
    "DATABASE_URL must remain absent from owner catalog inspection",
  );
  const expectedState = process.env.EXPECTED_USER_PUBLIC_SELLER_STATE;
  const parsedUrl = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-user-public-seller-state-production-inspect",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const catalog = await readUserPublicSellerStateCatalog(client);
    const result = verifyUserPublicSellerStateCatalog(catalog, expectedState);
    await client.query("ROLLBACK");
    transactionOpen = false;
    process.stdout.write(`${JSON.stringify({ status: "passed", result, catalog }, null, 2)}\n`);
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
