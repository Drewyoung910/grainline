BEGIN;

-- Phase B runs only after the full Vercel skew window, migration-owner
-- credential rotation, and independent owner-session drain proof. Keep the
-- lock bounded so an unexpected busy table fails the deployment cleanly.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $grainline_saved_search_force_rls$
DECLARE
  runtime_oid oid;
  saved_search_oid oid;
  saved_search_owner_oid oid;
  current_role_oid oid;
  saved_search_rls_enabled boolean;
  saved_search_rls_forced boolean;
  owner_session_count integer;
BEGIN
  SELECT oid
    INTO runtime_oid
    FROM pg_roles
   WHERE rolname = 'grainline_app_runtime'
     AND NOT rolsuper
     AND NOT rolcreatedb
     AND NOT rolcreaterole
     AND NOT rolinherit
     AND rolcanlogin
     AND NOT rolreplication
     AND NOT rolbypassrls;

  IF runtime_oid IS NULL THEN
    RAISE EXCEPTION 'grainline_app_runtime is missing or its reviewed role attributes drifted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members WHERE member = runtime_oid
  ) THEN
    RAISE EXCEPTION 'grainline_app_runtime must remain membership-free';
  END IF;

  SELECT c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity
    INTO saved_search_oid, saved_search_owner_oid,
         saved_search_rls_enabled, saved_search_rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'SavedSearch'
     AND c.relkind IN ('r', 'p');

  IF saved_search_oid IS NULL THEN
    RAISE EXCEPTION 'public."SavedSearch" does not exist';
  END IF;

  SELECT oid INTO current_role_oid FROM pg_roles WHERE rolname = current_user;
  IF saved_search_owner_oid <> current_role_oid
     OR NOT (
       (current_user = 'neondb_owner' AND session_user = 'neondb_owner')
       OR (
         current_database() = 'grainline_ci'
         AND current_user = 'ci'
         AND session_user = 'ci'
       )
     ) THEN
    RAISE EXCEPTION 'the SavedSearch FORCE migration must run as its reviewed owner neondb_owner';
  END IF;

  IF saved_search_owner_oid = runtime_oid THEN
    RAISE EXCEPTION 'grainline_app_runtime must not own public."SavedSearch"';
  END IF;

  IF NOT saved_search_rls_enabled OR saved_search_rls_forced THEN
    RAISE EXCEPTION 'public."SavedSearch" must begin phase B with ENABLE and NO FORCE';
  END IF;

  IF (
    SELECT COUNT(*)
      FROM pg_policy
     WHERE polrelid = saved_search_oid
  ) <> 3 THEN
    RAISE EXCEPTION 'public."SavedSearch" must have exactly three reviewed policies before FORCE';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policy p
     WHERE p.polrelid = saved_search_oid
       AND NOT (
         p.polname = 'saved_search_owner_select'
         AND p.polcmd = 'r'
         AND p.polpermissive
         AND p.polroles = ARRAY[runtime_oid]
         AND pg_get_expr(p.polqual, p.polrelid) =
           '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'
         AND p.polwithcheck IS NULL
       )
       AND NOT (
         p.polname = 'saved_search_owner_insert'
         AND p.polcmd = 'a'
         AND p.polpermissive
         AND p.polroles = ARRAY[runtime_oid]
         AND p.polqual IS NULL
         AND pg_get_expr(p.polwithcheck, p.polrelid) =
           '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'
       )
       AND NOT (
         p.polname = 'saved_search_owner_delete'
         AND p.polcmd = 'd'
         AND p.polpermissive
         AND p.polroles = ARRAY[runtime_oid]
         AND pg_get_expr(p.polqual, p.polrelid) =
           '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'
         AND p.polwithcheck IS NULL
       )
  ) THEN
    RAISE EXCEPTION 'public."SavedSearch" policies drifted from the exact reviewed phase-A definitions';
  END IF;

  IF (
    SELECT COALESCE(
      array_agg(DISTINCT upper(acl.privilege_type)
                ORDER BY upper(acl.privilege_type)),
      ARRAY[]::text[]
    )
      FROM aclexplode(
        COALESCE(
          (SELECT relacl FROM pg_class WHERE oid = saved_search_oid),
          acldefault('r', saved_search_owner_oid)
        )
      ) AS acl
     WHERE acl.grantee = runtime_oid
  ) IS DISTINCT FROM ARRAY['DELETE', 'INSERT', 'SELECT']::text[]
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
    RAISE EXCEPTION 'grainline_app_runtime must retain exact non-grantable SELECT/INSERT/DELETE privileges';
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
  ) OR EXISTS (
    SELECT 1
      FROM pg_attribute a
      CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
     WHERE a.attrelid = saved_search_oid
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND acl.grantee IN (0, runtime_oid)
  ) THEN
    RAISE EXCEPTION 'SavedSearch PUBLIC/runtime ACLs drifted from the reviewed table-only grants';
  END IF;

  SELECT COUNT(*)::integer
    INTO owner_session_count
    FROM pg_stat_activity
   WHERE datname = current_database()
     AND usename = current_user
     AND backend_type = 'client backend'
     AND pid <> pg_backend_pid();

  IF owner_session_count <> 0 THEN
    RAISE EXCEPTION 'owner-backed application session drain is incomplete: % other owner sessions remain', owner_session_count;
  END IF;
END
$grainline_saved_search_force_rls$;

ALTER TABLE public."SavedSearch" FORCE ROW LEVEL SECURITY;

DO $grainline_saved_search_force_verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'SavedSearch'
       AND c.relrowsecurity
       AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'public."SavedSearch" FORCE ROW LEVEL SECURITY did not persist';
  END IF;
END
$grainline_saved_search_force_verify$;

COMMIT;
