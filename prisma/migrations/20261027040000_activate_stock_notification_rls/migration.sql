BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $grainline_stock_notification_rls_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  current_role_oid oid;
  owner_super boolean;
  owner_bypass boolean;
  reviewed_function text;
  expected_source_md5 text;
  expected_volatility "char";
  expected_parallel "char";
  existing_privileges text[];
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
     AND class.relname = 'StockNotification'
     AND class.relkind = 'r';
  IF table_oid IS NULL THEN
    RAISE EXCEPTION 'public.StockNotification is missing';
  END IF;

  SELECT oid INTO current_role_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = current_user;
  IF table_owner IS DISTINCT FROM current_role_oid THEN
    RAISE EXCEPTION 'StockNotification activation must run as the table owner';
  END IF;
  IF table_owner = runtime_oid THEN
    RAISE EXCEPTION 'grainline_app_runtime must not own StockNotification';
  END IF;
  SELECT rolsuper, rolbypassrls
    INTO owner_super, owner_bypass
    FROM pg_catalog.pg_roles
   WHERE oid = table_owner;
  IF NOT COALESCE(owner_super, false) AND NOT COALESCE(owner_bypass, false) THEN
    RAISE EXCEPTION 'StockNotification owner must bypass RLS';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger
     WHERE tgrelid = table_oid
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'StockNotification predecessor RLS posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY attribute.attnum)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) IS DISTINCT FROM ARRAY['id', 'listingId', 'userId', 'createdAt']::text[] THEN
    RAISE EXCEPTION 'StockNotification columns drifted';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = table_oid
       AND constraint_state.contype = 'p'
       AND constraint_state.convalidated
       AND constraint_state.conname = 'StockNotification_pkey'
       AND constraint_state.conkey = ARRAY[
         (SELECT attribute.attnum
            FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = table_oid
             AND attribute.attname = 'id'
             AND NOT attribute.attisdropped)
       ]::smallint[]
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_state
     WHERE index_state.indrelid = table_oid
  ) <> 4 OR EXISTS (
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
           (index_class.relname = 'StockNotification_pkey'
            AND index_state.indisprimary
            AND index_state.indisunique
            AND index_state.indnkeyatts = 1
            AND (SELECT pg_catalog.array_agg(
                          attribute.attname::text
                          ORDER BY key_position.ordinality
                        )
                   FROM pg_catalog.unnest(index_state.indkey::smallint[])
                        WITH ORDINALITY AS key_position(attnum, ordinality)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = table_oid
                    AND attribute.attnum = key_position.attnum) =
                ARRAY['id']::text[])
           OR (index_class.relname = 'StockNotification_listingId_userId_key'
               AND NOT index_state.indisprimary
               AND index_state.indisunique
               AND index_state.indnkeyatts = 2
               AND (SELECT pg_catalog.array_agg(
                             attribute.attname::text
                             ORDER BY key_position.ordinality
                           )
                      FROM pg_catalog.unnest(index_state.indkey::smallint[])
                           WITH ORDINALITY AS key_position(attnum, ordinality)
                      JOIN pg_catalog.pg_attribute AS attribute
                        ON attribute.attrelid = table_oid
                       AND attribute.attnum = key_position.attnum) =
                   ARRAY['listingId', 'userId']::text[])
           OR (index_class.relname = 'StockNotification_listingId_idx'
               AND NOT index_state.indisprimary
               AND NOT index_state.indisunique
               AND index_state.indnkeyatts = 1
               AND (SELECT pg_catalog.array_agg(
                             attribute.attname::text
                             ORDER BY key_position.ordinality
                           )
                      FROM pg_catalog.unnest(index_state.indkey::smallint[])
                           WITH ORDINALITY AS key_position(attnum, ordinality)
                      JOIN pg_catalog.pg_attribute AS attribute
                        ON attribute.attrelid = table_oid
                       AND attribute.attnum = key_position.attnum) =
                   ARRAY['listingId']::text[])
           OR (index_class.relname = 'StockNotification_userId_idx'
               AND NOT index_state.indisprimary
               AND NOT index_state.indisunique
               AND index_state.indnkeyatts = 1
               AND (SELECT pg_catalog.array_agg(
                             attribute.attname::text
                             ORDER BY key_position.ordinality
                           )
                      FROM pg_catalog.unnest(index_state.indkey::smallint[])
                           WITH ORDINALITY AS key_position(attnum, ordinality)
                      JOIN pg_catalog.pg_attribute AS attribute
                        ON attribute.attrelid = table_oid
                       AND attribute.attnum = key_position.attnum) =
                   ARRAY['userId']::text[])
         )
       )
  ) THEN
    RAISE EXCEPTION 'StockNotification identity constraints drifted';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint
     WHERE conrelid = table_oid
       AND contype = 'f'
       AND convalidated
       AND confdeltype = 'c'
  ) <> 2 OR EXISTS (
    SELECT 1
      FROM public."StockNotification" AS subscription
      LEFT JOIN public."User" AS account_user
        ON account_user.id = subscription."userId"
      LEFT JOIN public."Listing" AS listing
        ON listing.id = subscription."listingId"
     WHERE account_user.id IS NULL OR listing.id IS NULL
  ) THEN
    RAISE EXCEPTION 'StockNotification relationship constraints drifted';
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
    RAISE EXCEPTION 'StockNotification runtime predecessor grants drifted';
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
    RAISE EXCEPTION 'StockNotification unexpected ACL drifted';
  END IF;

  FOR reviewed_function, expected_source_md5, expected_volatility,
      expected_parallel IN
    SELECT expected.identity, expected.source_md5, expected.volatility,
           expected.parallel_mode
      FROM (VALUES
        ('public.grainline_notification_claim_back_in_stock(text,text,text)', 'ba5972690e19a1751c4585df44461543', 'v'::"char", 'u'::"char"),
        ('public.grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)', '195c87faa7dab7e74006f768b0a2e488', 's'::"char", 's'::"char"),
        ('public.grainline_stock_notification_admin_listing_cleanup(text)', '09df28fac4c95e536bfee55236c9fe2e', 'v'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_block_cleanup(text)', 'bfdc1e2a015a2969ac8ab96a30703173', 'v'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_owner_export()', '5fb67f2095a3a0ad79dc96c121f5fd5c', 's'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_owner_subscribe(text,text)', 'ce51f509de689322f39e13c65a7b7d0c', 'v'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_restock_candidates(text,integer)', '5b0110a18292abaf5c3e409eaf4f2b56', 's'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_seller_counts(text[])', '14b29ee449feef3ce11b1e01ffe0c1f0', 's'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_seller_listing_cleanup(text)', '101860e7ea09f616c277a7c725f81b00', 'v'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)', '561251a60189ed9eb8abc47c41cfaa3d', 's'::"char", 'u'::"char")
      ) AS expected(identity, source_md5, volatility, parallel_mode)
  LOOP
    IF pg_catalog.to_regprocedure(reviewed_function) IS NULL THEN
      RAISE EXCEPTION 'StockNotification reviewed function is missing: %', reviewed_function;
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
    ) OR NOT pg_catalog.has_function_privilege(
      'grainline_app_runtime',
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      0,
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'StockNotification reviewed function posture drifted: %', reviewed_function;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.prosrc LIKE '%public."StockNotification"%'
       AND procedure.oid <> ALL (ARRAY[
         pg_catalog.to_regprocedure('public.grainline_notification_claim_back_in_stock(text,text,text)'),
         pg_catalog.to_regprocedure('public.grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_admin_listing_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_block_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_owner_export()'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_owner_subscribe(text,text)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_restock_candidates(text,integer)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_seller_counts(text[])'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_seller_listing_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)')
       ]::oid[])
  ) THEN
    RAISE EXCEPTION 'StockNotification has an unreviewed function reader';
  END IF;
