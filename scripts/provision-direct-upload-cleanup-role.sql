-- Grainline DirectUpload cleanup-worker least-privilege convergence.
--
-- This script does not create a role or set a password. Create the reviewed
-- LOGIN role and store its connection URL outside Vercel first, then run:
--
--   psql "$DIRECT_URL" \
--     -v cleanup_role=grainline_direct_upload_cleanup \
--     -v runtime_role=grainline_app_runtime \
--     -v migration_role=neondb_owner \
--     -f scripts/provision-direct-upload-cleanup-role.sql

\set ON_ERROR_STOP on

\if :{?cleanup_role}
\else
\echo 'missing required psql variable: -v cleanup_role=grainline_direct_upload_cleanup'
DO $grainline_cleanup_role_abort$
BEGIN
  RAISE EXCEPTION 'cleanup-role provisioning refused';
END
$grainline_cleanup_role_abort$;
\endif

\if :{?runtime_role}
\else
\echo 'missing required psql variable: -v runtime_role=grainline_app_runtime'
DO $grainline_cleanup_role_abort$
BEGIN
  RAISE EXCEPTION 'cleanup-role provisioning refused';
END
$grainline_cleanup_role_abort$;
\endif

\if :{?migration_role}
\else
\echo 'missing required psql variable: -v migration_role=neondb_owner'
DO $grainline_cleanup_role_abort$
BEGIN
  RAISE EXCEPTION 'cleanup-role provisioning refused';
END
$grainline_cleanup_role_abort$;
\endif

