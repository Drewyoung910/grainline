BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $grainline_saved_blog_post_rls_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  current_role_oid oid;
  owner_super boolean;
  owner_bypass boolean;
  existing_privileges text[];
BEGIN
  SELECT oid
    INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  IF runtime_oid IS NULL THEN
    RAISE EXCEPTION 'grainline_app_runtime is missing';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE oid = runtime_oid
       AND (
         rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
         OR rolreplication OR rolbypassrls
       )
  ) THEN
    RAISE EXCEPTION 'grainline_app_runtime posture is unsafe';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = runtime_oid
  ) THEN
    RAISE EXCEPTION 'grainline_app_runtime must be membership-free';
  END IF;

  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SavedBlogPost'
     AND class.relkind = 'r';
  IF table_oid IS NULL THEN
    RAISE EXCEPTION 'public."SavedBlogPost" is missing';
  END IF;

  SELECT oid INTO current_role_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = current_user;
  IF table_owner IS DISTINCT FROM current_role_oid THEN
    RAISE EXCEPTION 'SavedBlogPost activation must run as the table owner';
  END IF;
  IF table_owner = runtime_oid THEN
    RAISE EXCEPTION 'grainline_app_runtime must not own SavedBlogPost';
  END IF;
  SELECT rolsuper, rolbypassrls
    INTO owner_super, owner_bypass
    FROM pg_catalog.pg_roles
   WHERE oid = table_owner;
  IF NOT COALESCE(owner_super, false) AND NOT COALESCE(owner_bypass, false) THEN
    RAISE EXCEPTION 'SavedBlogPost owner must be SUPERUSER or BYPASSRLS';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND (relrowsecurity OR relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost must begin with RLS and FORCE disabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost has unreviewed policies';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_saved_blog_post_insert_guard()'
     ) IS NOT NULL
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger
        WHERE tgrelid = table_oid
          AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'SavedBlogPost has an unreviewed trigger boundary';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             attribute.attname::text ORDER BY attribute.attnum
           )
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) IS DISTINCT FROM ARRAY['id', 'userId', 'blogPostId', 'createdAt']::text[] THEN
    RAISE EXCEPTION 'SavedBlogPost columns drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid = table_oid
       AND contype = 'p'
       AND pg_catalog.pg_get_constraintdef(oid, true) =
           'PRIMARY KEY (id)'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_index AS index_state
     WHERE index_state.indrelid = table_oid
       AND index_state.indisunique
       AND index_state.indisvalid
       AND pg_catalog.pg_get_indexdef(index_state.indexrelid) LIKE
           '%("userId", "blogPostId")'
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost identity constraints drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."SavedBlogPost" AS saved
      LEFT JOIN public."User" AS account_user
        ON account_user.id = saved."userId"
      LEFT JOIN public."BlogPost" AS post
        ON post.id = saved."blogPostId"
     WHERE account_user.id IS NULL OR post.id IS NULL
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost contains orphaned rows';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(
             DISTINCT pg_catalog.upper(acl.privilege_type)
             ORDER BY pg_catalog.upper(acl.privilege_type)
           ),
           ARRAY[]::text[]
         )
    INTO existing_privileges
    FROM pg_catalog.aclexplode(
      COALESCE(
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
        pg_catalog.acldefault('r', table_owner)
      )
    ) AS acl
   WHERE acl.grantee = runtime_oid;
  -- A provisioning replay on the compatible predecessor may already have
  -- removed the unused UPDATE authority. Accept only those two reviewed
  -- predecessor shapes; every other privilege set is drift.
  IF existing_privileges IS DISTINCT FROM
       ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]
     AND existing_privileges IS DISTINCT FROM
       ARRAY['DELETE', 'INSERT', 'SELECT']::text[] THEN
    RAISE EXCEPTION 'SavedBlogPost runtime predecessor grants drifted';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
          pg_catalog.acldefault('r', table_owner)
        )
      ) AS acl
     WHERE acl.grantee NOT IN (table_owner, runtime_oid)
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost has an unexpected nonowner table grant';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost has unexpected column grants';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.grainline_seller_owner_saved_blog_post_count()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_owner_saved_blog_post_page(integer,integer)'
     ) IS NULL THEN
    RAISE EXCEPTION 'SavedBlogPost retained owner functions are missing';
  END IF;
END
$grainline_saved_blog_post_rls_preflight$;

CREATE FUNCTION public.grainline_saved_blog_post_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_saved_blog_post_insert_guard$
DECLARE
  actor_id text;
  actor_state record;
  post_state record;