END
$grainline_stock_notification_rls_preflight$;

CREATE POLICY stock_notification_owner_select
  ON public."StockNotification"
  AS PERMISSIVE
  FOR SELECT
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  );

CREATE POLICY stock_notification_owner_delete
  ON public."StockNotification"
  AS PERMISSIVE
  FOR DELETE
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  );

REVOKE ALL ON TABLE public."StockNotification"
  FROM PUBLIC, grainline_app_runtime;
GRANT SELECT, DELETE ON TABLE public."StockNotification"
  TO grainline_app_runtime;

ALTER TABLE public."StockNotification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."StockNotification" FORCE ROW LEVEL SECURITY;

DO $grainline_stock_notification_rls_postflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  reviewed_function text;
  expected_source_md5 text;
  expected_volatility "char";
  expected_parallel "char";
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
     AND class.relname = 'StockNotification'
     AND class.relkind = 'r';

  IF table_oid IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND relrowsecurity
       AND relforcerowsecurity
  ) OR (
    SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) <> 2 THEN
    RAISE EXCEPTION 'StockNotification RLS activation drifted';
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
    RAISE EXCEPTION 'StockNotification runtime table grants drifted';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
       AND NOT (
         policy.polpermissive
         AND policy.polroles = ARRAY[runtime_oid]::oid[]
         AND (
           (policy.polname = 'stock_notification_owner_select'
            AND policy.polcmd = 'r')
           OR (policy.polname = 'stock_notification_owner_delete'
               AND policy.polcmd = 'd')
         )
         AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) =
             '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'
         AND policy.polwithcheck IS NULL
       )
  ) THEN
    RAISE EXCEPTION 'StockNotification owner policy catalog drifted';
  END IF;

  FOR reviewed_function, expected_source_md5, expected_volatility,
      expected_parallel IN
    SELECT expected.identity, expected.source_md5, expected.volatility,
           expected.parallel_mode
      FROM (VALUES
        ('public.grainline_notification_claim_back_in_stock(text,text,text)', 'ba5972690e19a1751c4585df44461543', 'v'::"char", 'u'::"char"),
        ('public.grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)', '195c87faa7dab7e74006f768b0a2e488', 's'::"char", 's'::"char"),
        ('public.grainline_stock_notification_admin_listing_cleanup(text)', '09df28fac4c95e536bfee55236c9fe2e', 'v'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_block_cleanup(text)', 'bfdc1e2a015a2969ac8ab96a30703173', 'v'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_owner_export()', '5fb67f2095a3a0ad79dc96c121f5fd5c', 's'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_owner_subscribe(text,text)', 'ce51f509de689322f39e13c65a7b7d0c', 'v'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_restock_candidates(text,integer)', '5b0110a18292abaf5c3e409eaf4f2b56', 's'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_seller_counts(text[])', '14b29ee449feef3ce11b1e01ffe0c1f0', 's'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_seller_listing_cleanup(text)', '101860e7ea09f616c277a7c725f81b00', 'v'::"char", 'u'::"char"),
        ('public.grainline_stock_notification_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)', '561251a60189ed9eb8abc47c41cfaa3d', 's'::"char", 'u'::"char")
      ) AS expected(identity, source_md5, volatility, parallel_mode)
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
    ) OR NOT pg_catalog.has_function_privilege(
      'grainline_app_runtime',
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      0,
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'StockNotification function posture drifted: %', reviewed_function;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.prosrc LIKE '%public."StockNotification"%'
       AND procedure.oid <> ALL (ARRAY[
         pg_catalog.to_regprocedure('public.grainline_notification_claim_back_in_stock(text,text,text)'),
         pg_catalog.to_regprocedure('public.grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_admin_listing_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_block_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_owner_export()'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_owner_subscribe(text,text)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_restock_candidates(text,integer)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_seller_counts(text[])'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_seller_listing_cleanup(text)'),
         pg_catalog.to_regprocedure('public.grainline_stock_notification_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)')
       ]::oid[])
  ) THEN
    RAISE EXCEPTION 'StockNotification has an unreviewed function reader after activation';
  END IF;
END
$grainline_stock_notification_rls_postflight$;

COMMIT;
