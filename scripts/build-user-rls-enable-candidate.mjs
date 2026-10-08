#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildUserInstalledCatalogExpectation,
} from "./user-installed-catalog-production-inspect.mjs";

export const USER_RLS_ENABLE_RELEASE = Object.freeze({
  migrationName: "20261008010000_enable_user_rls",
  migrationPath:
    "prisma/migrations/20261008010000_enable_user_rls/migration.sql",
  predecessorMigration:
    "20261007160000_converge_user_cross_domain_authorities",
  predecessorSha256:
    "fad2c67b0ed3ed4d762a7a5d7d491ba8cca1ab33dc6f0253d8dff845933c4302",
});

const quoteLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

function valuesRows(rows) {
  return rows.map((row) => `      (${row.map(quoteLiteral).join(", ")})`).join(",\n");
}

export function buildUserRlsEnableMigration(root = process.cwd()) {
  const authority = buildUserInstalledCatalogExpectation(root);
  assert.equal(authority.functions.length, 53);
  assert.equal(authority.functions.filter(({ runtimeExecute }) => runtimeExecute).length, 34);
  assert.equal(authority.functions.filter(({ staffExecute }) => staffExecute).length, 9);

  const functionRows = valuesRows(authority.functions.map((entry) => [
    `public.${entry.identity}`,
    entry.sourceMd5,
    entry.language,
    entry.volatility,
    entry.parallelSafety,
    entry.runtimeExecute
      ? "grainline_app_runtime"
      : entry.staffExecute ? "grainline_staff_read_runtime" : "",
  ]));
  const ledgerRows = valuesRows([
    ...authority.groups.map(({ migration, checksum }) => [migration, checksum]),
    [
      USER_RLS_ENABLE_RELEASE.predecessorMigration,
      USER_RLS_ENABLE_RELEASE.predecessorSha256,
    ],
  ]);

  return `-- Reviewed policyless User ENABLE and zero-direct authority boundary.
-- Apply only through the exact-main, CI-bound Production workflow after the
-- cross-domain convergence migration and compatible deployment are accepted.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.user.rls.activation', 0)
);

LOCK TABLE public."User" IN ACCESS EXCLUSIVE MODE;

DO $grainline_user_enable_preflight$
DECLARE
  table_owner oid;
  runtime_role_oid oid;
  staff_role_oid oid;
  nonowner_table_acl_count integer;
  nonowner_column_acl_count integer;
  accepted_migration_count integer;
  accepted_function_count integer;
  actual_reviewed_function_count integer;
  direct_user_reader_count integer;
  unsafe_direct_user_reader_count integer;
  accepted_index_count integer;
  actual_index_count integer;
  accepted_trigger_count integer;
  actual_trigger_count integer;
  accepted_constraint_count integer;
  actual_constraint_count integer;
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'User ENABLE requires a direct owner session';
  END IF;

  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'User'
     AND class.relkind = 'r';

  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime'
     AND role.rolcanlogin
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND NOT role.rolcreatedb
     AND NOT role.rolcreaterole
     AND NOT role.rolreplication
     AND NOT role.rolbypassrls;

  SELECT role.oid
    INTO STRICT staff_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime'
     AND role.rolcanlogin
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND NOT role.rolcreatedb
     AND NOT role.rolcreaterole
     AND NOT role.rolreplication
     AND NOT role.rolbypassrls;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.member IN (runtime_role_oid, staff_role_oid)
  ) THEN
    RAISE EXCEPTION 'User ENABLE runtime role membership drifted';
  END IF;

  IF table_owner <> (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) THEN
    RAISE EXCEPTION 'User ENABLE table owner drifted';
  END IF;
  IF NOT (
    (
      current_user = 'neondb_owner'
      AND pg_catalog.current_database() = 'neondb'
      AND NOT (
        SELECT role.rolsuper
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
      AND (
        SELECT role.rolbypassrls
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
    )
    OR
    (
      current_user = 'ci'
      AND pg_catalog.current_database() = 'grainline_ci'
      AND (
        SELECT role.rolsuper
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
    )
  ) THEN
    RAISE EXCEPTION 'User ENABLE owner boundary is unreviewed';
  END IF;

  IF (
    SELECT class.relrowsecurity OR class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."User"'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."User"'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'User ENABLE requires policyless RLS-off predecessor';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO nonowner_table_acl_count
    FROM pg_catalog.pg_class AS class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) AS acl
   WHERE class.oid = 'public."User"'::pg_catalog.regclass
     AND acl.grantee <> class.relowner;
  SELECT pg_catalog.count(*)::integer
    INTO nonowner_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid = 'public."User"'::pg_catalog.regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee <> table_owner;
  IF nonowner_table_acl_count <> 4
     OR nonowner_column_acl_count <> 0
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_staff_read_runtime', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE'
     )
     THEN
    RAISE EXCEPTION 'User ENABLE predecessor grants drifted';
  END IF;

  WITH expected(migration_name, checksum) AS (
    VALUES
${ledgerRows}
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_migration_count
    FROM expected
    JOIN public._prisma_migrations AS migration
      ON migration.migration_name = expected.migration_name
     AND migration.checksum = expected.checksum
     AND migration.finished_at IS NOT NULL
     AND migration.rolled_back_at IS NULL
     AND migration.applied_steps_count = 1;
  IF accepted_migration_count <> 17 THEN
    RAISE EXCEPTION 'User ENABLE migration ledger drifted';
  END IF;

  WITH expected(
    function_identity,
    source_md5,
    language_name,
    volatility,
    parallel_safety,
    acl_role
  ) AS (
    VALUES
${functionRows}
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE procedure.prokind = 'f'
     AND procedure.proowner = table_owner
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND language.lanname = expected.language_name
     AND procedure.provolatile = expected.volatility
     AND procedure.proparallel = expected.parallel_safety
     AND COALESCE(procedure.proconfig, ARRAY[]::text[]) =
       ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') = 0
     AND (
       SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee <> procedure.proowner
     ) = CASE WHEN expected.acl_role = '' THEN 0 ELSE 1 END
     AND (
       expected.acl_role = ''
       OR pg_catalog.has_function_privilege(
         expected.acl_role, procedure.oid, 'EXECUTE'
       )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee <> procedure.proowner
          AND (
            expected.acl_role = ''
            OR acl.grantee <> (
              SELECT role.oid
                FROM pg_catalog.pg_roles AS role
               WHERE role.rolname = expected.acl_role
            )
            OR acl.privilege_type <> 'EXECUTE'
            OR acl.is_grantable
          )
     );

  WITH expected(function_identity) AS (
    VALUES
${valuesRows(authority.functions.map((entry) => [`public.${entry.identity}`]))}
  )
  SELECT pg_catalog.count(*)::integer
    INTO actual_reviewed_function_count
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid IN (
     SELECT pg_catalog.to_regprocedure(expected.function_identity)
       FROM expected
   );
  IF accepted_function_count <> 53 OR actual_reviewed_function_count <> 53 THEN
    RAISE EXCEPTION
      'User ENABLE authority catalog drifted: accepted=%, actual=%',
      accepted_function_count,
      actual_reviewed_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(*) FILTER (
           WHERE procedure.prosecdef
         )::integer
    INTO direct_user_reader_count, accepted_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND pg_catalog.strpos(procedure.prosrc, 'public."User"') > 0;
  SELECT pg_catalog.count(*)::integer
    INTO unsafe_direct_user_reader_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND pg_catalog.strpos(procedure.prosrc, 'public."User"') > 0
     AND NOT procedure.prosecdef;
  IF direct_user_reader_count < 53
     OR accepted_function_count <> direct_user_reader_count
     OR unsafe_direct_user_reader_count <> 0 THEN
    RAISE EXCEPTION 'User ENABLE cross-domain reader mode drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = pg_catalog.to_regprocedure(
       'public.grainline_conversation_inbox(text,boolean,text,timestamp without time zone,text,integer)'
     )
       AND NOT procedure.prosecdef
       AND pg_catalog.md5(procedure.prosrc) = '4b2884765f4ca0db432c4678f98b1bdd'
       AND pg_catalog.strpos(procedure.prosrc, 'public."User"') = 0
       AND pg_catalog.has_function_privilege(
         'grainline_app_runtime', procedure.oid, 'EXECUTE'
       )
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = pg_catalog.to_regprocedure(
       'public.grainline_case_resolution_claim_immutable()'
     )
       AND procedure.prosecdef
       AND pg_catalog.md5(procedure.prosrc) = '06289e9db780c559e07188c20e680887'
       AND NOT pg_catalog.has_function_privilege(
         'grainline_app_runtime', procedure.oid, 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'User ENABLE cross-domain convergence drifted';
  END IF;

  WITH expected(index_name, unique_index) AS (
    VALUES
      ('User_pkey', true),
      ('User_clerkId_key', true),
      ('User_email_key', true),
      ('User_deletedAt_idx', false),
      ('User_banned_deletedAt_idx', false),
      ('User_active_email_suppression_key_idx', false)
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_index_count
    FROM expected
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.relname = expected.index_name
    JOIN pg_catalog.pg_index AS index_row
      ON index_row.indexrelid = index_class.oid
   WHERE index_row.indrelid = 'public."User"'::pg_catalog.regclass
     AND index_row.indisunique = expected.unique_index
     AND index_row.indisvalid
     AND index_row.indisready
     AND index_row.indislive;
  SELECT pg_catalog.count(*)::integer
    INTO actual_index_count
    FROM pg_catalog.pg_index AS index_row
   WHERE index_row.indrelid = 'public."User"'::pg_catalog.regclass;
  IF accepted_index_count <> 6 OR actual_index_count <> 6 THEN
    RAISE EXCEPTION 'User ENABLE index posture drifted';
  END IF;

  WITH expected(trigger_name, function_name) AS (
    VALUES
      ('grainline_user_public_seller_state_sync',
       'grainline_user_public_seller_state_sync'),
      ('grainline_user_public_blog_state_sync',
       'grainline_user_public_blog_state_sync'),
      ('grainline_user_public_review_commission_state_sync',
       'grainline_user_public_review_commission_state_sync')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_trigger_count
    FROM expected
    JOIN pg_catalog.pg_trigger AS trigger_row
      ON trigger_row.tgname = expected.trigger_name
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger_row.tgfoid
   WHERE trigger_row.tgrelid = 'public."User"'::pg_catalog.regclass
     AND NOT trigger_row.tgisinternal
     AND trigger_row.tgenabled = 'O'
     AND procedure.proname = expected.function_name;
  SELECT pg_catalog.count(*)::integer
    INTO actual_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_row
   WHERE trigger_row.tgrelid = 'public."User"'::pg_catalog.regclass
     AND NOT trigger_row.tgisinternal;
  IF accepted_trigger_count <> 3 OR actual_trigger_count <> 3 THEN
    RAISE EXCEPTION 'User ENABLE trigger posture drifted';
  END IF;

  WITH expected(constraint_name, constraint_type) AS (
    VALUES
      ('User_pkey', 'p'::"char"),
      ('User_notificationPreferences_shape_chk', 'c'::"char"),
      ('User_notificationPreferences_size_chk', 'c'::"char")
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_constraint_count
    FROM expected
    JOIN pg_catalog.pg_constraint AS constraint_row
      ON constraint_row.conname = expected.constraint_name
   WHERE constraint_row.conrelid = 'public."User"'::pg_catalog.regclass
     AND constraint_row.contype = expected.constraint_type
     AND constraint_row.convalidated;
  SELECT pg_catalog.count(*)::integer
    INTO actual_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public."User"'::pg_catalog.regclass;
  IF accepted_constraint_count <> 3 OR actual_constraint_count <> 3 THEN
    RAISE EXCEPTION 'User ENABLE constraint posture drifted';
  END IF;
END
$grainline_user_enable_preflight$;

REVOKE ALL PRIVILEGES ON TABLE public."User"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User" NO FORCE ROW LEVEL SECURITY;

DO $grainline_user_enable_postflight$
DECLARE
  table_owner oid;
  nonowner_table_acl_count integer;
  nonowner_column_acl_count integer;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."User"'::pg_catalog.regclass;
  SELECT pg_catalog.count(*)::integer
    INTO nonowner_table_acl_count
    FROM pg_catalog.pg_class AS class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) AS acl
   WHERE class.oid = 'public."User"'::pg_catalog.regclass
     AND acl.grantee <> class.relowner;
  SELECT pg_catalog.count(*)::integer
    INTO nonowner_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid = 'public."User"'::pg_catalog.regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee <> table_owner;
  IF NOT (
    SELECT class.relrowsecurity AND NOT class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."User"'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."User"'::pg_catalog.regclass
  ) OR nonowner_table_acl_count <> 0
     OR nonowner_column_acl_count <> 0
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_staff_read_runtime', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE'
     )
     THEN
    RAISE EXCEPTION 'User ENABLE postflight did not reach policyless zero-direct state';
  END IF;
END
$grainline_user_enable_postflight$;

COMMIT;
`;
}

