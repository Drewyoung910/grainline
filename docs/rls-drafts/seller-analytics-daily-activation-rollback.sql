-- Database-first emergency rollback for the policyless seller daily analytics
-- activation. Run while the compatible fixed-operation application remains live.
-- Restoring predecessor CRUD before disabling RLS keeps both the compatible app
-- and a later predecessor app functional.
--
-- After this transaction and its readback succeed, keep the successfully
-- applied Prisma ledger row intact. Prisma cannot mark a completed migration
-- rolled back; any later reactivation requires a newly reviewed forward
-- migration with a new name. Do not deploy the predecessor application before
-- this database rollback succeeds.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.seller-analytics-daily.rls.activation', 0)
);

LOCK TABLE public."ListingViewDaily", public."SellerProfileViewDaily"
  IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_analytics_daily_rollback_preflight$
DECLARE
  owner_oid oid;
  runtime_oid oid;
  staff_oid oid;
  table_state record;
  reviewed_function record;
BEGIN
  SELECT role.oid INTO owner_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  SELECT role.oid INTO runtime_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  SELECT role.oid INTO staff_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime';
  IF current_user <> session_user
     OR owner_oid IS NULL OR runtime_oid IS NULL OR staff_oid IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles AS role
        WHERE role.oid = owner_oid
          AND (role.rolsuper OR role.rolbypassrls)
     ) THEN
    RAISE EXCEPTION
      'Seller analytics rollback requires the bypass-capable table owner';
  END IF;

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
       OR NOT table_state.relrowsecurity
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
        'Seller analytics rollback source posture drifted: %', table_state.relname;
    END IF;
  END LOOP;

  IF (SELECT pg_catalog.count(*)
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relname IN ('ListingViewDaily', 'SellerProfileViewDaily')
         AND relation.relkind = 'r') <> 2 THEN
    RAISE EXCEPTION 'Seller analytics rollback table catalog is incomplete';
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
      RAISE EXCEPTION 'Seller analytics rollback function drifted: %',
        reviewed_function.signature;
    END IF;
  END LOOP;
END;
$grainline_seller_analytics_daily_rollback_preflight$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."ListingViewDaily"
  TO grainline_app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."SellerProfileViewDaily"
  TO grainline_app_runtime;

ALTER TABLE public."ListingViewDaily" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."ListingViewDaily" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."SellerProfileViewDaily" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SellerProfileViewDaily" DISABLE ROW LEVEL SECURITY;

DO $grainline_seller_analytics_daily_rollback_postflight$
DECLARE
  table_state record;
BEGIN
  FOR table_state IN
    SELECT relation.oid AS table_oid, relation.relname,
           relation.relrowsecurity, relation.relforcerowsecurity
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('ListingViewDaily', 'SellerProfileViewDaily')
       AND relation.relkind = 'r'
     ORDER BY relation.relname
  LOOP
    IF table_state.relrowsecurity
       OR table_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = table_state.table_oid
       )
       OR NOT pg_catalog.has_table_privilege(
         'grainline_app_runtime', table_state.table_oid, 'SELECT'
       )
       OR NOT pg_catalog.has_table_privilege(
         'grainline_app_runtime', table_state.table_oid, 'INSERT'
       )
       OR NOT pg_catalog.has_table_privilege(
         'grainline_app_runtime', table_state.table_oid, 'UPDATE'
       )
       OR NOT pg_catalog.has_table_privilege(
         'grainline_app_runtime', table_state.table_oid, 'DELETE'
       )
       OR pg_catalog.has_table_privilege(
         'grainline_app_runtime', table_state.table_oid, 'TRUNCATE'
       )
       OR pg_catalog.has_table_privilege(
         'grainline_app_runtime', table_state.table_oid, 'REFERENCES'
       )
       OR pg_catalog.has_table_privilege(
         'grainline_app_runtime', table_state.table_oid, 'TRIGGER'
       ) OR EXISTS (
         SELECT 1
           FROM (VALUES
             ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
             ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
           ) AS privilege(name)
          WHERE pg_catalog.has_table_privilege(
            'grainline_staff_read_runtime', table_state.table_oid,
            privilege.name
          )
       ) OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_class AS relation
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
           ) AS acl
          WHERE relation.oid = table_state.table_oid
            AND acl.grantee = 0
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
            AND acl.grantee IN (
              'grainline_app_runtime'::pg_catalog.regrole,
              'grainline_staff_read_runtime'::pg_catalog.regrole,
              0::oid
            )
       ) THEN
      RAISE EXCEPTION
        'Seller analytics rollback did not restore predecessor posture: %',
        table_state.relname;
    END IF;
  END LOOP;
END;
$grainline_seller_analytics_daily_rollback_postflight$;

COMMIT;
