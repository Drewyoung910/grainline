-- Disposable PostgreSQL 16 role-membership fixture for the DirectUpload
-- failed-migration recovery proof. Never run against a persistent database.

\set ON_ERROR_STOP on

DO $grainline_direct_upload_recovery_fixture_guard$
BEGIN
  IF current_database() <> 'grainline_ci' OR current_user <> 'cloud_admin' THEN
    RAISE EXCEPTION
      'DirectUpload recovery role fixture may run only as cloud_admin on grainline_ci';
  END IF;
END
$grainline_direct_upload_recovery_fixture_guard$;

DO $grainline_direct_upload_recovery_provider_roles$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'ci'
  ) THEN
    CREATE ROLE ci
      LOGIN SUPERUSER CREATEDB CREATEROLE INHERIT NOREPLICATION BYPASSRLS
      PASSWORD 'ci';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE rolname = 'grainline_direct_upload_cleanup_v2'
  ) THEN
    CREATE ROLE grainline_direct_upload_cleanup_v2
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
      NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'neondb_owner'
  ) THEN
    CREATE ROLE neondb_owner
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
      NOREPLICATION NOBYPASSRLS;
  END IF;
END
$grainline_direct_upload_recovery_provider_roles$;

-- This disposable cluster starts with cloud_admin as PostgreSQL's bootstrap
-- superuser. PostgreSQL therefore records the same provider grantor identity
-- that Neon records, without adding a second membership dependency.
GRANT grainline_direct_upload_cleanup_v2 TO neondb_owner
  WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;

DO $grainline_direct_upload_recovery_fixture_postflight$
DECLARE
  matching_edges integer;
  touching_edges integer;
BEGIN
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE granted_role.rolname = 'grainline_direct_upload_cleanup_v2'
        AND member.rolname = 'neondb_owner'
        AND grantor.rolname = 'cloud_admin'
        AND membership.admin_option
        AND NOT membership.inherit_option
        AND NOT membership.set_option
    )::integer,
    pg_catalog.count(*)::integer
    INTO matching_edges, touching_edges
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member
      ON member.oid = membership.member
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS grantor
      ON grantor.oid = membership.grantor
   WHERE member.rolname IN (
           'grainline_app_runtime',
           'grainline_direct_upload_cleanup_v2'
         )
      OR granted_role.rolname IN (
           'grainline_app_runtime',
           'grainline_direct_upload_cleanup_v2'
         );
  IF matching_edges <> 1 OR touching_edges <> 1 THEN
    RAISE EXCEPTION
      'DirectUpload recovery role fixture membership is not exact';
  END IF;
END
$grainline_direct_upload_recovery_fixture_postflight$;
