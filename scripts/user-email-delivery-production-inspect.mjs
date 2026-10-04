#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;

export const USER_EMAIL_DELIVERY_FUNCTIONS = Object.freeze([
  Object.freeze({
    name: "grainline_user_email_account_state_by_email",
    identityArguments: "p_email text",
    sourceMd5: "ee42b76e0d0a21abe1303b855a8bed52",
    volatility: "s",
  }),
  Object.freeze({
    name: "grainline_user_email_account_state_by_id",
    identityArguments: "p_user_id text, p_expected_email text",
    sourceMd5: "c7ffe3ac51f3cb4d19bfcf24dc31ebd1",
    volatility: "s",
  }),
  Object.freeze({
    name: "grainline_user_email_recipient",
    identityArguments: "p_user_id text, p_preference_key text",
    sourceMd5: "d432e2801da898e4bf6599ba45a2fcf2",
    volatility: "s",
  }),
  Object.freeze({
    name: "grainline_user_email_recipient_batch",
    identityArguments: "p_user_ids text[], p_preference_key text",
    sourceMd5: "0d9240133625e543714cf6c3d3791b80",
    volatility: "s",
  }),
]);

function exactArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

export async function readUserEmailDeliveryCatalog(client) {
  const identity = await client.query(`
    SELECT CURRENT_USER::text AS current_user,
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
    throw new Error("User email-delivery database roles are missing or ambiguous");
  }

  const tables = await client.query(`
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
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'DELETE') AS runtime_delete
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'User'
       AND class.relkind = 'r'
  `);
  if (tables.rows.length !== 1) {
    throw new Error("User email-delivery table is missing or ambiguous");
  }

  const functions = await client.query(`
    SELECT procedure.proname::text AS function_name,
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
           pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') > 0 AS contains_dynamic_execute,
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
         'grainline_user_email_account_state_by_email',
         'grainline_user_email_account_state_by_id',
         'grainline_user_email_recipient',
         'grainline_user_email_recipient_batch'
       ]::text[])
     ORDER BY procedure.proname, identity_arguments
  `);

  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    tables: Object.freeze(tables.rows.map((row) => Object.freeze(row))),
    functions: Object.freeze(functions.rows.map((entry) => Object.freeze({
      ...entry,
      function_config: Object.freeze([...(entry.function_config ?? [])]),
      nonowner_acl: Object.freeze([...(entry.nonowner_acl ?? [])]),
    }))),
  });
}

export function verifyUserEmailDeliveryCatalog(catalog, expectedState) {
  assert.ok(
    expectedState === "pending" || expectedState === "applied",
    "User email-delivery state must be pending or applied",
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
  assert.equal(catalog?.tables?.length, 1);
  assert.deepEqual(catalog.tables.map((table) => table.table_name), ["User"]);
  for (const table of catalog.tables) {
    assert.equal(table.owner_name, "neondb_owner");
    assert.equal(typeof table.rls_enabled, "boolean");
    assert.equal(typeof table.rls_forced, "boolean");
    assert.ok(Number.isSafeInteger(Number(table.policy_count)));
    for (const key of ["runtime_select", "runtime_insert", "runtime_update", "runtime_delete"]) {
      assert.equal(typeof table[key], "boolean", `${table.table_name}.${key} is missing`);
    }
  }

  const functions = catalog?.functions ?? [];
  assert.equal(
    functions.length,
    expectedState === "applied" ? USER_EMAIL_DELIVERY_FUNCTIONS.length : 0,
    "User email-delivery function count drifted",
  );
  if (expectedState === "applied") {
    for (const [index, expected] of USER_EMAIL_DELIVERY_FUNCTIONS.entries()) {
      const actual = functions[index];
      assert.equal(actual?.function_name, expected.name);
      assert.equal(actual.identity_arguments, expected.identityArguments);
      assert.equal(actual.owner_name, "neondb_owner");
      assert.equal(actual.language_name, "plpgsql");
      assert.equal(actual.function_kind, "f");
      assert.equal(actual.security_definer, true);
      assert.equal(actual.leakproof, false);
      assert.equal(actual.volatility, expected.volatility);
      assert.equal(actual.parallel_safety, "u");
      assert.equal(actual.source_md5, expected.sourceMd5);
      assert.equal(actual.contains_dynamic_execute, false);
      assert.equal(exactArray(actual.function_config, ["search_path=pg_catalog"]), true);
      assert.equal(
        exactArray(actual.nonowner_acl, ["grainline_app_runtime:EXECUTE:false"]),
        true,
      );
    }
  }

  return Object.freeze({
    databaseMode: "owner-catalog-read-only",
    expectedState,
    functionCount: functions.length,
    tableCount: catalog.tables.length,
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
  const expectedState = process.env.EXPECTED_USER_EMAIL_DELIVERY_STATE;
  const parsedUrl = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-user-email-delivery-production-inspect",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const catalog = await readUserEmailDeliveryCatalog(client);
    const result = verifyUserEmailDeliveryCatalog(catalog, expectedState);
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
