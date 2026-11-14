-- Emergency database-first rollback for
-- 20261113020000_activate_commission_domain_rls.
--
-- Run this transaction as the bypass-capable table owner before directing any
-- predecessor application traffic at the database. It restores predecessor
-- CRUD and removes FORCE plus ENABLE atomically. Prepared operations remain.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.commission-domain.rls.activation', 0)
);

LOCK TABLE public."CommissionInterest", public."CommissionRequest"
  IN ACCESS EXCLUSIVE MODE;

DO $grainline_commission_domain_rollback_preflight$
DECLARE
  relation_state record;
  owner_oid oid;
BEGIN
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname = current_user;
  IF current_user <> session_user OR owner_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE oid = owner_oid AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Commission rollback requires the direct bypass-capable owner';
  END IF;
  FOR relation_state IN
    SELECT relation.oid, relation.relname, relation.relowner,
           relation.relrowsecurity, relation.relforcerowsecurity,
           relation.relacl
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('CommissionInterest', 'CommissionRequest')
       AND relation.relkind = 'r'
     ORDER BY relation.relname
  LOOP
    IF relation_state.relowner <> owner_oid
       OR NOT relation_state.relrowsecurity
       OR NOT relation_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = relation_state.oid
       ) OR EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
           relation_state.relacl,
           pg_catalog.acldefault('r', relation_state.relowner)
         )) AS acl
          WHERE acl.grantee <> relation_state.relowner
       ) OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
          WHERE attribute.attrelid = relation_state.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND acl.grantee <> relation_state.relowner
       ) THEN
      RAISE EXCEPTION 'Commission rollback active posture drifted: %', relation_state.relname;
    END IF;
  END LOOP;
END
$grainline_commission_domain_rollback_preflight$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."CommissionInterest", public."CommissionRequest"
  TO grainline_app_runtime;

ALTER TABLE public."CommissionInterest" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionInterest" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionRequest" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionRequest" DISABLE ROW LEVEL SECURITY;

DO $grainline_commission_domain_rollback_postflight$
DECLARE
  runtime_oid oid;
  relation_state record;
  existing_privileges text[];
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  FOR relation_state IN
    SELECT relation.oid, relation.relname, relation.relowner,
           relation.relrowsecurity, relation.relforcerowsecurity,
           relation.relacl
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('CommissionInterest', 'CommissionRequest')
       AND relation.relkind = 'r'
     ORDER BY relation.relname
  LOOP
    SELECT COALESCE(pg_catalog.array_agg(
      DISTINCT pg_catalog.upper(acl.privilege_type)
      ORDER BY pg_catalog.upper(acl.privilege_type)
    ), ARRAY[]::text[])
      INTO existing_privileges
      FROM pg_catalog.aclexplode(COALESCE(
        relation_state.relacl,
        pg_catalog.acldefault('r', relation_state.relowner)
      )) AS acl
     WHERE acl.grantee = runtime_oid;
    IF relation_state.relrowsecurity OR relation_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = relation_state.oid
       ) OR existing_privileges IS DISTINCT FROM
         ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[]
       OR EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
           relation_state.relacl,
           pg_catalog.acldefault('r', relation_state.relowner)
         )) AS acl
          WHERE acl.grantee NOT IN (relation_state.relowner, runtime_oid)
       ) THEN
      RAISE EXCEPTION 'Commission rollback did not restore predecessor posture: %',
        relation_state.relname;
    END IF;
  END LOOP;
END
$grainline_commission_domain_rollback_postflight$;

COMMIT;

-- Keep the successfully applied Prisma ledger row intact. Prisma cannot mark a
-- completed migration rolled back. Re-activation requires a new reviewed
-- forward migration with a new name.
