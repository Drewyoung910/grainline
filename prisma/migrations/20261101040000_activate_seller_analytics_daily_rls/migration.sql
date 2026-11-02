-- Policyless activation for the two seller daily analytics tables. The
-- compatible application and fixed operations must be live before this
-- migration. This transaction changes authority only.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.seller-analytics-daily.rls.activation', 0)
);

LOCK TABLE public."ListingViewDaily", public."SellerProfileViewDaily"
  IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_analytics_daily_activation_preflight$
DECLARE
  runtime_oid oid;
  staff_oid oid;
  owner_oid oid;
  table_state record;
  role_state record;
  reviewed_function record;
BEGIN
  SELECT role.oid INTO runtime_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  SELECT role.oid INTO staff_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime';
  SELECT role.oid INTO owner_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;

  IF runtime_oid IS NULL OR staff_oid IS NULL OR owner_oid IS NULL
     OR current_user <> session_user
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_roles AS role
        WHERE role.oid = owner_oid
          AND (role.rolsuper OR role.rolbypassrls)
     ) THEN
    RAISE EXCEPTION
      'Seller analytics activation requires the bypass-capable table owner';
  END IF;

  FOR role_state IN
    SELECT role.rolname, role.rolsuper, role.rolinherit, role.rolcanlogin,
           role.rolcreatedb, role.rolcreaterole, role.rolreplication,
           role.rolbypassrls
      FROM pg_catalog.pg_roles AS role
     WHERE role.oid IN (runtime_oid, staff_oid)
  LOOP
    IF role_state.rolsuper
       OR role_state.rolinherit
       OR NOT role_state.rolcanlogin
       OR role_state.rolcreatedb
       OR role_state.rolcreaterole
       OR role_state.rolreplication
       OR role_state.rolbypassrls THEN
      RAISE EXCEPTION
        'Seller analytics restricted role posture is unsafe: %',
        role_state.rolname;
    END IF;
  END LOOP;

  FOR table_state IN
    SELECT relation.oid AS table_oid, relation.relname, relation.relowner,
           relation.relrowsecurity, relation.relforcerowsecurity
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('ListingViewDaily', 'SellerProfileViewDaily')
       AND relation.relkind = 'r'
     ORDER BY relation.relname
  LOOP
    IF table_state.relowner IS DISTINCT FROM owner_oid
       OR table_state.relrowsecurity
       OR table_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = table_state.table_oid
       ) THEN
      RAISE EXCEPTION
        'Seller analytics predecessor table posture drifted: %',
        table_state.relname;
    END IF;

    IF NOT pg_catalog.has_table_privilege(runtime_oid, table_state.table_oid, 'SELECT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, table_state.table_oid, 'INSERT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, table_state.table_oid, 'UPDATE')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, table_state.table_oid, 'DELETE')
       OR pg_catalog.has_table_privilege(runtime_oid, table_state.table_oid, 'TRUNCATE')
       OR pg_catalog.has_table_privilege(runtime_oid, table_state.table_oid, 'REFERENCES')
       OR pg_catalog.has_table_privilege(runtime_oid, table_state.table_oid, 'TRIGGER')
       OR EXISTS (
         SELECT 1
           FROM (VALUES
             ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
             ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
           ) AS privilege(name)
          WHERE pg_catalog.has_table_privilege(
            staff_oid, table_state.table_oid, privilege.name
          )
       ) OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               (SELECT relation.relacl
                  FROM pg_catalog.pg_class AS relation
                 WHERE relation.oid = table_state.table_oid),
               pg_catalog.acldefault('r', owner_oid)
             )
           ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type IN (
              'SELECT', 'INSERT', 'UPDATE', 'DELETE',
              'TRUNCATE', 'REFERENCES', 'TRIGGER'
            )
       ) OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute AS attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
          WHERE attribute.attrelid = table_state.table_oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND acl.grantee IN (runtime_oid, staff_oid, 0::oid)
       ) THEN
      RAISE EXCEPTION
        'Seller analytics predecessor grants drifted: %', table_state.relname;
    END IF;
  END LOOP;

  IF (SELECT pg_catalog.count(*)
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relname IN ('ListingViewDaily', 'SellerProfileViewDaily')
         AND relation.relkind = 'r') <> 2 THEN
    RAISE EXCEPTION 'Seller analytics reviewed table catalog is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."ListingViewDaily" AS daily
     WHERE daily.views < 0
        OR daily.clicks < 0
        OR daily.views >= 2147483647
        OR daily.clicks >= 2147483647
        OR daily.date IS DISTINCT FROM pg_catalog.date_trunc('day', daily.date)
        OR NOT EXISTS (
          SELECT 1
            FROM public."Listing" AS listing
           WHERE listing.id = daily."listingId"
             AND listing."sellerId" = daily."sellerProfileId"
        )
  ) OR EXISTS (
    SELECT 1
      FROM public."SellerProfileViewDaily" AS daily
     WHERE daily.views < 0
        OR daily.views >= 2147483647
        OR daily.date IS DISTINCT FROM pg_catalog.date_trunc('day', daily.date)
  ) THEN
    RAISE EXCEPTION 'Seller analytics activation inventory is unsafe';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          ('public."ListingViewDaily"'::pg_catalog.regclass,
           'ListingViewDaily_counts_non_negative_chk'::text),
          ('public."ListingViewDaily"'::pg_catalog.regclass,
           'ListingViewDaily_date_midnight_utc_chk'::text),
          ('public."SellerProfileViewDaily"'::pg_catalog.regclass,
           'SellerProfileViewDaily_views_non_negative_chk'::text),
          ('public."SellerProfileViewDaily"'::pg_catalog.regclass,
           'SellerProfileViewDaily_date_midnight_utc_chk'::text)
      ) AS expected(table_oid, constraint_name)
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.conrelid = expected.table_oid
          AND constraint_state.conname = expected.constraint_name
          AND constraint_state.contype = 'c'
          AND constraint_state.convalidated
     )
  ) THEN
    RAISE EXCEPTION 'Seller analytics activation constraints are incomplete';
  END IF;

  FOR reviewed_function IN
    SELECT expected.signature,
           expected.source_md5,
           expected.signature::pg_catalog.regprocedure::oid AS function_oid
      FROM (
        VALUES
          ('public.grainline_listing_analytics_record(text,text)',
           '1797d6497f261eaa42b908cf0df5e100'),
          ('public.grainline_seller_profile_view_record(text,date)',
           '47d6df70e734a9c60be1716d37fda86f'),
          ('public.grainline_seller_engagement_analytics(bigint,bigint,boolean,text)',
           '60b6830522f1ff3b12e9a98741b967c2'),
          ('public.grainline_seller_analytics_retention_prune(integer)',
           '365f91c70c78c8ae33d9f08fb5e35d03'),
          ('public.grainline_seller_profile_view_daily_account_deletion_clear(text,bigint,uuid)',
           'cf220327f4b12730ac9f06fae7bb9820'),
          ('public.grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)',
           '195c87faa7dab7e74006f768b0a2e488')
      ) AS expected(signature, source_md5)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid = reviewed_function.function_oid
         AND pg_catalog.md5(procedure.prosrc) = reviewed_function.source_md5
         AND procedure.prosecdef
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND (owner.rolsuper OR owner.rolbypassrls)
         AND pg_catalog.has_function_privilege(
               runtime_oid, procedure.oid, 'EXECUTE'
             )
         AND NOT pg_catalog.has_function_privilege(
               staff_oid, procedure.oid, 'EXECUTE'
             )
         AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(
               COALESCE(
                 procedure.proacl,
                 pg_catalog.acldefault('f', procedure.proowner)
               )
             ) AS acl
            WHERE acl.grantee = 0
              AND acl.privilege_type = 'EXECUTE'
         )
    ) THEN
      RAISE EXCEPTION 'Seller analytics FORCE-crossing function drifted: %',
        reviewed_function.signature;
    END IF;
  END LOOP;
