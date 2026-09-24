-- DRAFT ONLY. Do not apply to any persistent database.
-- Emergency posture-only rollback from Core Order FORCE to policyless ENABLE.
-- It does not restore direct table access.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order-core.rls.force', 0)
);
LOCK TABLE public."Order" IN ACCESS EXCLUSIVE MODE;

DO $grainline_order_core_force_rollback_preflight$
DECLARE
  accepted_table_count integer;
BEGIN
  IF current_user <> session_user
     OR NOT (
       current_user = 'neondb_owner'
       OR (current_user = 'ci'
           AND pg_catalog.current_database() = 'grainline_ci')
     ) THEN
    RAISE EXCEPTION 'Core Order FORCE rollback requires reviewed owner session';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."Order"'::pg_catalog.regclass
     AND class.relkind = 'r'
     AND class.relowner = (
       SELECT role.oid FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     )
     AND class.relrowsecurity AND class.relforcerowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(class.relacl,
                  pg_catalog.acldefault('r', class.relowner))
       ) AS acl
        WHERE acl.grantee <> class.relowner
          AND acl.privilege_type IN (
            'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
          )
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'Core Order FORCE rollback predecessor drifted';
  END IF;
END
$grainline_order_core_force_rollback_preflight$;

ALTER TABLE public."Order" NO FORCE ROW LEVEL SECURITY;

DO $grainline_order_core_force_rollback_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."Order"'::pg_catalog.regclass
     AND class.relrowsecurity AND NOT class.relforcerowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'Core Order FORCE rollback did not restore ENABLE';
  END IF;
END
$grainline_order_core_force_rollback_postflight$;

COMMIT;
