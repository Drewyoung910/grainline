// Source-only verifier component. A later reviewed operator must supply a
// separately authenticated pooled runtime connection and a read-only,
// repeatable-read transaction; this module opens no connection or workflow.
import assert from "node:assert/strict";

const RUNTIME_ROLE = "grainline_app_runtime";
const STAFF_ROLE = "grainline_staff_read_runtime";
const STAFF_FUNCTIONS = Object.freeze([
  "public.grainline_order_staff_page_v2(text,text,integer,integer)",
  "public.grainline_order_staff_detail_v2(text,text)",
  "public.grainline_order_staff_mark_reviewed(text,text)",
  "public.grainline_order_staff_record_label_voided(text,text)",
  "public.grainline_order_staff_append_note(text,text,text)",
  "public.grainline_order_staff_capability_mint(text,text,text,jsonb)",
]);

export async function verifyOrderCoreRuntimePosture(
  client,
  { forced, owner = "neondb_owner", database = "neondb" } = {},
) {
  assert.equal(typeof forced, "boolean");
  const result = await client.query(`
    WITH expected_staff(identity) AS (
      SELECT unnest($1::text[])
    )
    SELECT
      CURRENT_USER::text AS actor,
      SESSION_USER::text AS login,
      pg_catalog.current_database()::text AS database_name,
      pg_catalog.current_setting('transaction_isolation') AS isolation,
      pg_catalog.current_setting('transaction_read_only') AS read_only,
      role.rolsuper,
      role.rolbypassrls,
      role.rolinherit,
      role.rolcanlogin,
      pg_catalog.pg_has_role(CURRENT_USER, $2, 'MEMBER') AS member_of_owner,
      pg_catalog.pg_get_userbyid(class.relowner) AS owner_name,
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid) AS policy_count,
      pg_catalog.has_table_privilege(
        CURRENT_USER, class.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) AS direct_table,
      pg_catalog.has_any_column_privilege(
        CURRENT_USER, class.oid,
        'SELECT,INSERT,UPDATE,REFERENCES'
      ) AS direct_column,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl,
                    pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee <> class.relowner
          AND acl.privilege_type IN (
            'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
          )) AS unexpected_table_acl_count,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_class AS child
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = child.relnamespace
        WHERE namespace.nspname = 'public'
          AND child.relname IN ('OrderItem', 'OrderShippingRateQuote')
          AND child.relkind = 'r'
          AND NOT child.relrowsecurity AND NOT child.relforcerowsecurity
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = child.oid
          )) AS unchanged_child_count,
      (SELECT pg_catalog.count(*)::integer
         FROM expected_staff AS expected
         JOIN pg_catalog.pg_proc AS procedure
           ON procedure.oid = pg_catalog.to_regprocedure(expected.identity)
        WHERE procedure.proowner = class.relowner
          AND procedure.prosecdef
          AND pg_catalog.has_function_privilege(
            $3, procedure.oid, 'EXECUTE'
          )
          AND NOT pg_catalog.has_function_privilege(
            CURRENT_USER, procedure.oid, 'EXECUTE'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(
              COALESCE(procedure.proacl,
                       pg_catalog.acldefault('f', procedure.proowner))
            ) AS acl
             WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
          )) AS accepted_staff_function_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    JOIN pg_catalog.pg_roles AS role ON role.rolname = CURRENT_USER
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Order'
     AND class.relkind = 'r'
  `, [STAFF_FUNCTIONS, owner, STAFF_ROLE]);

  assert.deepEqual(result.rows, [{
    actor: RUNTIME_ROLE,
    login: RUNTIME_ROLE,
    database_name: database,
    isolation: "repeatable read",
    read_only: "on",
    rolsuper: false,
    rolbypassrls: false,
    rolinherit: false,
    rolcanlogin: true,
    member_of_owner: false,
    owner_name: owner,
    rls_enabled: true,
    rls_forced: forced,
    policy_count: 0,
    direct_table: false,
    direct_column: false,
    unexpected_table_acl_count: 0,
    unchanged_child_count: 2,
    accepted_staff_function_count: STAFF_FUNCTIONS.length,
  }]);
  return Object.freeze({
    runtimeRole: RUNTIME_ROLE,
    orderRlsEnabled: true,
    orderRlsForced: forced,
    orderPolicyCount: 0,
    directOrderAuthority: false,
    staffFunctionCount: STAFF_FUNCTIONS.length,
    childTablesUnchanged: true,
    transactionReadOnly: true,
  });
}

export async function proveOrderCoreDirectSelectDenied(client) {
  await client.query("SAVEPOINT order_core_direct_select_denial");
  let code;
  try {
    await client.query('SELECT 1 FROM public."Order" LIMIT 0');
  } catch (error) {
    code = error?.code;
  }
  await client.query("ROLLBACK TO SAVEPOINT order_core_direct_select_denial");
  await client.query("RELEASE SAVEPOINT order_core_direct_select_denial");
  assert.equal(code, "42501", "Core Order direct SELECT was not denied by the database");
  return Object.freeze({ directSelectSqlstate: code, rowDataRead: false });
}
