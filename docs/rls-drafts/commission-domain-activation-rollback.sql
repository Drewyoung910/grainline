-- EMERGENCY ONLY: database-first rollback for the coupled CommissionRequest
-- and CommissionInterest policyless activation.
--
-- 1. Run this SQL as the bypass-capable table owner before changing the app.
-- 2. Verify the still-compatible predecessor app can read and write both
--    tables through its reviewed statements.
-- 3. Only then roll application traffic back if required.
-- 4. Reconcile Prisma's ledger explicitly:
--      npx prisma migrate resolve --rolled-back \
--        20261101070000_activate_commission_domain_rls
--
-- Never use this draft after the predecessor direct-access application has
-- been retired unless that exact predecessor is deliberately restored.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.commission-domain.rls.activation', 0)
);

LOCK TABLE public."CommissionRequest", public."CommissionInterest"
  IN ACCESS EXCLUSIVE MODE;

DO $grainline_commission_domain_rollback_preflight$
DECLARE
  relation_state record;
BEGIN
  IF current_user <> session_user OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
       AND (role.rolsuper OR role.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Commission rollback requires the direct bypass-capable owner';
  END IF;

  FOR relation_state IN
    SELECT relation.oid, relation.relname, relation.relowner,
           relation.relrowsecurity, relation.relforcerowsecurity
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('CommissionRequest', 'CommissionInterest')
     ORDER BY relation.relname
  LOOP
    IF relation_state.relowner IS DISTINCT FROM (
         SELECT role.oid
           FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = current_user
       ) OR NOT relation_state.relrowsecurity
       OR NOT relation_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation_state.oid
       ) THEN
      RAISE EXCEPTION
        'Commission rollback active posture drifted: %', relation_state.relname;
    END IF;
  END LOOP;
END
$grainline_commission_domain_rollback_preflight$;

ALTER TABLE public."CommissionRequest" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionRequest" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionInterest" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CommissionInterest" DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."CommissionRequest", public."CommissionInterest"
  TO grainline_app_runtime;

DO $grainline_commission_domain_rollback_postflight$
DECLARE
  relation_state record;
BEGIN
  FOR relation_state IN
    SELECT relation.oid, relation.relname, relation.relrowsecurity,
           relation.relforcerowsecurity
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('CommissionRequest', 'CommissionInterest')
     ORDER BY relation.relname
  LOOP
    IF relation_state.relrowsecurity
       OR relation_state.relforcerowsecurity
       OR NOT pg_catalog.has_table_privilege(
                'grainline_app_runtime', relation_state.oid, 'SELECT'
              )
       OR NOT pg_catalog.has_table_privilege(
                'grainline_app_runtime', relation_state.oid, 'INSERT'
              )
       OR NOT pg_catalog.has_table_privilege(
                'grainline_app_runtime', relation_state.oid, 'UPDATE'
              )
       OR NOT pg_catalog.has_table_privilege(
                'grainline_app_runtime', relation_state.oid, 'DELETE'
              ) THEN
      RAISE EXCEPTION
        'Commission rollback did not restore predecessor posture: %',
        relation_state.relname;
    END IF;
  END LOOP;
END
$grainline_commission_domain_rollback_postflight$;

COMMIT;
