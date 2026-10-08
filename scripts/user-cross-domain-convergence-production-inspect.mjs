#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;

export const USER_CROSS_DOMAIN_FUNCTIONS = Object.freeze([
  Object.freeze({
    name: "grainline_case_resolution_claim_immutable",
    identityArguments: "",
    pendingSourceMd5: "06289e9db780c559e07188c20e680887",
    appliedSourceMd5: "06289e9db780c559e07188c20e680887",
    pendingDefiner: false,
    appliedDefiner: true,
    runtimeExecute: false,
  }),
  Object.freeze({
    name: "grainline_conversation_inbox",
    identityArguments: "p_user_id text, p_archived boolean, p_query text, p_before_at timestamp without time zone, p_before_id text, p_limit integer",
    pendingSourceMd5: "2a7fceb40f06e9934749c06516209f3a",
    appliedSourceMd5: "4b2884765f4ca0db432c4678f98b1bdd",
    pendingDefiner: false,
    appliedDefiner: false,
    runtimeExecute: true,
  }),
  Object.freeze({
    name: "grainline_user_conversation_participants",
    identityArguments: "p_actor_id text, p_conversation_id text",
    pendingSourceMd5: "44c3946959d09676749bdf7e0c9e286c",
    appliedSourceMd5: "44c3946959d09676749bdf7e0c9e286c",
    pendingDefiner: true,
    appliedDefiner: true,
    runtimeExecute: true,
  }),
]);

function exactArray(left, right) {
  return (
    Array.isArray(left)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index])
  );
}

