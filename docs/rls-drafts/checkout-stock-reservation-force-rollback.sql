-- REVIEWED EMERGENCY ROLLBACK. Apply only as the database-first response to
-- a proven CheckoutStockReservation FORCE regression. This changes only FORCE
-- back to NO FORCE and preserves policyless ENABLE plus all grants/functions.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.checkout-stock-reservation.rls.activation',
    0
  )
);

LOCK TABLE public."CheckoutStockReservation" IN ACCESS EXCLUSIVE MODE;

DO $grainline_checkout_reservation_force_rollback_preflight$
DECLARE
  accepted_table_count integer;
  runtime_role_oid oid;
BEGIN
  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';

  IF current_user NOT IN ('neondb_owner', 'ci') THEN
    RAISE EXCEPTION
      'CheckoutStockReservation FORCE rollback requires a reviewed migration owner';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CheckoutStockReservation'
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
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'DELETE',
            'TRUNCATE', 'REFERENCES', 'TRIGGER'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee IN (0, runtime_role_oid)
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation FORCE rollback predecessor drifted';
  END IF;
END
$grainline_checkout_reservation_force_rollback_preflight$;

ALTER TABLE public."CheckoutStockReservation" NO FORCE ROW LEVEL SECURITY;

DO $grainline_checkout_reservation_force_rollback_postflight$
DECLARE
  accepted_table_count integer;
  runtime_role_oid oid;
BEGIN
  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';

  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CheckoutStockReservation'
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'DELETE',
            'TRUNCATE', 'REFERENCES', 'TRIGGER'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee IN (0, runtime_role_oid)
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation FORCE rollback did not restore Phase A';
  END IF;
END
$grainline_checkout_reservation_force_rollback_postflight$;

COMMIT;
