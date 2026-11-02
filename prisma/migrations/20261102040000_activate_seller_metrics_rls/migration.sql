BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.seller-metrics.rls.activation', 0)
);

LOCK TABLE public."SellerMetrics" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public."SellerProfile" IN SHARE UPDATE EXCLUSIVE MODE;

DO $grainline_seller_metrics_rls_preflight$
DECLARE
  runtime_oid oid;
  staff_oid oid;
  account_deletion_oid oid;
  table_oid oid;
  table_owner oid;
  current_role_oid oid;
  reviewed_function text;
  expected_source_md5 text;
  expected_volatility "char";
  expected_runtime_execute boolean;
  expected_staff_execute boolean;
  existing_privileges text[];
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT oid INTO staff_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_staff_read_runtime';
  SELECT oid INTO account_deletion_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_account_deletion_runtime';
  IF runtime_oid IS NULL OR staff_oid IS NULL OR account_deletion_oid IS NULL THEN
    RAISE EXCEPTION 'SellerMetrics runtime roles are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE oid IN (runtime_oid, staff_oid, account_deletion_oid)
       AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
            OR rolreplication OR rolbypassrls)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
     WHERE member IN (runtime_oid, staff_oid, account_deletion_oid)
  ) THEN
    RAISE EXCEPTION 'SellerMetrics runtime role posture is unsafe';
  END IF;

  SELECT relation.oid, relation.relowner INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relname = 'SellerMetrics'
     AND relation.relkind = 'r';
  SELECT oid INTO current_role_oid FROM pg_catalog.pg_roles
   WHERE rolname = current_user;
  IF table_oid IS NULL OR table_owner IS DISTINCT FROM current_role_oid
     OR current_user <> session_user
     OR table_owner IN (runtime_oid, staff_oid, account_deletion_oid) THEN
    RAISE EXCEPTION 'SellerMetrics activation must run as the non-runtime table owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS owner_role
     WHERE owner_role.oid = table_owner
       AND (owner_role.rolsuper OR owner_role.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'SellerMetrics owner must bypass RLS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'SellerMetrics predecessor RLS posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
      attribute.attname::text || ':'
      || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
      || ':' || attribute.attnotnull::text
      ORDER BY attribute.attnum
    )
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0 AND NOT attribute.attisdropped
  ) IS DISTINCT FROM ARRAY[
    'id:text:true',
    'sellerProfileId:text:true',
    'calculatedAt:timestamp(3) without time zone:true',
    'periodMonths:integer:true',
    'averageRating:double precision:true',
    'reviewCount:integer:true',
    'onTimeShippingRate:double precision:true',
    'responseRate:double precision:true',
    'totalSalesCents:bigint:true',
    'completedOrderCount:integer:true',
    'activeCaseCount:integer:true',
    'accountAgeDays:integer:true'
  ]::text[] THEN
    RAISE EXCEPTION 'SellerMetrics columns drifted';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(
      constraint_state.conname::text || ':' || constraint_state.contype::text
      || ':' || pg_catalog.pg_get_constraintdef(constraint_state.oid, true)
      ORDER BY constraint_state.conname
    )
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = table_oid
       AND constraint_state.convalidated
  ) IS DISTINCT FROM ARRAY[
    'SellerMetrics_account_age_days_chk:c:CHECK ("accountAgeDays" >= 0)',
    'SellerMetrics_active_case_count_chk:c:CHECK ("activeCaseCount" >= 0)',
    'SellerMetrics_average_rating_chk:c:CHECK ("averageRating" >= 0::double precision AND "averageRating" <= 5::double precision)',
    'SellerMetrics_completed_order_count_chk:c:CHECK ("completedOrderCount" >= 0)',
    'SellerMetrics_on_time_shipping_rate_chk:c:CHECK ("onTimeShippingRate" >= 0::double precision AND "onTimeShippingRate" <= 1::double precision)',
    'SellerMetrics_period_months_chk:c:CHECK ("periodMonths" >= 1 AND "periodMonths" <= 12)',
    'SellerMetrics_pkey:p:PRIMARY KEY (id)',
    'SellerMetrics_response_rate_chk:c:CHECK ("responseRate" >= 0::double precision AND "responseRate" <= 1::double precision)',
    'SellerMetrics_review_count_chk:c:CHECK ("reviewCount" >= 0)',
    'SellerMetrics_sellerProfileId_fkey:f:FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"(id) ON UPDATE CASCADE ON DELETE CASCADE',
    'SellerMetrics_total_sales_cents_chk:c:CHECK ("totalSalesCents" >= 0)'
  ]::text[] THEN
    RAISE EXCEPTION 'SellerMetrics constraints drifted';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(
      index_relation.relname::text || ':' || index_state.indisprimary::text
      || ':' || index_state.indisunique::text || ':'
      || pg_catalog.pg_get_indexdef(index_state.indexrelid)
      ORDER BY index_relation.relname
    )
      FROM pg_catalog.pg_index AS index_state
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_state.indexrelid
     WHERE index_state.indrelid = table_oid
       AND index_state.indisvalid AND index_state.indisready
       AND NOT index_state.indisexclusion
       AND index_state.indpred IS NULL AND index_state.indexprs IS NULL
  ) IS DISTINCT FROM ARRAY[
    'SellerMetrics_pkey:true:true:CREATE UNIQUE INDEX "SellerMetrics_pkey" ON public."SellerMetrics" USING btree (id)',
    'SellerMetrics_sellerProfileId_key:false:true:CREATE UNIQUE INDEX "SellerMetrics_sellerProfileId_key" ON public."SellerMetrics" USING btree ("sellerProfileId")'
  ]::text[] THEN
    RAISE EXCEPTION 'SellerMetrics indexes drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_state
      JOIN pg_catalog.pg_proc AS trigger_function
        ON trigger_function.oid = trigger_state.tgfoid
     WHERE trigger_state.tgrelid = 'public."SellerProfile"'::pg_catalog.regclass
       AND trigger_state.tgname = 'grainline_seller_metrics_inactive_owner_cleanup'
       AND NOT trigger_state.tgisinternal
       AND trigger_state.tgenabled = 'O'
       AND trigger_state.tgtype = 17
       AND trigger_function.oid = pg_catalog.to_regprocedure(
         'public.grainline_seller_metrics_inactive_owner_cleanup()'
       )
  ) THEN
    RAISE EXCEPTION 'SellerMetrics inactive-owner cleanup trigger drifted';
  END IF;

  FOR reviewed_function, expected_source_md5, expected_volatility,
      expected_runtime_execute, expected_staff_execute IN
    SELECT expected.identity, expected.source_md5, expected.volatility,
           expected.runtime_execute, expected.staff_execute
      FROM (VALUES
        ('public.grainline_seller_metrics_refresh_prepared_impl(text,integer,boolean,text)', 'db2f16a904085beb5e2679f8b30eb212', 'v'::"char", false, false),
        ('public.grainline_seller_metrics_owner_state(integer,boolean)', 'b37116e7cedeb894f33fefd70dc72527', 'v'::"char", true, false),
        ('public.grainline_seller_metrics_account_deletion_clear(text,bigint,uuid)', 'ee4f472920572d095b2c6b7e4d37adc8', 'v'::"char", true, false),
        ('public.grainline_seller_metrics_inactive_owner_cleanup()', '1209378d714fa9c8f733d9c7d74427e8', 'v'::"char", false, false),
        ('public.grainline_seller_guild_metrics_apply(text,timestamp without time zone)', 'd9d8b81f20546d06bfb89c799264ba88', 'v'::"char", true, false),
        ('public.grainline_seller_guild_metrics_apply_prepared_impl(text,timestamp without time zone)', '09f24202b6869178b14f23782c6cbc2c', 'v'::"char", false, false),
        ('public.grainline_seller_guild_staff_master_pending(text)', '6302586fa4117ed89faabe4647603158', 's'::"char", false, true),
        ('public.grainline_seller_guild_staff_master_pending_page(text,timestamp without time zone,text,integer)', '84db8458dc6dce120b6740f73d7b77c3', 's'::"char", false, true),
        ('public.grainline_seller_staff_verification_target(text,text)', '2724067609699e6130ef45ab7d357590', 's'::"char", false, true)
      ) AS expected(
        identity, source_md5, volatility, runtime_execute, staff_execute
      )
  LOOP
    IF pg_catalog.to_regprocedure(reviewed_function) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = procedure.proowner
      WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
        AND procedure.proowner = table_owner AND procedure.prosecdef
        AND procedure.prokind = 'f'
        AND procedure.provolatile = expected_volatility
        AND procedure.proparallel = 'u'
        AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
        AND pg_catalog.md5(procedure.prosrc) = expected_source_md5
        AND (owner_role.rolsuper OR owner_role.rolbypassrls)
        AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
        AND pg_catalog.has_function_privilege(runtime_oid, procedure.oid, 'EXECUTE')
              IS NOT DISTINCT FROM expected_runtime_execute
        AND pg_catalog.has_function_privilege(staff_oid, procedure.oid, 'EXECUTE')
              IS NOT DISTINCT FROM expected_staff_execute
        AND NOT pg_catalog.has_function_privilege(
          account_deletion_oid, procedure.oid, 'EXECUTE'
        )
    ) THEN
      RAISE EXCEPTION 'SellerMetrics reviewed function posture drifted: %',
        reviewed_function;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosrc LIKE '%"SellerMetrics"%'
      AND procedure.oid <> ALL (ARRAY[
        pg_catalog.to_regprocedure('public.grainline_seller_metrics_refresh_prepared_impl(text,integer,boolean,text)'),
        pg_catalog.to_regprocedure('public.grainline_seller_metrics_account_deletion_clear(text,bigint,uuid)'),
        pg_catalog.to_regprocedure('public.grainline_seller_metrics_inactive_owner_cleanup()'),
        pg_catalog.to_regprocedure('public.grainline_seller_guild_metrics_apply(text,timestamp without time zone)'),
        pg_catalog.to_regprocedure('public.grainline_seller_guild_metrics_apply_prepared_impl(text,timestamp without time zone)'),
        pg_catalog.to_regprocedure('public.grainline_seller_guild_staff_master_pending(text)'),
        pg_catalog.to_regprocedure('public.grainline_seller_guild_staff_master_pending_page(text,timestamp without time zone,text,integer)'),
        pg_catalog.to_regprocedure('public.grainline_seller_staff_verification_target(text,text)')
      ]::oid[])
  ) THEN
    RAISE EXCEPTION 'SellerMetrics has an unreviewed function reader or writer';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(
      DISTINCT pg_catalog.upper(acl.privilege_type)
      ORDER BY pg_catalog.upper(acl.privilege_type)), ARRAY[]::text[])
    INTO existing_privileges
    FROM pg_catalog.aclexplode(COALESCE(
      (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
      pg_catalog.acldefault('r', table_owner))) AS acl
   WHERE acl.grantee = runtime_oid;
  IF existing_privileges IS DISTINCT FROM
       ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[] THEN
    RAISE EXCEPTION 'SellerMetrics runtime predecessor grants drifted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
      (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
      pg_catalog.acldefault('r', table_owner))) AS acl
     WHERE acl.grantee NOT IN (table_owner, runtime_oid)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE attribute.attrelid = table_oid AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'SellerMetrics predecessor ACL drifted';
  END IF;
