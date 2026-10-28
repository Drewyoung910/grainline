BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.favorite.rls.activation', 0)
);

-- Freeze Favorite first and do not hold a conflicting Listing table lock while
-- waiting. Favorite writes update Listing from an AFTER trigger, while Listing
-- deletion cascades back into Favorite; holding both tables in either order can
-- deadlock those two legitimate predecessor paths. ACCESS EXCLUSIVE waits for
-- every in-flight Favorite write (including its count-trigger update) to finish
-- and then keeps the Favorite/count projection stable for this transaction.
LOCK TABLE public."Favorite" IN ACCESS EXCLUSIVE MODE;

DO $grainline_favorite_rls_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  current_role_oid oid;
  reviewed_function text;
  expected_source_md5 text;
  expected_volatility "char";
  expected_parallel "char";
  expected_runtime_execute boolean;
  existing_privileges text[];
  drift_count bigint;
BEGIN
  SELECT oid INTO runtime_oid
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
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = runtime_oid
  ) THEN
    RAISE EXCEPTION 'grainline_app_runtime posture is unsafe';
  END IF;

  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Favorite'
     AND class.relkind = 'r';
  IF table_oid IS NULL THEN
    RAISE EXCEPTION 'public.Favorite is missing';
  END IF;
  SELECT oid INTO current_role_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = current_user;
  IF table_owner IS DISTINCT FROM current_role_oid
     OR table_owner = runtime_oid THEN
    RAISE EXCEPTION 'Favorite activation must run as the non-runtime table owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE oid = table_owner
       AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Favorite owner must bypass RLS';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'Favorite predecessor RLS posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY attribute.attnum)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) IS DISTINCT FROM ARRAY['userId', 'listingId', 'createdAt']::text[] THEN
    RAISE EXCEPTION 'Favorite columns drifted';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = table_oid
       AND constraint_state.contype = 'p'
       AND constraint_state.convalidated
       AND constraint_state.conname = 'Favorite_pkey'
       AND constraint_state.conkey = ARRAY[
         (SELECT attribute.attnum
            FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = table_oid
             AND attribute.attname = 'userId'
             AND NOT attribute.attisdropped),
         (SELECT attribute.attnum
            FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = table_oid
             AND attribute.attname = 'listingId'
             AND NOT attribute.attisdropped)
       ]::smallint[]
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_state
     WHERE index_state.indrelid = table_oid
  ) <> 2 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_index AS index_state
      JOIN pg_catalog.pg_class AS index_class
        ON index_class.oid = index_state.indexrelid
     WHERE index_state.indrelid = table_oid
       AND NOT (
         index_state.indisvalid
         AND index_state.indisready
         AND NOT index_state.indisexclusion
         AND index_state.indpred IS NULL
         AND index_state.indexprs IS NULL
         AND index_state.indnatts = index_state.indnkeyatts
         AND (
           (index_class.relname = 'Favorite_pkey'
            AND index_state.indisprimary
            AND index_state.indisunique
            AND index_state.indnkeyatts = 2)
           OR (index_class.relname = 'Favorite_listingId_idx'
               AND NOT index_state.indisprimary
               AND NOT index_state.indisunique
               AND index_state.indnkeyatts = 1
               AND index_state.indkey[0] =
                 (SELECT attribute.attnum
                    FROM pg_catalog.pg_attribute AS attribute
                   WHERE attribute.attrelid = table_oid
                     AND attribute.attname = 'listingId'
                     AND NOT attribute.attisdropped))
         )
       )
  ) THEN
    RAISE EXCEPTION 'Favorite identity constraints drifted';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(constraint_state.conname::text ORDER BY constraint_state.conname)
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = table_oid
       AND constraint_state.contype = 'f'
  ) IS DISTINCT FROM ARRAY[
    'Favorite_listingId_fkey',
    'Favorite_userId_fkey'
  ]::text[] OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = table_oid
       AND constraint_state.conname = 'Favorite_userId_fkey'
       AND constraint_state.contype = 'f'
       AND constraint_state.convalidated
       AND constraint_state.confrelid = 'public."User"'::pg_catalog.regclass
       AND constraint_state.conkey = ARRAY[
         (SELECT attribute.attnum
            FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = table_oid
             AND attribute.attname = 'userId'
             AND NOT attribute.attisdropped)
       ]::smallint[]
       AND constraint_state.confkey = ARRAY[
         (SELECT attribute.attnum
            FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = 'public."User"'::pg_catalog.regclass
             AND attribute.attname = 'id'
             AND NOT attribute.attisdropped)
       ]::smallint[]
       AND constraint_state.confdeltype = 'c'
       AND constraint_state.confupdtype = 'c'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = table_oid
       AND constraint_state.conname = 'Favorite_listingId_fkey'
       AND constraint_state.contype = 'f'
       AND constraint_state.convalidated
       AND constraint_state.confrelid = 'public."Listing"'::pg_catalog.regclass
       AND constraint_state.conkey = ARRAY[
         (SELECT attribute.attnum
            FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = table_oid
             AND attribute.attname = 'listingId'
             AND NOT attribute.attisdropped)
       ]::smallint[]
       AND constraint_state.confkey = ARRAY[
         (SELECT attribute.attnum
            FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = 'public."Listing"'::pg_catalog.regclass
             AND attribute.attname = 'id'
             AND NOT attribute.attisdropped)
       ]::smallint[]
       AND constraint_state.confdeltype = 'c'
       AND constraint_state.confupdtype = 'c'
  ) OR EXISTS (
    SELECT 1
      FROM public."Favorite" AS favorite
      LEFT JOIN public."User" AS account_user
        ON account_user.id = favorite."userId"
      LEFT JOIN public."Listing" AS listing
        ON listing.id = favorite."listingId"
     WHERE account_user.id IS NULL OR listing.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Favorite relationship constraints drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = 'public."Listing"'::pg_catalog.regclass
       AND constraint_state.conname = 'Listing_favoriteCount_nonnegative_chk'
       AND constraint_state.contype = 'c'
       AND constraint_state.convalidated
       AND pg_catalog.pg_get_constraintdef(constraint_state.oid, true) =
           'CHECK ("favoriteCount" >= 0)'
  ) OR EXISTS (
    SELECT 1 FROM public."Listing" WHERE "favoriteCount" < 0
  ) THEN
    RAISE EXCEPTION 'Listing favorite-count invariant drifted';
  END IF;
  SELECT pg_catalog.count(*)::bigint
    INTO drift_count
    FROM public."Listing" AS listing
    LEFT JOIN LATERAL (
      SELECT pg_catalog.count(*)::integer AS value
        FROM public."Favorite" AS favorite
       WHERE favorite."listingId" = listing.id
    ) AS actual ON true
   WHERE listing."favoriteCount" <> actual.value;
  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'Favorite count projection drifted for % listings', drift_count;
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             trigger_state.tgname::text || ':' || trigger_state.tgtype::text
             ORDER BY trigger_state.tgname
           )
      FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid
       AND NOT trigger_state.tgisinternal
  ) IS DISTINCT FROM ARRAY[
    'Favorite_count_after_delete:9',
    'Favorite_count_after_insert:5',
    'Favorite_update_forbidden:19'
  ]::text[] OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid
       AND trigger_state.tgname = 'Favorite_count_after_delete'
       AND trigger_state.tgfoid = pg_catalog.to_regprocedure(
         'public.grainline_favorite_count_maintain()'
       )
       AND trigger_state.tgenabled = 'O'
       AND NOT trigger_state.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid
       AND trigger_state.tgname = 'Favorite_count_after_insert'
       AND trigger_state.tgfoid = pg_catalog.to_regprocedure(
         'public.grainline_favorite_count_maintain()'
       )
       AND trigger_state.tgenabled = 'O'
       AND NOT trigger_state.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid
       AND trigger_state.tgname = 'Favorite_update_forbidden'
       AND trigger_state.tgfoid = pg_catalog.to_regprocedure(
         'public.grainline_favorite_update_forbidden()'
       )
       AND trigger_state.tgenabled = 'O'
       AND NOT trigger_state.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Favorite preparation triggers drifted';
  END IF;

  FOR reviewed_function, expected_source_md5, expected_volatility,
      expected_parallel, expected_runtime_execute IN
    SELECT expected.identity, expected.source_md5, expected.volatility,
           expected.parallel_mode, expected.runtime_execute
      FROM (VALUES
        ('public.grainline_favorite_count_maintain()', '33d336428d410e5d45ec4864d9d983cb', 'v'::"char", 'u'::"char", false),
        ('public.grainline_favorite_update_forbidden()', '954c359579963c28fb3be2aee2dfb484', 'v'::"char", 'u'::"char", false),
        ('public.grainline_favorite_owner_listing_ids(text[])', 'c3c4ff9a7c848f960d7b7b79356b19da', 's'::"char", 'u'::"char", true),
        ('public.grainline_favorite_owner_add(text)', '7b7ed210b7cf94f79ce55c6fbbddf73b', 'v'::"char", 'u'::"char", true),
        ('public.grainline_favorite_owner_remove(text)', '7e4ca58a60cbf6b93bc260e4051331da', 'v'::"char", 'u'::"char", true),
        ('public.grainline_favorite_owner_delete_all(text)', '684284c4482d67e87ab1f52fa1256890', 'v'::"char", 'u'::"char", true),
        ('public.grainline_favorite_owner_export()', 'ca792d781eef9e3818bd3b9ee7a98286', 's'::"char", 'u'::"char", true),
        ('public.grainline_favorite_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)', '2cafa9f5961bde65ff0894db12e1412c', 's'::"char", 'u'::"char", true),
        ('public.grainline_favorite_seller_listing_cleanup(text)', '7b82d4570b291fd2f255a68eb1fe8491', 'v'::"char", 'u'::"char", true),
        ('public.grainline_favorite_admin_listing_cleanup(text)', '07c9daa3c05502d4cb4594e55c9eb183', 'v'::"char", 'u'::"char", true),
        ('public.grainline_favorite_block_cleanup(text)', '07c0b8e2f04721ee973a3e0a529c5be0', 'v'::"char", 'u'::"char", true),
        ('public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)', '974a228c0b6feb00564f107a858ff526', 'v'::"char", 'u'::"char", false),
        ('public.grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)', '195c87faa7dab7e74006f768b0a2e488', 's'::"char", 's'::"char", true),
        ('public.grainline_seller_owner_saved_listing_count()', 'af665497cf9f8402f7aee00c18eec77e', 's'::"char", 'u'::"char", true),
        ('public.grainline_seller_owner_saved_listing_page(integer,integer)', '5a8199b4902de8c27b6e39d92bfc3a27', 's'::"char", 'u'::"char", true),
        ('public.grainline_user_public_listing_favorite_counts(text[])', 'a4559ed4be797615616c41d4bd733014', 's'::"char", 'u'::"char", true)
      ) AS expected(identity, source_md5, volatility, parallel_mode, runtime_execute)
  LOOP
    IF pg_catalog.to_regprocedure(reviewed_function) IS NULL THEN
      RAISE EXCEPTION 'Favorite reviewed function is missing: %', reviewed_function;
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
         AND procedure.proowner = table_owner
         AND procedure.prosecdef
         AND procedure.prokind = 'f'
         AND procedure.provolatile = expected_volatility
         AND procedure.proparallel = expected_parallel
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND pg_catalog.md5(procedure.prosrc) = expected_source_md5
         AND (owner.rolsuper OR owner.rolbypassrls)
    ) OR pg_catalog.has_function_privilege(
      0, pg_catalog.to_regprocedure(reviewed_function), 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'grainline_app_runtime',
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) IS DISTINCT FROM expected_runtime_execute THEN
      RAISE EXCEPTION 'Favorite reviewed function posture drifted: %', reviewed_function;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.prosrc LIKE '%public."Favorite"%'
       AND procedure.oid <> ALL (ARRAY[
         pg_catalog.to_regprocedure('public.grainline_favorite_admin_listing_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_block_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_owner_add(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_owner_delete_all(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_owner_export()'),
         pg_catalog.to_regprocedure('public.grainline_favorite_owner_listing_ids(text[])'),
         pg_catalog.to_regprocedure('public.grainline_favorite_owner_remove(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_seller_listing_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)'),
         pg_catalog.to_regprocedure('public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)'),
         pg_catalog.to_regprocedure('public.grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)'),
         pg_catalog.to_regprocedure('public.grainline_seller_owner_saved_listing_count()'),
         pg_catalog.to_regprocedure('public.grainline_seller_owner_saved_listing_page(integer,integer)'),
         pg_catalog.to_regprocedure('public.grainline_user_public_listing_favorite_counts(text[])')
       ]::oid[])
  ) THEN
    RAISE EXCEPTION 'Favorite has an unreviewed function reader';
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
  IF existing_privileges IS DISTINCT FROM
       ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] THEN
    RAISE EXCEPTION 'Favorite runtime predecessor grants drifted';
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
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Favorite unexpected ACL drifted';
  END IF;
