import pg from "pg";

const url = process.env.SELLER_PROFILE_PUBLIC_CATALOG_DATABASE_URL;
if (!url) {
  throw new Error("SELLER_PROFILE_PUBLIC_CATALOG_DATABASE_URL is required");
}

const parsed = new URL(url);
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
  throw new Error("SellerProfile catalog inventory accepts a loopback database only");
}
if (parsed.pathname !== "/grainline_ci" || decodeURIComponent(parsed.username) !== "ci") {
  throw new Error("SellerProfile catalog inventory requires ci@loopback/grainline_ci");
}

const client = new pg.Client({ connectionString: url });
await client.connect();

async function query(text, params = []) {
  return (await client.query(text, params)).rows;
}

try {
  const identity = await query(`
    SELECT current_user, current_database(),
           current_setting('server_version') AS server_version
  `);
  if (!/^16(?:\.|$)/u.test(String(identity[0]?.server_version ?? ""))) {
    throw new Error(`PostgreSQL 16 required, got ${identity[0]?.server_version ?? "unknown"}`);
  }

  const table = await query(`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
           pg_catalog.pg_get_userbyid(c.relowner) AS owner,
           c.relacl::text AS acl
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'SellerProfile'
  `);
  const policies = await query(`
    SELECT policyname, permissive, roles, cmd, qual, with_check
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'public' AND tablename = 'SellerProfile'
     ORDER BY policyname
  `);
  const functions = await query(`
    SELECT p.oid::pg_catalog.regprocedure::text AS signature,
           l.lanname AS language,
           p.prosecdef AS security_definer,
           pg_catalog.pg_get_userbyid(p.proowner) AS owner,
           p.proconfig AS config,
           pg_catalog.md5(p.prosrc) AS source_md5,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', p.oid, 'EXECUTE'
           ) AS runtime_execute,
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
               ) AS acl
              WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
           ) AS public_execute
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND pg_catalog.strpos(p.prosrc, 'SellerProfile') > 0
     ORDER BY signature
  `);
  const triggers = await query(`
    SELECT t.tgname AS trigger_name,
           t.tgrelid::pg_catalog.regclass::text AS table_name,
           t.tgfoid::pg_catalog.regprocedure::text AS function_signature,
           pg_catalog.pg_get_triggerdef(t.oid, true) AS definition
      FROM pg_catalog.pg_trigger AS t
     WHERE NOT t.tgisinternal
       AND (
         t.tgrelid = 'public."SellerProfile"'::pg_catalog.regclass
         OR pg_catalog.strpos(
           (SELECT p.prosrc FROM pg_catalog.pg_proc AS p WHERE p.oid = t.tgfoid),
           'SellerProfile'
         ) > 0
       )
     ORDER BY table_name, trigger_name
  `);
  const views = await query(`
    SELECT n.nspname AS schema_name, c.relname AS view_name, c.relkind,
           pg_catalog.pg_get_viewdef(c.oid, true) AS definition
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('v', 'm')
       AND pg_catalog.strpos(
         pg_catalog.pg_get_viewdef(c.oid, true), 'SellerProfile'
       ) > 0
     ORDER BY schema_name, view_name
  `);
  const constraints = await query(`
    SELECT con.conname AS constraint_name,
           con.conrelid::pg_catalog.regclass::text AS table_name,
           con.contype,
           pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_catalog.pg_constraint AS con
     WHERE con.conrelid = 'public."SellerProfile"'::pg_catalog.regclass
        OR con.confrelid = 'public."SellerProfile"'::pg_catalog.regclass
     ORDER BY table_name, constraint_name
  `);
  const grants = await query(`
    SELECT grantee, privilege_type, is_grantable
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'SellerProfile'
     ORDER BY grantee, privilege_type
  `);
  const columnGrants = await query(`
    SELECT grantee, privilege_type, column_name, is_grantable
      FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name = 'SellerProfile'
     ORDER BY grantee, privilege_type, column_name
  `);

  const report = {
    identity,
    table,
    policies,
    functions,
    triggers,
    views,
    constraints,
    grants,
    columnGrants,
  };
  const summary = {
    identity,
    table,
    policyCount: policies.length,
    functionCount: functions.length,
    runtimeExecutableFunctions: functions.filter((row) => row.runtime_execute).length,
    publicExecutableFunctions: functions.filter((row) => row.public_execute).length,
    triggerCount: triggers.length,
    sellerProfileTriggerCount: triggers.filter(
      (row) => row.table_name === '"SellerProfile"',
    ).length,
    viewCount: views.length,
    constraintCount: constraints.length,
    incomingForeignKeyCount: constraints.filter(
      (row) => row.contype === "f" && row.table_name !== '"SellerProfile"',
    ).length,
    runtimeTablePrivileges: grants
      .filter((row) => row.grantee === "grainline_app_runtime")
      .map((row) => row.privilege_type)
      .sort(),
    runtimeColumnPrivilegeRows: columnGrants.filter(
      (row) => row.grantee === "grainline_app_runtime",
    ).length,
  };
  process.stdout.write(`${JSON.stringify(process.argv.includes("--json") ? report : summary, null, 2)}\n`);
} finally {
  await client.end();
}
