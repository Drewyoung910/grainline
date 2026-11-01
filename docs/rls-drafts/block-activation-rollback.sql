-- Database-first emergency rollback for the policyless Block activation.
-- Run while the compatible fixed-operation app is live. This restores the
-- wider predecessor grants before disabling RLS. The completed Prisma ledger
-- row remains applied; reactivation requires a new reviewed forward migration.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.block.rls.activation', 0)
);
LOCK TABLE public."Block" IN ACCESS EXCLUSIVE MODE;

DO $grainline_block_rollback_preflight$
DECLARE
  table_oid oid := 'public."Block"'::pg_catalog.regclass;
  table_owner oid;
BEGIN
  SELECT class.relowner INTO table_owner
    FROM pg_catalog.pg_class AS class WHERE class.oid = table_oid;
  IF current_user <> session_user
     OR table_owner IS DISTINCT FROM (
       SELECT role.oid FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles AS role
        WHERE role.oid = table_owner
          AND (role.rolsuper OR role.rolbypassrls)
     ) THEN
    RAISE EXCEPTION 'Block rollback requires the bypass-capable table owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid
       AND class.relrowsecurity
       AND class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'Block rollback requires policyless ENABLE plus FORCE';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid = table_oid
       AND acl.grantee <> table_owner
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> table_owner
  ) THEN
    RAISE EXCEPTION 'Block rollback source grants drifted';
  END IF;
END;
$grainline_block_rollback_preflight$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."Block" TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_conversation_inbox(
  text,
  boolean,
  text,
  timestamp,
  text,
  integer
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_message_unread_count(text)
  TO grainline_app_runtime;
ALTER TABLE public."Block" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Block" DISABLE ROW LEVEL SECURITY;

DO $grainline_block_rollback_postflight$
DECLARE
  table_oid oid := 'public."Block"'::pg_catalog.regclass;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid
       AND NOT class.relrowsecurity
       AND NOT class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  )
     OR NOT pg_catalog.has_table_privilege('grainline_app_runtime', table_oid, 'SELECT')
     OR NOT pg_catalog.has_table_privilege('grainline_app_runtime', table_oid, 'INSERT')
     OR NOT pg_catalog.has_table_privilege('grainline_app_runtime', table_oid, 'UPDATE')
     OR NOT pg_catalog.has_table_privilege('grainline_app_runtime', table_oid, 'DELETE')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', table_oid, 'TRUNCATE')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', table_oid, 'REFERENCES')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', table_oid, 'TRIGGER')
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_conversation_inbox(text,boolean,text,timestamp without time zone,text,integer)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_message_unread_count(text)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'Block rollback did not restore predecessor posture';
  END IF;
END;
$grainline_block_rollback_postflight$;

COMMIT;
