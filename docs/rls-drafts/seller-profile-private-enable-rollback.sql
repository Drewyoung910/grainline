-- Database-first emergency rollback for policyless SellerProfilePrivate ENABLE.
-- This restores only the immediately preceding RLS posture. Direct runtime,
-- staff, and PUBLIC table authority stays revoked.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.seller-profile-private.rls.activation',
    0
  )
);

LOCK TABLE public."SellerProfilePrivate" IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_profile_private_enable_rollback_preflight$
BEGIN
  IF current_user <> session_user OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND class.relowner = (
         SELECT role.oid FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = current_user
       )
       AND class.relrowsecurity
       AND NOT class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION
      'SellerProfilePrivate ENABLE rollback preflight drifted';
  END IF;
END
$grainline_seller_profile_private_enable_rollback_preflight$;

ALTER TABLE public."SellerProfilePrivate" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SellerProfilePrivate" DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."SellerProfilePrivate"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_seller_profile_private_enable_rollback_postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND NOT class.relrowsecurity
       AND NOT class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
  ) OR pg_catalog.has_table_privilege(
    'grainline_app_runtime', 'public."SellerProfilePrivate"',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) OR pg_catalog.has_table_privilege(
    'grainline_staff_read_runtime', 'public."SellerProfilePrivate"',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) THEN
    RAISE EXCEPTION
      'SellerProfilePrivate ENABLE rollback did not restore predecessor posture';
  END IF;
END
$grainline_seller_profile_private_enable_rollback_postflight$;

COMMIT;
