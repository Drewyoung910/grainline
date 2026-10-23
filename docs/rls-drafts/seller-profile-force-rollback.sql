-- Emergency posture rollback for 20261020250000_force_seller_profile_rls.
-- Direct table authority remains revoked and SellerProfile remains policyless
-- with RLS enabled. This does not restore any runtime table grant.

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

DO $grainline_seller_profile_force_rollback_preflight$
BEGIN
  IF current_user <> session_user OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = class.relowner
      JOIN pg_catalog.pg_roles AS session_role
        ON session_role.rolname = current_user
     WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
       AND class.relkind = 'r'
       AND owner_role.oid = session_role.oid
       AND (session_role.rolsuper OR session_role.rolbypassrls)
       AND class.relrowsecurity
       AND class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid
       )
  ) THEN
    RAISE EXCEPTION 'SellerProfile FORCE rollback posture drifted';
  END IF;
END
$grainline_seller_profile_force_rollback_preflight$;

ALTER TABLE public."SellerProfile" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."SellerProfile"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_seller_profile_force_rollback_postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
       AND class.relrowsecurity
       AND NOT class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid
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
  ) THEN
    RAISE EXCEPTION 'SellerProfile FORCE rollback did not restore ENABLE posture';
  END IF;
END
$grainline_seller_profile_force_rollback_postflight$;

COMMIT;
