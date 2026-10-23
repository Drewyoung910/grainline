-- Emergency rollback for SupportRequest FORCE only. Keep policyless ENABLE,
-- zero direct table authority, and every reviewed function boundary intact.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.support-request.rls.activation', 0)
);

LOCK TABLE public."SupportRequest" IN ACCESS EXCLUSIVE MODE;

DO $grainline_support_request_force_rollback_preflight$
DECLARE
  table_owner oid;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
     AND class.relkind = 'r';
  IF current_user <> session_user OR table_owner IS DISTINCT FROM (
    SELECT role.oid FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS role
     WHERE role.oid = table_owner
       AND (role.rolsuper OR role.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'SupportRequest FORCE rollback identity drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
       AND class.relrowsecurity
       AND class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."SupportRequest"'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
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
           'public."SupportRequest"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> table_owner
       AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION 'SupportRequest FORCE rollback posture drifted';
  END IF;
END
$grainline_support_request_force_rollback_preflight$;

ALTER TABLE public."SupportRequest" NO FORCE ROW LEVEL SECURITY;

DO $grainline_support_request_force_rollback_postflight$
DECLARE
  table_owner oid;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
     AND class.relkind = 'r';
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
       AND class.relrowsecurity
       AND NOT class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."SupportRequest"'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
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
           'public."SupportRequest"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> table_owner
       AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION 'SupportRequest FORCE rollback did not restore ENABLE posture';
  END IF;
END
$grainline_support_request_force_rollback_postflight$;

COMMIT;
