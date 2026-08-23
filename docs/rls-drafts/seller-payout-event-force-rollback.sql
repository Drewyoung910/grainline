-- REVIEWED EMERGENCY ROLLBACK. Apply only as the database-first response to
-- a proven SellerPayoutEvent FORCE regression. This changes only FORCE back
-- to NO FORCE and preserves policyless ENABLE plus all grants and functions.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.seller-payout-event.rls.activation', 0)
);

LOCK TABLE public."SellerPayoutEvent" IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_payout_event_force_rollback_preflight$
DECLARE
  accepted_table_count integer;
BEGIN
  IF current_user NOT IN ('neondb_owner', 'ci') THEN
    RAISE EXCEPTION
      'SellerPayoutEvent FORCE rollback requires a reviewed migration owner';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerPayoutEvent'
     AND class.relkind = 'r'
     AND class.relowner = (
       SELECT role.oid
         FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     )
     AND class.relrowsecurity
     AND class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent FORCE rollback predecessor drifted';
  END IF;
END
$grainline_seller_payout_event_force_rollback_preflight$;

ALTER TABLE public."SellerPayoutEvent" NO FORCE ROW LEVEL SECURITY;

DO $grainline_seller_payout_event_force_rollback_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerPayoutEvent'
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent FORCE rollback did not restore Phase A';
  END IF;
END
$grainline_seller_payout_event_force_rollback_postflight$;

COMMIT;
