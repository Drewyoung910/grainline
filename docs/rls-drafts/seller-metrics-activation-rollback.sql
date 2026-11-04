-- Emergency database-first rollback for
-- 20261102040000_activate_seller_metrics_rls.
--
-- Run this database transaction before directing any predecessor application
-- traffic at the database. It restores predecessor CRUD before removing FORCE
-- and ENABLE atomically. Prepared functions, constraints and cleanup remain.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.seller-metrics.rls.activation', 0)
);

LOCK TABLE public."SellerMetrics" IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_metrics_rollback_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid := 'public."SellerMetrics"'::pg_catalog.regclass;
  table_owner oid;
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT relowner INTO table_owner FROM pg_catalog.pg_class WHERE oid = table_oid;
  IF runtime_oid IS NULL OR table_owner IS NULL
     OR current_user <> session_user
     OR table_owner IS DISTINCT FROM (
       SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user
     ) THEN
    RAISE EXCEPTION 'SellerMetrics rollback identity drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND relrowsecurity AND relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'SellerMetrics rollback requires exact policyless activation';
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
    RAISE EXCEPTION 'SellerMetrics rollback ACL posture drifted';
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
    RAISE EXCEPTION 'SellerMetrics rollback cleanup trigger drifted';
  END IF;
END
$grainline_seller_metrics_rollback_preflight$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."SellerMetrics"
  TO grainline_app_runtime;

ALTER TABLE public."SellerMetrics" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SellerMetrics" DISABLE ROW LEVEL SECURITY;

DO $grainline_seller_metrics_rollback_postflight$
DECLARE
  runtime_oid oid;
  table_oid oid := 'public."SellerMetrics"'::pg_catalog.regclass;
  table_owner oid;
  existing_privileges text[];
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT relowner INTO table_owner FROM pg_catalog.pg_class WHERE oid = table_oid;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'SellerMetrics rollback did not restore predecessor posture';
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
    RAISE EXCEPTION 'SellerMetrics rollback did not restore predecessor grants';
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
    RAISE EXCEPTION 'SellerMetrics rollback left unexpected authority';
  END IF;
END
$grainline_seller_metrics_rollback_postflight$;

COMMIT;

-- Keep the successfully applied Prisma ledger row intact: Prisma's rollback
-- resolution accepts failed migrations only and cannot rewrite this completed
-- row. Re-activation requires a new reviewed forward migration with a new name.