END;
$grainline_seller_analytics_daily_activation_preflight$;

REVOKE ALL PRIVILEGES ON TABLE public."ListingViewDaily"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL PRIVILEGES ON TABLE public."SellerProfileViewDaily"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

ALTER TABLE public."ListingViewDaily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ListingViewDaily" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SellerProfileViewDaily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SellerProfileViewDaily" FORCE ROW LEVEL SECURITY;

DO $grainline_seller_analytics_daily_activation_postflight$
DECLARE
  table_state record;
BEGIN
  FOR table_state IN
    SELECT relation.oid AS table_oid, relation.relname, relation.relowner,
           relation.relrowsecurity, relation.relforcerowsecurity
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('ListingViewDaily', 'SellerProfileViewDaily')
       AND relation.relkind = 'r'
     ORDER BY relation.relname
  LOOP
    IF NOT table_state.relrowsecurity
       OR NOT table_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = table_state.table_oid
       ) OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               (SELECT relation.relacl FROM pg_catalog.pg_class AS relation
                 WHERE relation.oid = table_state.table_oid),
               pg_catalog.acldefault('r', table_state.relowner)
             )
           ) AS acl
          WHERE acl.grantee <> table_state.relowner
       ) OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute AS attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
          WHERE attribute.attrelid = table_state.table_oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND acl.grantee <> table_state.relowner
       ) THEN
      RAISE EXCEPTION
        'Seller analytics activation postflight drifted: %', table_state.relname;
    END IF;
  END LOOP;

  IF (SELECT pg_catalog.count(*)
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relname IN ('ListingViewDaily', 'SellerProfileViewDaily')
         AND relation.relkind = 'r') <> 2 THEN
    RAISE EXCEPTION 'Seller analytics activated table catalog is incomplete';
  END IF;
END;
$grainline_seller_analytics_daily_activation_postflight$;

COMMIT;
