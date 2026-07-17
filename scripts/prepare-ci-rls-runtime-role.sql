-- CI-only prerequisite for fresh-database migration tests.
--
-- Production and staging runtime roles are provisioned separately with
-- externally managed credentials. This script intentionally creates a
-- NOLOGIN policy target only inside the ephemeral Grainline CI database so
-- fail-closed RLS migrations can be exercised from a blank database. After
-- migration, CI runs the production provisioning script, which converges this
-- passwordless ephemeral role to LOGIN NOINHERIT before the final grant audit.

\set ON_ERROR_STOP on

DO $grainline_ci_guard$
BEGIN
  IF current_database() <> 'grainline_ci' OR current_user <> 'ci' THEN
    RAISE EXCEPTION
      'prepare-ci-rls-runtime-role.sql may run only as ci on grainline_ci';
  END IF;
END
$grainline_ci_guard$;

DO $grainline_ci_runtime_role$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_roles
     WHERE rolname = 'grainline_app_runtime'
  ) THEN
    CREATE ROLE grainline_app_runtime
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$grainline_ci_runtime_role$;

-- Make reruns converge to the reviewed least-privilege policy-role shape.
ALTER ROLE grainline_app_runtime
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;

DO $grainline_ci_runtime_memberships$
DECLARE
  parent_role text;
BEGIN
  FOR parent_role IN
    SELECT parent.rolname
      FROM pg_auth_members membership
      JOIN pg_roles child ON child.oid = membership.member
      JOIN pg_roles parent ON parent.oid = membership.roleid
     WHERE child.rolname = 'grainline_app_runtime'
  LOOP
    EXECUTE format(
      'REVOKE %I FROM grainline_app_runtime',
      parent_role
    );
  END LOOP;
END
$grainline_ci_runtime_memberships$;

GRANT USAGE ON SCHEMA public TO grainline_app_runtime;
REVOKE CREATE ON SCHEMA public FROM grainline_app_runtime;
REVOKE CREATE ON DATABASE grainline_ci FROM grainline_app_runtime;

-- Prisma migrations in CI run as the current `ci` owner. Set its defaults
-- before the first table is created so SavedSearch has the grants required by
-- the migration's fail-closed preflight.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO grainline_app_runtime;