export async function readUserCrossDomainCatalog(client) {
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
    throw new Error("User cross-domain database roles are missing or ambiguous");
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
      ) AS runtime_delete,
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
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = ANY(ARRAY[
        'CaseResolutionClaim', 'Conversation', 'Message', 'User'
      ]::text[])
      AND class.relkind = 'r'
    ORDER BY class.relname
  `);

  const functions = await client.query(`
    SELECT
      procedure.proname::text AS function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)::text
        AS identity_arguments,
      pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner_name,
      language.lanname::text AS language_name,
      procedure.prokind AS function_kind,
      procedure.prosecdef AS security_definer,
      procedure.proleakproof AS leakproof,
      procedure.provolatile AS volatility,
      procedure.proparallel AS parallel_safety,
      COALESCE(procedure.proconfig, ARRAY[]::text[]) AS function_config,
      pg_catalog.md5(procedure.prosrc) AS source_md5,
      pg_catalog.strpos(procedure.prosrc, 'public."User"') > 0
        AS uses_user_table,
      pg_catalog.strpos(
        procedure.prosrc, 'grainline_user_conversation_participants'
      ) > 0 AS uses_participant_authority,
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
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
        WHERE acl.grantee <> procedure.proowner
        ORDER BY 1
      ) AS nonowner_acl
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
    WHERE namespace.nspname = 'public'
      AND procedure.proname = ANY(ARRAY[
        'grainline_case_resolution_claim_immutable',
        'grainline_conversation_inbox',
        'grainline_user_conversation_participants'
      ]::text[])
    ORDER BY procedure.proname, identity_arguments
  `);

  const policies = await client.query(`
    SELECT
      class.relname::text AS table_name,
      policy.polname::text AS policy_name,
      policy.polpermissive AS permissive,
      policy.polcmd::text AS command,
      ARRAY(
        SELECT pg_catalog.pg_get_userbyid(role_oid)::text
          FROM pg_catalog.unnest(policy.polroles) AS role_oid
         ORDER BY 1
      ) AS role_names,
      pg_catalog.regexp_replace(
        pg_catalog.replace(
          pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
          '::text',
          ''
        ),
        '\\s+',
        '',
        'g'
      ) AS using_expression,
      CASE WHEN policy.polwithcheck IS NULL THEN NULL ELSE
        pg_catalog.regexp_replace(
          pg_catalog.replace(
            pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
            '::text',
            ''
          ),
          '\\s+',
          '',
          'g'
        )
      END AS with_check_expression
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class
      ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relname = ANY(ARRAY[
        'CaseResolutionClaim', 'Conversation', 'Message', 'User'
      ]::text[])
    ORDER BY class.relname, policy.polname
  `);

  const triggers = await client.query(`
    SELECT
      trigger.tgname::text AS trigger_name,
      class.relname::text AS table_name,
      trigger.tgenabled::text AS enabled,
      procedure.proname::text AS function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)::text
        AS identity_arguments
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS class
      ON class.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger.tgfoid
    WHERE namespace.nspname = 'public'
      AND class.relname = 'CaseResolutionClaim'
      AND trigger.tgname = 'grainline_case_resolution_claim_immutable'
      AND NOT trigger.tgisinternal
  `);

  return Object.freeze({
    identity: Object.freeze(identity.rows[0]),
    tables: Object.freeze(tables.rows.map((row) => Object.freeze({
      ...row,
      nonowner_acl: Object.freeze([...(row.nonowner_acl ?? [])]),
    }))),
    functions: Object.freeze(functions.rows.map((row) => Object.freeze({
      ...row,
      function_config: Object.freeze([...(row.function_config ?? [])]),
      nonowner_acl: Object.freeze([...(row.nonowner_acl ?? [])]),
    }))),
    policies: Object.freeze(policies.rows.map((row) => Object.freeze({
      ...row,
      role_names: Object.freeze([...(row.role_names ?? [])]),
    }))),
    triggers: Object.freeze(triggers.rows.map((row) => Object.freeze(row))),
  });
}

export function verifyUserCrossDomainCatalog(catalog, expectedState) {
  assert.ok(
    expectedState === "pending" || expectedState === "applied",
    "User cross-domain state must be pending or applied",
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

  assert.deepEqual(
    catalog?.tables?.map((table) => table.table_name),
    ["CaseResolutionClaim", "Conversation", "Message", "User"],
  );
  const expectedTables = Object.freeze({
    CaseResolutionClaim: Object.freeze({
      rls_enabled: true,
      rls_forced: true,
      policy_count: 0,
      runtime_select: false,
      runtime_insert: false,
      runtime_update: false,
      runtime_delete: false,
      nonowner_acl: [],
      nonowner_column_acl_count: 0,
    }),
    Conversation: Object.freeze({
      rls_enabled: true,
      rls_forced: true,
      policy_count: 1,
      runtime_select: true,
      runtime_insert: false,
      runtime_update: false,
      runtime_delete: false,
      nonowner_acl: ["grainline_app_runtime:SELECT:false"],
      nonowner_column_acl_count: 0,
    }),
    Message: Object.freeze({
      rls_enabled: true,
      rls_forced: true,
      policy_count: 1,
      runtime_select: true,
      runtime_insert: false,
      runtime_update: false,
      runtime_delete: false,
      nonowner_acl: ["grainline_app_runtime:SELECT:false"],
      nonowner_column_acl_count: 0,
    }),
    User: Object.freeze({
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_select: true,
      runtime_insert: true,
      runtime_update: true,
      runtime_delete: true,
      nonowner_acl: [
        "grainline_app_runtime:DELETE:false",
        "grainline_app_runtime:INSERT:false",
        "grainline_app_runtime:SELECT:false",
        "grainline_app_runtime:UPDATE:false",
      ],
      nonowner_column_acl_count: 0,
    }),
  });
  for (const table of catalog.tables) {
    assert.equal(table.owner_name, "neondb_owner");
    const expected = expectedTables[table.table_name];
    assert.ok(expected, `Unexpected table ${table.table_name}`);
    for (const [key, value] of Object.entries(expected)) {
      if (Array.isArray(value)) {
        assert.deepEqual(table[key], value, `${table.table_name}.${key} drifted`);
      } else {
        assert.equal(table[key], value, `${table.table_name}.${key} drifted`);
      }
    }
  }

  assert.deepEqual(catalog?.policies, [
    {
      table_name: "Conversation",
      policy_name: "grainline_conversation_participant_or_reported_select",
      permissive: true,
      command: "r",
      role_names: ["grainline_app_runtime"],
      using_expression: "(((NULLIF(current_setting('app.user_id',true),'')=\"userAId\")OR(NULLIF(current_setting('app.user_id',true),'')=\"userBId\"))ORgrainline_conversation_staff_report_visible(id))",
      with_check_expression: null,
    },
    {
      table_name: "Message",
      policy_name: "grainline_message_participant_or_reported_select",
      permissive: true,
      command: "r",
      role_names: ["grainline_app_runtime"],
      using_expression: "(((NULLIF(current_setting('app.user_id',true),'')=\"senderId\")OR(NULLIF(current_setting('app.user_id',true),'')=\"recipientId\"))ORgrainline_conversation_staff_report_visible(\"conversationId\"))",
      with_check_expression: null,
    },
  ]);

  assert.equal(catalog?.functions?.length, USER_CROSS_DOMAIN_FUNCTIONS.length);
  for (const [index, expected] of USER_CROSS_DOMAIN_FUNCTIONS.entries()) {
    const actual = catalog.functions[index];
    assert.equal(actual?.function_name, expected.name);
    assert.equal(actual.identity_arguments, expected.identityArguments);
    assert.equal(actual.owner_name, "neondb_owner");
    assert.equal(actual.language_name, "plpgsql");
    assert.equal(actual.function_kind, "f");
    assert.equal(actual.security_definer,
      expectedState === "applied" ? expected.appliedDefiner : expected.pendingDefiner);
    assert.equal(actual.leakproof, false);
    assert.equal(actual.volatility, "v");
    assert.equal(actual.parallel_safety, "u");
    assert.equal(exactArray(actual.function_config, ["search_path=pg_catalog"]), true);
    assert.equal(actual.source_md5,
      expectedState === "applied" ? expected.appliedSourceMd5 : expected.pendingSourceMd5);
    assert.equal(actual.contains_dynamic_execute, false);
    assert.deepEqual(
      actual.nonowner_acl,
      expected.runtimeExecute ? ["grainline_app_runtime:EXECUTE:false"] : [],
    );
  }

  const inbox = catalog.functions.find((entry) =>
    entry.function_name === "grainline_conversation_inbox");
  assert.equal(inbox.uses_user_table, expectedState === "pending");
  assert.equal(inbox.uses_participant_authority, expectedState === "applied");
  const participant = catalog.functions.find((entry) =>
    entry.function_name === "grainline_user_conversation_participants");
  assert.equal(participant.uses_user_table, true);
  const claim = catalog.functions.find((entry) =>
    entry.function_name === "grainline_case_resolution_claim_immutable");
  assert.equal(claim.uses_user_table, true);

  assert.deepEqual(catalog?.triggers, [{
    trigger_name: "grainline_case_resolution_claim_immutable",
    table_name: "CaseResolutionClaim",
    enabled: "O",
    function_name: "grainline_case_resolution_claim_immutable",
    identity_arguments: "",
  }]);

  return Object.freeze({
    databaseMode: "owner-catalog-read-only",
    expectedState,
    functionCount: catalog.functions.length,
    tableCount: catalog.tables.length,
    triggerCount: catalog.triggers.length,
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
  const expectedState = process.env.EXPECTED_USER_CROSS_DOMAIN_STATE;
  const parsedUrl = new URL(directUrl);
  const client = new Client({
    connectionString: directUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-user-cross-domain-production-inspect",
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const catalog = await readUserCrossDomainCatalog(client);
    const result = verifyUserCrossDomainCatalog(catalog, expectedState);
    await client.query("ROLLBACK");
    transactionOpen = false;
    process.stdout.write(
      `${JSON.stringify({ status: "passed", result, catalog }, null, 2)}\n`,
    );
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