export function verifyCommittedUserRlsEnableMigration(root = process.cwd()) {
  const expected = buildUserRlsEnableMigration(root);
  const migrationPath = path.join(root, USER_RLS_ENABLE_RELEASE.migrationPath);
  const actual = readFileSync(migrationPath, "utf8");
  assert.equal(actual, expected, "committed User ENABLE migration is not generated exactly");
  return Object.freeze({
    migrationName: USER_RLS_ENABLE_RELEASE.migrationName,
    migrationPath: USER_RLS_ENABLE_RELEASE.migrationPath,
    migrationSha256: sha256(actual),
    functionCount: 53,
    runtimeFunctionCount: 34,
    staffFunctionCount: 9,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2] ?? "--verify";
  if (!["--write", "--verify"].includes(command) || process.argv.length > 3) {
    throw new Error("usage: build-user-rls-enable-candidate.mjs [--write|--verify]");
  }
  if (command === "--write") {
    const migrationPath = path.join(process.cwd(), USER_RLS_ENABLE_RELEASE.migrationPath);
    mkdirSync(path.dirname(migrationPath), { recursive: true });
    writeFileSync(migrationPath, buildUserRlsEnableMigration(), "utf8");
  }
  process.stdout.write(`${JSON.stringify(verifyCommittedUserRlsEnableMigration())}\n`);
}
