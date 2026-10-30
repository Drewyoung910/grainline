-- Database-first emergency rollback for the combined policyless
-- MakerVerification ENABLE/FORCE activation. Run this database step while the
-- compatible fixed-operation application remains live; it restores predecessor
-- CRUD before disabling RLS, and that application remains valid with the wider
-- predecessor grants. After this transaction and its readback succeed, record
-- the activation ledger reversal with:
--   npx prisma migrate resolve --rolled-back \
--     20261028080000_activate_maker_verification_rls
-- Only then redeploy the predecessor application if application rollback is
-- still required. Never put the predecessor application live before this SQL.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.maker-verification.rls.activation', 0)
);

LOCK TABLE public."MakerVerification" IN ACCESS EXCLUSIVE MODE;

DO $grainline_maker_verification_rollback_preflight$
DECLARE
  table_oid oid := 'public."MakerVerification"'::pg_catalog.regclass;
  table_owner oid;
BEGIN
  SELECT class.relowner INTO table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = table_oid;
  IF current_user <> session_user
     OR table_owner IS DISTINCT FROM (
       SELECT role.oid
         FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_roles AS role
        WHERE role.oid = table_owner
          AND (role.rolsuper OR role.rolbypassrls)
     ) THEN
    RAISE EXCEPTION
      'MakerVerification rollback requires the bypass-capable table owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid
       AND class.relrowsecurity
       AND class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) THEN
    RAISE EXCEPTION
      'MakerVerification rollback requires policyless ENABLE plus FORCE';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          (SELECT class.relacl
             FROM pg_catalog.pg_class AS class
            WHERE class.oid = table_oid),
          pg_catalog.acldefault('r', table_owner)
        )
      ) AS acl
     WHERE acl.grantee <> table_owner
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> table_owner
  ) THEN
    RAISE EXCEPTION
      'MakerVerification rollback source grants drifted';
  END IF;
END;
$grainline_maker_verification_rollback_preflight$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."MakerVerification"
  TO grainline_app_runtime;
ALTER TABLE public."MakerVerification" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."MakerVerification" DISABLE ROW LEVEL SECURITY;

DO $grainline_maker_verification_rollback_postflight$
DECLARE
  table_oid oid := 'public."MakerVerification"'::pg_catalog.regclass;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid
       AND NOT class.relrowsecurity
       AND NOT class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'TRUNCATE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', table_oid, 'TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'MakerVerification rollback did not restore predecessor posture';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
      ) AS privilege(name)
     WHERE pg_catalog.has_table_privilege(
       'grainline_staff_read_runtime', table_oid, privilege.name
     )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid = table_oid
       AND acl.grantee = 0
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'DELETE',
         'TRUNCATE', 'REFERENCES', 'TRIGGER'
       )
  ) THEN
    RAISE EXCEPTION
      'MakerVerification rollback widened staff or PUBLIC authority';
  END IF;
END;
$grainline_maker_verification_rollback_postflight$;

COMMIT;
