-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Database-first emergency rollback for the initial policyless ENABLE
-- activation. This atomically restores the exact compatible predecessor
-- posture before an application rollback can be promoted.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.seller-payout-event.rls.activation', 0)
);

LOCK TABLE public."SellerPayoutEvent" IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_payout_event_activation_rollback_preflight$
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
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee <> class.relowner
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
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = class.oid
          AND attribute.attname = 'stripeEventCreatedSeconds'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND attribute.attnotnull
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent activation rollback predecessor drifted';
  END IF;
END
$grainline_seller_payout_event_activation_rollback_preflight$;

ALTER TABLE public."SellerPayoutEvent" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SellerPayoutEvent" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."SellerPayoutEvent"
  ALTER COLUMN "stripeEventCreatedSeconds" DROP NOT NULL;

REVOKE ALL ON TABLE public."SellerPayoutEvent"
  FROM PUBLIC, grainline_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."SellerPayoutEvent"
  TO grainline_app_runtime;

DO $grainline_seller_payout_event_activation_rollback_postflight$
DECLARE
  restored_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO restored_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerPayoutEvent'
     AND class.relkind = 'r'
     AND NOT class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'SELECT'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'INSERT'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'UPDATE'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'DELETE'
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee NOT IN (
                class.relowner,
                (SELECT role.oid FROM pg_catalog.pg_roles AS role
                  WHERE role.rolname = 'grainline_app_runtime')
              )
           OR (
             acl.grantee = (
               SELECT role.oid FROM pg_catalog.pg_roles AS role
                WHERE role.rolname = 'grainline_app_runtime'
             )
             AND (
               acl.privilege_type NOT IN (
                 'SELECT', 'INSERT', 'UPDATE', 'DELETE'
               )
               OR acl.grantor <> class.relowner
               OR acl.is_grantable
             )
           )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = class.oid
          AND attribute.attname = 'stripeEventCreatedSeconds'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND NOT attribute.attnotnull
     );
  IF restored_table_count <> 1 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent activation rollback did not restore predecessor';
  END IF;
END
$grainline_seller_payout_event_activation_rollback_postflight$;

COMMIT;
