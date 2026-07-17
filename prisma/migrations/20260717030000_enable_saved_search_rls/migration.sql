BEGIN;

-- Bound catalog-lock waits so a busy production table fails the deployment
-- cleanly instead of stalling application traffic.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- SavedSearch is the first production table protected by user-context RLS.
-- Fail closed before creating policies: PostgreSQL combines permissive
-- policies with OR, so applying this migration over an unreviewed policy set
-- could otherwise widen access.
DO $grainline_saved_search_rls$
DECLARE
  runtime_oid oid;
  runtime_super boolean;
  runtime_createdb boolean;
  runtime_createrole boolean;
  runtime_inherit boolean;
  runtime_login boolean;
  runtime_replication boolean;
  runtime_bypass boolean;
  saved_search_oid oid;
  saved_search_owner_oid oid;
  saved_search_rls_enabled boolean;
  saved_search_rls_forced boolean;
  current_role_oid oid;
BEGIN
  SELECT
      oid,
      rolsuper,
      rolcreatedb,
      rolcreaterole,
      rolinherit,
      rolcanlogin,
      rolreplication,
      rolbypassrls
    INTO
      runtime_oid,
      runtime_super,
      runtime_createdb,
      runtime_createrole,
      runtime_inherit,
      runtime_login,
      runtime_replication,
      runtime_bypass
    FROM pg_roles
   WHERE rolname = 'grainline_app_runtime';

  IF runtime_oid IS NULL THEN
    RAISE EXCEPTION 'grainline_app_runtime must exist before the SavedSearch RLS migration';
  END IF;

  IF runtime_super
     OR runtime_createdb
     OR runtime_createrole
     OR runtime_inherit
     OR runtime_replication
     OR runtime_bypass THEN
    RAISE EXCEPTION
      'grainline_app_runtime must be NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
  END IF;

  -- The real staging/production principal must be a LOGIN role. Fresh CI uses
  -- an intentionally narrower NOLOGIN policy target until all migrations have
  -- completed, then the production provisioning script converges it to LOGIN
  -- and the final catalog audit verifies that posture. Keep the exception tied
  -- to both immutable CI database identities so a production NOLOGIN role
  -- cannot pass this migration accidentally.
  IF NOT runtime_login
     AND NOT (current_database() = 'grainline_ci' AND current_user = 'ci') THEN
    RAISE EXCEPTION
      'grainline_app_runtime must be LOGIN outside the guarded grainline_ci/ci migration fixture';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_auth_members
     WHERE member = runtime_oid
  ) THEN
    RAISE EXCEPTION 'grainline_app_runtime must be membership-free';
  END IF;

  SELECT c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity
    INTO
      saved_search_oid,
      saved_search_owner_oid,
      saved_search_rls_enabled,
      saved_search_rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'SavedSearch'
     AND c.relkind IN ('r', 'p');

  IF saved_search_oid IS NULL THEN
    RAISE EXCEPTION 'public."SavedSearch" does not exist';
  END IF;

  SELECT oid
    INTO current_role_oid
    FROM pg_roles
   WHERE rolname = current_user;

  IF saved_search_owner_oid = runtime_oid THEN
    RAISE EXCEPTION 'grainline_app_runtime must not own public."SavedSearch"';
  END IF;

  IF saved_search_owner_oid <> current_role_oid THEN
    RAISE EXCEPTION 'the SavedSearch RLS migration must run as the public."SavedSearch" owner';
  END IF;

  IF saved_search_rls_enabled OR saved_search_rls_forced THEN
    RAISE EXCEPTION 'public."SavedSearch" must begin the phase-A migration with RLS and FORCE disabled';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policy
     WHERE polrelid = saved_search_oid
  ) THEN
    RAISE EXCEPTION 'public."SavedSearch" already has policies; review them before adding a permissive policy';
  END IF;

  IF NOT has_schema_privilege('grainline_app_runtime', 'public', 'USAGE')
     OR NOT has_table_privilege('grainline_app_runtime', 'public."SavedSearch"', 'SELECT')
     OR NOT has_table_privilege('grainline_app_runtime', 'public."SavedSearch"', 'INSERT')
     OR NOT has_table_privilege('grainline_app_runtime', 'public."SavedSearch"', 'UPDATE')
     OR NOT has_table_privilege('grainline_app_runtime', 'public."SavedSearch"', 'DELETE') THEN
    RAISE EXCEPTION 'grainline_app_runtime grants must be provisioned before the SavedSearch RLS migration';
  END IF;

  IF (
    SELECT COALESCE(
      array_agg(
        DISTINCT upper(acl.privilege_type)
        ORDER BY upper(acl.privilege_type)
      ),
      ARRAY[]::text[]
    )
      FROM aclexplode(
        COALESCE(
          (SELECT relacl FROM pg_class WHERE oid = saved_search_oid),
          acldefault('r', saved_search_owner_oid)
        )
      ) AS acl
     WHERE acl.grantee = runtime_oid
  ) IS DISTINCT FROM ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]
     OR EXISTS (
       SELECT 1
         FROM aclexplode(
           COALESCE(
             (SELECT relacl FROM pg_class WHERE oid = saved_search_oid),
             acldefault('r', saved_search_owner_oid)
           )
         ) AS acl
        WHERE acl.grantee = runtime_oid
          AND acl.is_grantable
     ) THEN
    RAISE EXCEPTION 'grainline_app_runtime must have exactly direct non-grantable SELECT/INSERT/UPDATE/DELETE on public."SavedSearch"';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM aclexplode(
        COALESCE(
          (SELECT relacl FROM pg_class WHERE oid = saved_search_oid),
          acldefault('r', saved_search_owner_oid)
        )
      ) AS acl
     WHERE acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC must have no table privileges on public."SavedSearch"';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_attribute a
      CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
     WHERE a.attrelid = saved_search_oid
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND acl.grantee = runtime_oid
  ) THEN
    RAISE EXCEPTION 'grainline_app_runtime must have no column privileges on public."SavedSearch"';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_attribute a
      CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
     WHERE a.attrelid = saved_search_oid
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC must have no column privileges on public."SavedSearch"';
  END IF;
END
$grainline_saved_search_rls$;

CREATE POLICY "saved_search_owner_select"
  ON public."SavedSearch"
  AS PERMISSIVE
  FOR SELECT
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(current_setting('app.user_id', true), '')
  );

CREATE POLICY "saved_search_owner_insert"
  ON public."SavedSearch"
  AS PERMISSIVE
  FOR INSERT
  TO grainline_app_runtime
  WITH CHECK (
    "userId" = NULLIF(current_setting('app.user_id', true), '')
  );

CREATE POLICY "saved_search_owner_delete"
  ON public."SavedSearch"
  AS PERMISSIVE
  FOR DELETE
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(current_setting('app.user_id', true), '')
  );

-- Phase A intentionally protects the non-owner runtime role without forcing
-- the table owner yet. Vercel skew protection can continue routing old clients
-- to the previous owner-backed deployment for up to 12 hours. A separate,
-- later migration may FORCE RLS only after that window plus a safety margin and
-- after owner-backed application sessions have drained.
ALTER TABLE public."SavedSearch" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SavedSearch" ENABLE ROW LEVEL SECURITY;

COMMIT;
