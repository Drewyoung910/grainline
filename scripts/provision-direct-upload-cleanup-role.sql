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

SELECT format(
  'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'cleanup_role'
);
\gexec

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
    AND class.relkind IN ('r', 'p')
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
     AND class.relkind IN ('r', 'p')
     AND pg_catalog.has_table_privilege(
       :'cleanup_role',
       class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
), sequence_authority AS (
  SELECT class.relname
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relkind = 'S'
     AND pg_catalog.has_sequence_privilege(
       :'cleanup_role',
       class.oid,
       'USAGE,SELECT,UPDATE'
     )
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
), expected_function(function_name) AS (
  VALUES
    ('grainline_direct_upload_cleanup_lease'),
    ('grainline_direct_upload_cleanup_complete'),
    ('grainline_direct_upload_cleanup_fail')
), failure AS (
  SELECT 'cleanup role retains effective table authority' AS message
   WHERE EXISTS (SELECT 1 FROM table_authority)
  UNION ALL
  SELECT 'cleanup role retains effective sequence authority'
   WHERE EXISTS (SELECT 1 FROM sequence_authority)
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