WITH failure AS (
  SELECT format(
    'expected current_user and session_user to equal migration role %s, got current_user=%s session_user=%s',
    :'migration_role',
    current_user,
    session_user
  ) AS message
  WHERE current_user <> :'migration_role'
     OR session_user <> :'migration_role'
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_cleanup_role_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_cleanup_role_failure;
\gset
\if :grainline_cleanup_role_failed
\echo :grainline_cleanup_role_failure
DO $grainline_cleanup_role_abort$
BEGIN
  RAISE EXCEPTION 'cleanup-role provisioning refused';
END
$grainline_cleanup_role_abort$;
\endif
\unset grainline_cleanup_role_failed
\unset grainline_cleanup_role_failure

WITH required_role(role_name) AS (
  VALUES
    (:'cleanup_role'),
    (:'runtime_role'),
    (:'migration_role')
), missing AS (
  SELECT required_role.role_name
    FROM required_role
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = required_role.role_name
   )
), failure AS (
  SELECT format('required role does not exist: %s', role_name) AS message
    FROM missing
   ORDER BY role_name
   LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_cleanup_role_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_cleanup_role_failure;
\gset
\if :grainline_cleanup_role_failed
\echo :grainline_cleanup_role_failure
DO $grainline_cleanup_role_abort$
BEGIN
  RAISE EXCEPTION 'cleanup-role provisioning refused';
END
$grainline_cleanup_role_abort$;
\endif
\unset grainline_cleanup_role_failed
\unset grainline_cleanup_role_failure

WITH failure AS (
  SELECT 'cleanup, runtime, and migration roles must be pairwise distinct'
    AS message
  WHERE :'cleanup_role' IN (:'runtime_role', :'migration_role')
     OR :'runtime_role' = :'migration_role'
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_cleanup_role_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_cleanup_role_failure;
\gset
\if :grainline_cleanup_role_failed
\echo :grainline_cleanup_role_failure
DO $grainline_cleanup_role_abort$
BEGIN
  RAISE EXCEPTION 'cleanup-role provisioning refused';
END
$grainline_cleanup_role_abort$;
\endif
\unset grainline_cleanup_role_failed
\unset grainline_cleanup_role_failure

BEGIN;

-- The provider creates the LOGIN and password. The migration owner is not a
-- PostgreSQL superuser, so it cannot safely "converge" SUPERUSER,
-- REPLICATION or BYPASSRLS attributes even when setting their false forms.
-- Require the provider-created role to arrive with the exact posture instead.
WITH cleanup_role AS (
  SELECT
    role.rolname,
    role.rolsuper,
    role.rolcreatedb,
    role.rolcreaterole,
    role.rolinherit,
    role.rolcanlogin,
    role.rolreplication,
    role.rolbypassrls
  FROM pg_catalog.pg_roles AS role
  WHERE role.rolname = :'cleanup_role'
), failure AS (
  SELECT format(
    'cleanup role %s does not have the reviewed provider-created attributes',
    :'cleanup_role'
  ) AS message
  FROM cleanup_role
  WHERE rolsuper
     OR rolcreatedb
     OR rolcreaterole
     OR rolinherit
     OR NOT rolcanlogin
     OR rolreplication
     OR rolbypassrls
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_cleanup_role_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_cleanup_role_failure;
\gset
\if :grainline_cleanup_role_failed
\echo :grainline_cleanup_role_failure
DO $grainline_cleanup_role_abort$
BEGIN
  RAISE EXCEPTION 'cleanup-role provisioning refused';
END
$grainline_cleanup_role_abort$;
\endif
\unset grainline_cleanup_role_failed
\unset grainline_cleanup_role_failure

WITH RECURSIVE memberships AS (
  SELECT parent.oid, parent.rolname
    FROM pg_catalog.pg_auth_members AS edge
    JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
    JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
   WHERE child.rolname = :'cleanup_role'
  UNION
  SELECT parent.oid, parent.rolname
    FROM memberships AS child
    JOIN pg_catalog.pg_auth_members AS edge ON edge.member = child.oid
    JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
), failure AS (
  SELECT format(
    'cleanup role %s is a member of role %s',
    :'cleanup_role',
    rolname
  ) AS message
    FROM memberships
   ORDER BY rolname
   LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_cleanup_role_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_cleanup_role_failure;
\gset
\if :grainline_cleanup_role_failed
\echo :grainline_cleanup_role_failure
DO $grainline_cleanup_role_abort$
BEGIN
  RAISE EXCEPTION 'cleanup-role provisioning refused';
END
$grainline_cleanup_role_abort$;
\endif
\unset grainline_cleanup_role_failed
\unset grainline_cleanup_role_failure

WITH RECURSIVE members AS (
  SELECT child.oid, child.rolname
    FROM pg_catalog.pg_auth_members AS edge
    JOIN pg_catalog.pg_roles AS parent ON parent.oid = edge.roleid
    JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
   WHERE parent.rolname = :'cleanup_role'
  UNION
  SELECT child.oid, child.rolname
    FROM members AS parent
    JOIN pg_catalog.pg_auth_members AS edge ON edge.roleid = parent.oid
    JOIN pg_catalog.pg_roles AS child ON child.oid = edge.member
), failure AS (
  SELECT format(
    'role %s is a member of cleanup role %s',
    rolname,
    :'cleanup_role'
  ) AS message
    FROM members
   ORDER BY rolname
   LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_cleanup_role_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_cleanup_role_failure;
\gset
\if :grainline_cleanup_role_failed
\echo :grainline_cleanup_role_failure
DO $grainline_cleanup_role_abort$
BEGIN
  RAISE EXCEPTION 'cleanup-role provisioning refused';
END
$grainline_cleanup_role_abort$;
\endif
\unset grainline_cleanup_role_failed
\unset grainline_cleanup_role_failure

GRANT USAGE ON SCHEMA public TO :"cleanup_role";
REVOKE CREATE ON SCHEMA public FROM :"cleanup_role";
SELECT format(
  'REVOKE CREATE ON DATABASE %I FROM %I',
  current_database(),
  :'cleanup_role'
);
\gexec

WITH column_grants AS (
  SELECT
    namespace.nspname,
    class.relname,
    pg_catalog.upper(acl.privilege_type) AS privilege_type,
    pg_catalog.string_agg(
      pg_catalog.format('%I', attribute.attname),
      ', ' ORDER BY attribute.attnum
    ) AS columns
  FROM pg_catalog.pg_class AS class
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = class.relnamespace
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = class.oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  WHERE namespace.nspname = 'public'
    AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND acl.grantee = (
      SELECT oid
        FROM pg_catalog.pg_roles
       WHERE rolname = :'cleanup_role'
    )
  GROUP BY
    namespace.nspname,
    class.relname,
    pg_catalog.upper(acl.privilege_type)
)
SELECT format(
  'REVOKE %s (%s) ON TABLE %I.%I FROM %I',
  privilege_type,
  columns,
  nspname,
  relname,
  :'cleanup_role'
)
  FROM column_grants
 ORDER BY nspname, relname, privilege_type;
\gexec

SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
  :'cleanup_role'
);
\gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
  :'cleanup_role'
);
\gexec
SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I',
  :'cleanup_role'
);
\gexec

WITH cleanup_function(function_signature) AS (
  VALUES
    ('public."grainline_direct_upload_cleanup_lease"(integer)'),
    ('public."grainline_direct_upload_cleanup_complete"(text, text)'),
    ('public."grainline_direct_upload_cleanup_fail"(text, text, text)')
), failure AS (
  SELECT format('cleanup function is missing: %s', function_signature)
    AS message
    FROM cleanup_function
   WHERE pg_catalog.to_regprocedure(function_signature) IS NULL
   ORDER BY function_signature
   LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_cleanup_role_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_cleanup_role_failure;
\gset
\if :grainline_cleanup_role_failed
\echo :grainline_cleanup_role_failure
DO $grainline_cleanup_role_abort$
BEGIN
  RAISE EXCEPTION 'cleanup-role provisioning refused';
END
$grainline_cleanup_role_abort$;
\endif
\unset grainline_cleanup_role_failed
\unset grainline_cleanup_role_failure

GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_cleanup_lease(integer)
  TO :"cleanup_role";
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_cleanup_complete(text, text)
  TO :"cleanup_role";
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_cleanup_fail(text, text, text)
  TO :"cleanup_role";

WITH table_authority AS (
  SELECT class.relname
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND CASE
       -- PostgreSQL may reorder WHERE predicates. Keep the catalog-kind
       -- check inside CASE so privilege helpers never receive a TOAST/index
       -- relation before the relkind filter has logically run.
       WHEN class.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
         pg_catalog.has_table_privilege(
           :'cleanup_role',
           class.oid,
           'SELECT,INSERT,UPDATE,DELETE,REFERENCES'
         )
       ELSE false
     END
), table_administrative_authority AS (
  SELECT class.relname
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relkind IN ('r', 'p')
     AND CASE
       WHEN class.relkind IN ('r', 'p') THEN
         pg_catalog.has_table_privilege(
           :'cleanup_role',
           class.oid,
           'TRUNCATE,TRIGGER'
         )
       ELSE false
     END
), column_authority AS (
  SELECT class.relname, attribute.attname
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = class.oid
   WHERE namespace.nspname = 'public'
     AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND CASE
       WHEN class.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
         pg_catalog.has_column_privilege(
           :'cleanup_role',
           class.oid,
           attribute.attnum,
           'SELECT,INSERT,UPDATE,REFERENCES'
         )
       ELSE false
     END
), sequence_authority AS (
  SELECT class.relname
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relkind = 'S'
     AND CASE
       WHEN class.relkind = 'S' THEN
         pg_catalog.has_sequence_privilege(
           :'cleanup_role',
           class.oid,
           'USAGE,SELECT,UPDATE'
         )
       ELSE false
     END
), direct_upload_function_authority AS (
  SELECT procedure.proname
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname LIKE 'grainline\_direct\_upload\_%' ESCAPE '\'
     AND pg_catalog.has_function_privilege(
       :'cleanup_role',
       procedure.oid,
       'EXECUTE'
     )
), unexpected_function_authority AS (
  SELECT pg_catalog.format(
           '%I.%I(%s)',
           namespace.nspname,
           procedure.proname,
           pg_catalog.pg_get_function_identity_arguments(procedure.oid)
         ) AS function_signature
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND pg_catalog.has_function_privilege(
       :'cleanup_role',
       procedure.oid,
       'EXECUTE'
     )
     AND procedure.prosecdef
     AND procedure.proname NOT IN (
       'grainline_direct_upload_cleanup_lease',
       'grainline_direct_upload_cleanup_complete',
       'grainline_direct_upload_cleanup_fail'
     )
), default_authority AS (
  SELECT defaults.oid
    FROM pg_catalog.pg_default_acl AS defaults
    CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
   WHERE acl.grantee = (
     SELECT oid
       FROM pg_catalog.pg_roles
      WHERE rolname = :'cleanup_role'
   )
), expected_function(function_name) AS (
  VALUES
    ('grainline_direct_upload_cleanup_lease'),
    ('grainline_direct_upload_cleanup_complete'),
    ('grainline_direct_upload_cleanup_fail')
), failure AS (
  SELECT 'cleanup role retains effective table authority' AS message
   WHERE EXISTS (SELECT 1 FROM table_authority)
      OR EXISTS (SELECT 1 FROM table_administrative_authority)
  UNION ALL
  SELECT 'cleanup role retains effective column authority'
   WHERE EXISTS (SELECT 1 FROM column_authority)
  UNION ALL
  SELECT 'cleanup role retains effective sequence authority'
   WHERE EXISTS (SELECT 1 FROM sequence_authority)
  UNION ALL
  SELECT pg_catalog.format(
           'cleanup role retains unexpected privileged function authority: %s',
           (
             SELECT function_signature
               FROM unexpected_function_authority
              ORDER BY function_signature
              LIMIT 1
           )
         )
   WHERE EXISTS (SELECT 1 FROM unexpected_function_authority)
  UNION ALL
  SELECT 'cleanup role retains default privilege grants'
   WHERE EXISTS (SELECT 1 FROM default_authority)
  UNION ALL
  SELECT 'cleanup role DirectUpload function authority is not exact'
   WHERE EXISTS (
     SELECT function_name FROM expected_function
     EXCEPT
     SELECT proname FROM direct_upload_function_authority
   )
      OR EXISTS (
     SELECT proname FROM direct_upload_function_authority
     EXCEPT
     SELECT function_name FROM expected_function
   )
  LIMIT 1
)
SELECT
  EXISTS (SELECT 1 FROM failure) AS grainline_cleanup_role_failed,
  COALESCE((SELECT message FROM failure LIMIT 1), '')
    AS grainline_cleanup_role_failure;
\gset
\if :grainline_cleanup_role_failed
\echo :grainline_cleanup_role_failure
DO $grainline_cleanup_role_abort$
BEGIN
  RAISE EXCEPTION 'cleanup-role provisioning refused';
END
$grainline_cleanup_role_abort$;
\endif
\unset grainline_cleanup_role_failed
\unset grainline_cleanup_role_failure

COMMIT;