END
$grainline_favorite_rls_preflight$;

CREATE POLICY favorite_owner_select
  ON public."Favorite"
  AS PERMISSIVE
  FOR SELECT
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  );

CREATE POLICY favorite_owner_delete
  ON public."Favorite"
  AS PERMISSIVE
  FOR DELETE
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  );

REVOKE ALL ON TABLE public."Favorite"
  FROM PUBLIC, grainline_app_runtime;
GRANT SELECT, DELETE ON TABLE public."Favorite"
  TO grainline_app_runtime;

ALTER TABLE public."Favorite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Favorite" FORCE ROW LEVEL SECURITY;

DO $grainline_favorite_rls_postflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  reviewed_function text;
  expected_source_md5 text;
  expected_volatility "char";
  expected_parallel "char";
  expected_runtime_execute boolean;
  drift_count bigint;
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
     AND class.relname = 'Favorite'
     AND class.relkind = 'r';

  IF table_oid IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND relrowsecurity
       AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Favorite ENABLE/FORCE did not persist';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(
             policy.polname::text || ':' || policy.polcmd::text
             ORDER BY policy.polname
           )
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) IS DISTINCT FROM ARRAY[
    'favorite_owner_delete:d',
    'favorite_owner_select:r'
  ]::text[] OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
       AND NOT (
         policy.polpermissive
         AND policy.polroles = ARRAY[runtime_oid]::oid[]
         AND policy.polcmd IN ('r', 'd')
         AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) =
             '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'
         AND policy.polwithcheck IS NULL
       )
  ) THEN
    RAISE EXCEPTION 'Favorite owner policy catalog drifted';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'SELECT'
     ) OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'DELETE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'INSERT'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'UPDATE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'TRUNCATE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'REFERENCES'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'TRIGGER'
     ) THEN
    RAISE EXCEPTION 'Favorite runtime table grants drifted';
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
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Favorite table ACL drifted';
  END IF;

  FOR reviewed_function, expected_source_md5, expected_volatility,
      expected_parallel, expected_runtime_execute IN
    SELECT expected.identity, expected.source_md5, expected.volatility,
           expected.parallel_mode, expected.runtime_execute
      FROM (VALUES
        ('public.grainline_favorite_count_maintain()', '33d336428d410e5d45ec4864d9d983cb', 'v'::"char", 'u'::"char", false),
        ('public.grainline_favorite_update_forbidden()', '954c359579963c28fb3be2aee2dfb484', 'v'::"char", 'u'::"char", false),
        ('public.grainline_favorite_owner_listing_ids(text[])', 'c3c4ff9a7c848f960d7b7b79356b19da', 's'::"char", 'u'::"char", true),
        ('public.grainline_favorite_owner_add(text)', '7b7ed210b7cf94f79ce55c6fbbddf73b', 'v'::"char", 'u'::"char", true),
        ('public.grainline_favorite_owner_remove(text)', '7e4ca58a60cbf6b93bc260e4051331da', 'v'::"char", 'u'::"char", true),
        ('public.grainline_favorite_owner_delete_all(text)', '684284c4482d67e87ab1f52fa1256890', 'v'::"char", 'u'::"char", true),
        ('public.grainline_favorite_owner_export()', 'ca792d781eef9e3818bd3b9ee7a98286', 's'::"char", 'u'::"char", true),
        ('public.grainline_favorite_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)', '2cafa9f5961bde65ff0894db12e1412c', 's'::"char", 'u'::"char", true),
        ('public.grainline_favorite_seller_listing_cleanup(text)', '7b82d4570b291fd2f255a68eb1fe8491', 'v'::"char", 'u'::"char", true),
        ('public.grainline_favorite_admin_listing_cleanup(text)', '07c9daa3c05502d4cb4594e55c9eb183', 'v'::"char", 'u'::"char", true),
        ('public.grainline_favorite_block_cleanup(text)', '07c0b8e2f04721ee973a3e0a529c5be0', 'v'::"char", 'u'::"char", true),
        ('public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)', '974a228c0b6feb00564f107a858ff526', 'v'::"char", 'u'::"char", false),
        ('public.grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)', '195c87faa7dab7e74006f768b0a2e488', 's'::"char", 's'::"char", true),
        ('public.grainline_seller_owner_saved_listing_count()', 'af665497cf9f8402f7aee00c18eec77e', 's'::"char", 'u'::"char", true),
        ('public.grainline_seller_owner_saved_listing_page(integer,integer)', '5a8199b4902de8c27b6e39d92bfc3a27', 's'::"char", 'u'::"char", true),
        ('public.grainline_user_public_listing_favorite_counts(text[])', 'a4559ed4be797615616c41d4bd733014', 's'::"char", 'u'::"char", true)
      ) AS expected(identity, source_md5, volatility, parallel_mode, runtime_execute)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
         AND procedure.proowner = table_owner
         AND procedure.prosecdef
         AND procedure.prokind = 'f'
         AND procedure.provolatile = expected_volatility
         AND procedure.proparallel = expected_parallel
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND pg_catalog.md5(procedure.prosrc) = expected_source_md5
         AND (owner.rolsuper OR owner.rolbypassrls)
    ) OR pg_catalog.has_function_privilege(
      0, pg_catalog.to_regprocedure(reviewed_function), 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'grainline_app_runtime',
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) IS DISTINCT FROM expected_runtime_execute THEN
      RAISE EXCEPTION 'Favorite function posture drifted: %', reviewed_function;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.prosrc LIKE '%public."Favorite"%'
       AND procedure.oid <> ALL (ARRAY[
         pg_catalog.to_regprocedure('public.grainline_favorite_admin_listing_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_block_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_owner_add(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_owner_delete_all(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_owner_export()'),
         pg_catalog.to_regprocedure('public.grainline_favorite_owner_listing_ids(text[])'),
         pg_catalog.to_regprocedure('public.grainline_favorite_owner_remove(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_seller_listing_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_favorite_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)'),
         pg_catalog.to_regprocedure('public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)'),
         pg_catalog.to_regprocedure('public.grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)'),
         pg_catalog.to_regprocedure('public.grainline_seller_owner_saved_listing_count()'),
         pg_catalog.to_regprocedure('public.grainline_seller_owner_saved_listing_page(integer,integer)'),
         pg_catalog.to_regprocedure('public.grainline_user_public_listing_favorite_counts(text[])')
       ]::oid[])
  ) THEN
    RAISE EXCEPTION 'Favorite has an unreviewed function reader after activation';
  END IF;

  SELECT pg_catalog.count(*)::bigint
    INTO drift_count
    FROM public."Listing" AS listing
    LEFT JOIN LATERAL (
      SELECT pg_catalog.count(*)::integer AS value
        FROM public."Favorite" AS favorite
       WHERE favorite."listingId" = listing.id
    ) AS actual ON true
   WHERE listing."favoriteCount" <> actual.value;
  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'Favorite count projection drifted for % listings', drift_count;
  END IF;
END
$grainline_favorite_rls_postflight$;

COMMIT;
