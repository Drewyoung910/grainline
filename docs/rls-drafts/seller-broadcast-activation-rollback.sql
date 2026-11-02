-- Emergency database-first rollback for
-- 20261101050000_activate_seller_broadcast_rls.
--
-- Run this database transaction before directing any predecessor application
-- traffic at the database. The transaction restores predecessor CRUD first,
-- then removes FORCE/ENABLE atomically. Reconcile Prisma's ledger separately
-- only after the database and predecessor application have been verified.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.seller_broadcast.rls.activation', 0)
);

LOCK TABLE public."SellerBroadcast" IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_broadcast_rollback_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT class.oid, class.relowner INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerBroadcast' AND class.relkind = 'r';
  IF runtime_oid IS NULL OR table_oid IS NULL THEN
    RAISE EXCEPTION 'SellerBroadcast rollback prerequisites are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND relrowsecurity AND relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast rollback requires exact policyless activation';
  END IF;
  IF pg_catalog.has_table_privilege(runtime_oid, table_oid, 'SELECT')
     OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'INSERT')
     OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'UPDATE')
     OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'DELETE') THEN
    RAISE EXCEPTION 'SellerBroadcast rollback found unexpected runtime table authority';
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
    RAISE EXCEPTION 'SellerBroadcast rollback ACL posture drifted';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(
      trigger_state.tgname::text || ':' || trigger_state.tgtype::text || ':'
      || trigger_function.oid::pg_catalog.regprocedure::text
      ORDER BY trigger_state.tgname)
      FROM pg_catalog.pg_trigger AS trigger_state
      JOIN pg_catalog.pg_proc AS trigger_function
        ON trigger_function.oid = trigger_state.tgfoid
     WHERE trigger_state.tgrelid = table_oid AND NOT trigger_state.tgisinternal
  ) IS DISTINCT FROM ARRAY[
    'grainline_direct_upload_release_seller_broadcast_delete:11:grainline_direct_upload_source_delete_trigger()'
  ]::text[] THEN
    RAISE EXCEPTION 'SellerBroadcast rollback trigger inventory drifted';
  END IF;
END
$grainline_seller_broadcast_rollback_preflight$;

-- Restore every direct statement used by the reviewed predecessor app before
-- removing row security. The enclosing transaction makes this atomic.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."SellerBroadcast"
  TO grainline_app_runtime;

ALTER TABLE public."SellerBroadcast" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SellerBroadcast" DISABLE ROW LEVEL SECURITY;

DO $grainline_seller_broadcast_rollback_postflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  existing_privileges text[];
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT class.oid, class.relowner INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerBroadcast' AND class.relkind = 'r';
  IF table_oid IS NULL OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast rollback did not restore predecessor posture';
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
    RAISE EXCEPTION 'SellerBroadcast rollback did not restore predecessor grants';
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
    RAISE EXCEPTION 'SellerBroadcast rollback left unexpected authority';
  END IF;
END
$grainline_seller_broadcast_rollback_postflight$;

COMMIT;

-- Keep the successfully applied Prisma ledger row intact: Prisma's rollback
-- resolution accepts failed migrations only and cannot rewrite this completed
-- row. Re-activation requires a new reviewed forward migration with a new name.
