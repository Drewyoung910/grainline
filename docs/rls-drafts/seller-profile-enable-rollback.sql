-- Database-first emergency rollback for policyless SellerProfile ENABLE.
-- This restores only the immediately preceding RLS posture. Direct runtime,
-- staff and PUBLIC table authority stays revoked.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.seller-profile-public.rls.activation',
    0
  )
);

LOCK TABLE public."SellerProfile" IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_profile_enable_rollback_preflight$
BEGIN
  IF current_user <> session_user OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
       AND class.relowner = (
         SELECT role.oid
           FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = current_user
       )
       AND class.relrowsecurity
       AND NOT class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."SellerProfile"'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'SellerProfile ENABLE rollback preflight drifted';
  END IF;
END
$grainline_seller_profile_enable_rollback_preflight$;

ALTER TABLE public."SellerProfile" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SellerProfile" DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."SellerProfile"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_seller_profile_enable_rollback_postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
       AND NOT class.relrowsecurity
       AND NOT class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."SellerProfile"'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
       AND acl.grantee <> class.relowner
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'DELETE',
         'TRUNCATE', 'REFERENCES', 'TRIGGER'
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid =
           'public."SellerProfile"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> (
         SELECT class.relowner
           FROM pg_catalog.pg_class AS class
          WHERE class.oid =
                'public."SellerProfile"'::pg_catalog.regclass
       )
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
       )
  ) OR pg_catalog.has_table_privilege(
    'grainline_app_runtime', 'public."SellerProfile"',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) OR pg_catalog.has_table_privilege(
    'grainline_staff_read_runtime', 'public."SellerProfile"',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND class.relrowsecurity
       AND class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid
       )
  ) THEN
    RAISE EXCEPTION
      'SellerProfile ENABLE rollback did not restore predecessor posture';
  END IF;
END
$grainline_seller_profile_enable_rollback_postflight$;

COMMIT;
