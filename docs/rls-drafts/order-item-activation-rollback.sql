-- DRAFT ONLY. Do not apply to any persistent database.
-- Emergency rollback for policyless OrderItem ENABLE. The predecessor already
-- had zero ordinary-runtime, staff-runtime and PUBLIC table authority, so this
-- changes only the RLS posture and does not recreate table grants.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order-item.rls.activation', 0)
);
LOCK TABLE public."OrderItem" IN ACCESS EXCLUSIVE MODE;

DO $grainline_order_item_activation_rollback_preflight$
DECLARE
  accepted_table_count integer;
BEGIN
  IF current_user <> session_user
     OR NOT (
       (current_user = 'neondb_owner' AND pg_catalog.current_database() = 'neondb')
       OR
       (current_user = 'ci' AND pg_catalog.current_database() = 'grainline_ci')
     ) THEN
    RAISE EXCEPTION 'OrderItem ENABLE rollback requires a reviewed direct owner session';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderItem"'::pg_catalog.regclass
     AND class.relowner = (
       SELECT role.oid FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     )
     AND class.relrowsecurity AND NOT class.relforcerowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = class.oid
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
       ) AS acl
       WHERE acl.grantee <> class.relowner
         AND acl.privilege_type IN (
           'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
         )
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'OrderItem ENABLE rollback source posture drifted';
  END IF;
END
$grainline_order_item_activation_rollback_preflight$;

ALTER TABLE public."OrderItem" DISABLE ROW LEVEL SECURITY;

DO $grainline_order_item_activation_rollback_postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."OrderItem"'::pg_catalog.regclass
       AND NOT class.relrowsecurity AND NOT class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = class.oid
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
         WHERE acl.grantee <> class.relowner
           AND acl.privilege_type IN (
             'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
           )
       )
  ) THEN
    RAISE EXCEPTION 'OrderItem ENABLE rollback did not restore predecessor posture';
  END IF;
END
$grainline_order_item_activation_rollback_postflight$;

COMMIT;