END
$grainline_seller_metrics_rls_preflight$;

REVOKE ALL ON TABLE public."SellerMetrics"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime,
       grainline_account_deletion_runtime;

ALTER TABLE public."SellerMetrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SellerMetrics" FORCE ROW LEVEL SECURITY;

DO $grainline_seller_metrics_rls_postflight$
DECLARE
  table_oid oid := 'public."SellerMetrics"'::pg_catalog.regclass;
  table_owner oid;
BEGIN
  SELECT relowner INTO table_owner FROM pg_catalog.pg_class WHERE oid = table_oid;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND relrowsecurity AND relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'SellerMetrics activation posture drifted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
      (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
      pg_catalog.acldefault('r', table_owner))) AS acl
     WHERE acl.grantee <> table_owner
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE attribute.attrelid = table_oid AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'SellerMetrics activation left direct authority';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_state
      JOIN pg_catalog.pg_proc AS trigger_function
        ON trigger_function.oid = trigger_state.tgfoid
     WHERE trigger_state.tgrelid = 'public."SellerProfile"'::pg_catalog.regclass
       AND trigger_state.tgname = 'grainline_seller_metrics_inactive_owner_cleanup'
       AND NOT trigger_state.tgisinternal
       AND trigger_state.tgenabled = 'O'
       AND trigger_state.tgtype = 17
       AND trigger_function.oid = pg_catalog.to_regprocedure(
         'public.grainline_seller_metrics_inactive_owner_cleanup()'
       )
  ) THEN
    RAISE EXCEPTION 'SellerMetrics cleanup trigger drifted after activation';
  END IF;
END
$grainline_seller_metrics_rls_postflight$;

COMMIT;