BEGIN
  -- The owner is the reviewed migration/maintenance authority and bypasses
  -- RLS. Enforce the application boundary for both a direct runtime login and
  -- the disposable CI pattern that reaches runtime through SET ROLE.
  IF SESSION_USER <> 'grainline_app_runtime'
     AND COALESCE(pg_catalog.current_setting('role', true), 'none') <>
         'grainline_app_runtime' THEN
    RETURN NEW;
  END IF;

  actor_id := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NEW."userId" IS DISTINCT FROM actor_id THEN
    RAISE EXCEPTION 'SavedBlogPost actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_user.banned, account_user."deletedAt"
    INTO actor_state
    FROM public."User" AS account_user
   WHERE account_user.id = actor_id
   FOR UPDATE;
  IF NOT FOUND
     OR actor_state.banned
     OR actor_state."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'SavedBlogPost actor is not active'
      USING ERRCODE = '42501';
  END IF;

  SELECT post.status,
         post."publishedAt",
         post."authorAccountActive",
         post."sellerProfileId",
         post."authorSellerPubliclyOrderable"
    INTO post_state
    FROM public."BlogPost" AS post
   WHERE post.id = NEW."blogPostId"
   FOR SHARE;
  IF NOT FOUND
     OR post_state.status IS DISTINCT FROM 'PUBLISHED'
     OR post_state."publishedAt" IS NULL
     OR post_state."publishedAt" > (
       pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
     )
     OR NOT COALESCE(post_state."authorAccountActive", false)
     OR (
       post_state."sellerProfileId" IS NOT NULL
       AND NOT COALESCE(post_state."authorSellerPubliclyOrderable", false)
     ) THEN
    RAISE EXCEPTION 'SavedBlogPost target is not public'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$grainline_saved_blog_post_insert_guard$;

REVOKE ALL ON FUNCTION public.grainline_saved_blog_post_insert_guard()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_saved_blog_post_insert_guard
BEFORE INSERT ON public."SavedBlogPost"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_saved_blog_post_insert_guard();

CREATE POLICY saved_blog_post_owner_select
  ON public."SavedBlogPost"
  AS PERMISSIVE
  FOR SELECT
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  );

CREATE POLICY saved_blog_post_owner_insert
  ON public."SavedBlogPost"
  AS PERMISSIVE
  FOR INSERT
  TO grainline_app_runtime
  WITH CHECK (
    "userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  );

CREATE POLICY saved_blog_post_owner_delete
  ON public."SavedBlogPost"
  AS PERMISSIVE
  FOR DELETE
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  );

REVOKE ALL ON TABLE public."SavedBlogPost"
  FROM PUBLIC, grainline_app_runtime;
GRANT SELECT, INSERT, DELETE ON TABLE public."SavedBlogPost"
  TO grainline_app_runtime;

ALTER TABLE public."SavedBlogPost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SavedBlogPost" FORCE ROW LEVEL SECURITY;

DO $grainline_saved_blog_post_rls_postflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  owner_super boolean;
  owner_bypass boolean;
  trigger_function_oid oid;
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
  SELECT rolsuper, rolbypassrls
    INTO owner_super, owner_bypass
    FROM pg_catalog.pg_roles
   WHERE oid = table_owner;
  IF NOT COALESCE(owner_super, false) AND NOT COALESCE(owner_bypass, false) THEN
    RAISE EXCEPTION 'SavedBlogPost owner posture drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND relrowsecurity
       AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost ENABLE/FORCE did not persist';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(
             policy.polname::text || ':' || policy.polcmd::text
             ORDER BY policy.polname
           )
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) IS DISTINCT FROM ARRAY[
    'saved_blog_post_owner_delete:d',
    'saved_blog_post_owner_insert:a',
    'saved_blog_post_owner_select:r'
  ]::text[] THEN
    RAISE EXCEPTION 'SavedBlogPost policy shape drifted';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy
     WHERE polrelid = table_oid
       AND (
         polpermissive IS DISTINCT FROM true
         OR polroles IS DISTINCT FROM ARRAY[runtime_oid]::oid[]
         OR polcmd NOT IN ('r', 'a', 'd')
       )
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost policy posture drifted';
  END IF;

  IF NOT pg_catalog.has_schema_privilege(
       'grainline_app_runtime', 'public', 'USAGE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SavedBlogPost"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SavedBlogPost"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SavedBlogPost"', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SavedBlogPost"', 'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SavedBlogPost"', 'TRUNCATE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SavedBlogPost"', 'REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SavedBlogPost"', 'TRIGGER'
     ) THEN
    RAISE EXCEPTION 'SavedBlogPost runtime grants drifted';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
          pg_catalog.acldefault('r', table_owner)
        )
      ) AS acl
     WHERE acl.grantee NOT IN (table_owner, runtime_oid)
        OR (acl.grantee = runtime_oid AND acl.is_grantable)
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost table ACL drifted';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost column ACL drifted';
  END IF;

  SELECT pg_catalog.to_regprocedure(
           'public.grainline_saved_blog_post_insert_guard()'
         )
    INTO trigger_function_oid;
  IF trigger_function_oid IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = trigger_function_oid
          AND routine.proowner = table_owner
          AND routine.prosecdef
          AND routine.provolatile = 'v'
          AND routine.proparallel = 'u'
          AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       trigger_function_oid,
       'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             routine.proacl,
             pg_catalog.acldefault('f', routine.proowner)
           )
         ) AS acl
        WHERE routine.oid = trigger_function_oid
          AND acl.grantee = 0
     ) THEN
    RAISE EXCEPTION 'SavedBlogPost insert guard posture drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid
       AND trigger_state.tgname = 'grainline_saved_blog_post_insert_guard'
       AND trigger_state.tgfoid = trigger_function_oid
       AND trigger_state.tgenabled = 'O'
       AND NOT trigger_state.tgisinternal
  ) THEN
    RAISE EXCEPTION 'SavedBlogPost insert trigger drifted';
  END IF;
END
$grainline_saved_blog_post_rls_postflight$;

COMMIT;
