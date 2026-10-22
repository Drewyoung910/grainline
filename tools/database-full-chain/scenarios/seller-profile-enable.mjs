import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function expectDirectDenial(database, role, statement) {
  await database.query(`SET SESSION AUTHORIZATION ${role}`);
  try {
    await assert.rejects(
      database.query(statement),
      (error) => error?.code === "42501",
    );
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

export async function proveSellerProfilePolicylessEnable({ database }) {
  const posture = rowsOf(await database.query(`
    SELECT class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           (
             SELECT pg_catalog.count(*)::integer
               FROM pg_catalog.pg_policy AS policy
              WHERE policy.polrelid = class.oid
           ) AS policy_count,
           (
             SELECT pg_catalog.count(*)::integer
               FROM pg_catalog.aclexplode(
                 COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
               ) AS acl
              WHERE acl.grantee <> class.relowner
                AND acl.privilege_type IN (
                  'SELECT', 'INSERT', 'UPDATE', 'DELETE',
                  'TRUNCATE', 'REFERENCES', 'TRIGGER'
                )
           ) AS non_owner_table_grants,
           pg_catalog.has_any_column_privilege(
             'grainline_app_runtime', class.oid,
             'SELECT,INSERT,UPDATE,REFERENCES'
           ) AS runtime_column_authority,
           pg_catalog.has_any_column_privilege(
             'grainline_staff_read_runtime', class.oid,
             'SELECT,INSERT,UPDATE,REFERENCES'
           ) AS staff_column_authority
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
  `));
  assert.deepEqual(posture, [{
    rls_enabled: true,
    rls_forced: false,
    policy_count: 0,
    non_owner_table_grants: 0,
    runtime_column_authority: false,
    staff_column_authority: false,
  }]);

  await expectDirectDenial(
    database,
    "grainline_app_runtime",
    'SELECT id FROM public."SellerProfile" LIMIT 1',
  );
  await expectDirectDenial(
    database,
    "grainline_app_runtime",
    'INSERT INTO public."SellerProfile" (id, "userId", "displayName", "displayNameNormalized") VALUES (\'denied\', \'denied\', \'Denied\', \'denied\')',
  );
  await expectDirectDenial(
    database,
    "grainline_app_runtime",
    'UPDATE public."SellerProfile" SET "updatedAt" = "updatedAt" WHERE false',
  );
  await expectDirectDenial(
    database,
    "grainline_app_runtime",
    'DELETE FROM public."SellerProfile" WHERE false',
  );
  await expectDirectDenial(
    database,
    "grainline_app_runtime",
    'TRUNCATE public."SellerProfile"',
  );
  await expectDirectDenial(
    database,
    "grainline_staff_read_runtime",
    'SELECT id FROM public."SellerProfile" LIMIT 1',
  );

  const privatePosture = rowsOf(await database.query(`
    SELECT class.relrowsecurity AS rls_enabled,
           class.relforcerowsecurity AS rls_forced,
           (
             SELECT pg_catalog.count(*)::integer
               FROM pg_catalog.pg_policy AS policy
              WHERE policy.polrelid = class.oid
           ) AS policy_count
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SellerProfilePrivate"'::pg_catalog.regclass
  `));
  assert.deepEqual(privatePosture, [{
    rls_enabled: true,
    rls_forced: true,
    policy_count: 0,
  }]);
}
