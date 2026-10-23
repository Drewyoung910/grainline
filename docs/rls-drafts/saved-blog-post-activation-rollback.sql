-- Database-first emergency rollback for the combined SavedBlogPost
-- ENABLE/FORCE activation. Run only after the predecessor application is live.
-- The transaction restores its exact CRUD table authority before disabling
-- RLS, then removes only the activation's policies and insert guard.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.saved-blog-post.rls.activation', 0)
);

LOCK TABLE public."SavedBlogPost" IN ACCESS EXCLUSIVE MODE;

DO $grainline_saved_blog_post_rollback_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  guard_oid oid;
  runtime_privileges text[];
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SavedBlogPost'
     AND class.relkind = 'r';
  IF runtime_oid IS NULL OR table_oid IS NULL OR current_user <> session_user
     OR table_owner IS DISTINCT FROM (
       SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user
     ) THEN
    RAISE EXCEPTION 'SavedBlogPost rollback identity drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND relrowsecurity
       AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost rollback requires ENABLE plus FORCE';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             policy.polname::text ORDER BY policy.polname
           )
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) IS DISTINCT FROM ARRAY[
    'saved_blog_post_owner_delete',
    'saved_blog_post_owner_insert',
    'saved_blog_post_owner_select'
  ]::text[] OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
       AND (
         NOT policy.polpermissive
         OR policy.polroles IS DISTINCT FROM ARRAY[runtime_oid]::oid[]
         OR (policy.polname = 'saved_blog_post_owner_select'
             AND (policy.polcmd <> 'r'
                  OR pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
                     <> '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'
                  OR policy.polwithcheck IS NOT NULL))
         OR (policy.polname = 'saved_blog_post_owner_insert'
             AND (policy.polcmd <> 'a'
                  OR policy.polqual IS NOT NULL
                  OR pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
                     <> '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'))
         OR (policy.polname = 'saved_blog_post_owner_delete'
             AND (policy.polcmd <> 'd'
                  OR pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
                     <> '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'
                  OR policy.polwithcheck IS NOT NULL))
       )
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost rollback policy posture drifted';
  END IF;

  SELECT pg_catalog.to_regprocedure(
           'public.grainline_saved_blog_post_insert_guard()'
         )
    INTO guard_oid;
  IF guard_oid IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = guard_oid
       AND routine.proowner = table_owner
       AND routine.prosecdef
       AND routine.provolatile = 'v'
       AND routine.proparallel = 'u'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid
       AND NOT trigger_state.tgisinternal
  ) <> 1 OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid
       AND trigger_state.tgname = 'grainline_saved_blog_post_insert_guard'
       AND trigger_state.tgfoid = guard_oid
       AND trigger_state.tgenabled = 'O'
       AND NOT trigger_state.tgisinternal
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost rollback insert guard drifted';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(
             DISTINCT pg_catalog.upper(acl.privilege_type)
             ORDER BY pg_catalog.upper(acl.privilege_type)
           ),
           ARRAY[]::text[]
         )
    INTO runtime_privileges
    FROM pg_catalog.aclexplode(
      COALESCE(
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
        pg_catalog.acldefault('r', table_owner)
      )
    ) AS acl
   WHERE acl.grantee = runtime_oid;
  IF runtime_privileges IS DISTINCT FROM
       ARRAY['DELETE', 'INSERT', 'SELECT']::text[]
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
             pg_catalog.acldefault('r', table_owner)
           )
         ) AS acl
        WHERE acl.grantee NOT IN (table_owner, runtime_oid)
     ) THEN
    RAISE EXCEPTION 'SavedBlogPost rollback table grants drifted';
  END IF;
END
$grainline_saved_blog_post_rollback_preflight$;

GRANT UPDATE ON TABLE public."SavedBlogPost" TO grainline_app_runtime;
ALTER TABLE public."SavedBlogPost" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SavedBlogPost" DISABLE ROW LEVEL SECURITY;
DROP POLICY saved_blog_post_owner_select ON public."SavedBlogPost";
DROP POLICY saved_blog_post_owner_insert ON public."SavedBlogPost";
DROP POLICY saved_blog_post_owner_delete ON public."SavedBlogPost";
DROP TRIGGER grainline_saved_blog_post_insert_guard
  ON public."SavedBlogPost";
DROP FUNCTION public.grainline_saved_blog_post_insert_guard();

DO $grainline_saved_blog_post_rollback_postflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  runtime_privileges text[];
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SavedBlogPost'
     AND class.relkind = 'r';
  IF runtime_oid IS NULL OR table_oid IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND NOT relrowsecurity
       AND NOT relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger
     WHERE tgrelid = table_oid
       AND NOT tgisinternal
  ) OR pg_catalog.to_regprocedure(
    'public.grainline_saved_blog_post_insert_guard()'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'SavedBlogPost rollback catalog did not converge';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(
             DISTINCT pg_catalog.upper(acl.privilege_type)
             ORDER BY pg_catalog.upper(acl.privilege_type)
           ),
           ARRAY[]::text[]
         )
    INTO runtime_privileges
    FROM pg_catalog.aclexplode(
      COALESCE(
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
        pg_catalog.acldefault('r', table_owner)
      )
    ) AS acl
   WHERE acl.grantee = runtime_oid;
  IF runtime_privileges IS DISTINCT FROM
       ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = table_oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
             pg_catalog.acldefault('r', table_owner)
           )
         ) AS acl
        WHERE acl.grantee NOT IN (table_owner, runtime_oid)
     ) THEN
    RAISE EXCEPTION 'SavedBlogPost rollback grants did not converge';
  END IF;
END
$grainline_saved_blog_post_rollback_postflight$;

COMMIT;
