-- Policyless Block activation. The compatible fixed-operation app and exact
-- 20261030010000 preparation must be live before this migration.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.block.rls.activation', 0)
);

LOCK TABLE public."Block" IN ACCESS EXCLUSIVE MODE;

DO $grainline_block_activation_preflight$
DECLARE
  table_oid oid := 'public."Block"'::pg_catalog.regclass;
  table_owner oid;
  runtime_oid oid;
  staff_oid oid;
BEGIN
  SELECT class.relowner INTO table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = table_oid
     AND class.relkind = 'r';
  SELECT role.oid INTO runtime_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  SELECT role.oid INTO staff_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime';

  IF table_owner IS NULL OR runtime_oid IS NULL OR staff_oid IS NULL
     OR current_user <> session_user
     OR table_owner IS DISTINCT FROM (
       SELECT role.oid FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles AS role
        WHERE role.oid = table_owner
          AND (role.rolsuper OR role.rolbypassrls)
     ) THEN
    RAISE EXCEPTION 'Block activation requires the bypass-capable table owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS role
     WHERE role.oid IN (runtime_oid, staff_oid)
       AND (role.rolsuper OR role.rolinherit OR NOT role.rolcanlogin
            OR role.rolcreatedb OR role.rolcreaterole
            OR role.rolreplication OR role.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Block activation role posture is unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid
       AND NOT class.relrowsecurity
       AND NOT class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'Block activation requires the policyless predecessor';
  END IF;

  IF NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'SELECT')
     OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'INSERT')
     OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'UPDATE')
     OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'DELETE')
     OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'TRUNCATE')
     OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'REFERENCES')
     OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'TRIGGER')
     OR EXISTS (
       SELECT 1 FROM (VALUES
         ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
         ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
       ) AS privilege(name)
       WHERE pg_catalog.has_table_privilege(staff_oid, table_oid, privilege.name)
     )
     OR EXISTS (
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
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = table_oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee IN (runtime_oid, staff_oid, 0::oid)
     ) THEN
    RAISE EXCEPTION 'Block predecessor grants drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('public.grainline_user_block_pair_is_blocked(text)', 'runtime'),
        ('public.grainline_user_block_create(text)', 'runtime'),
        ('public.grainline_user_block_remove(text)', 'runtime'),
        ('public.grainline_user_block_export()', 'runtime'),
        ('public.grainline_user_block_delete_owned()', 'runtime'),
        ('public.grainline_conversation_inbox_owner(boolean,text,timestamp without time zone,text,integer)', 'runtime'),
        ('public.grainline_message_unread_count_owner()', 'runtime')
      ) AS expected(signature, execute_role)
     WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL
        OR NOT pg_catalog.has_function_privilege(
          runtime_oid, pg_catalog.to_regprocedure(expected.signature), 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          staff_oid, pg_catalog.to_regprocedure(expected.signature), 'EXECUTE'
        )
  ) THEN
    RAISE EXCEPTION 'Block reviewed operation grants drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
     WHERE namespace.nspname = 'public'
       AND pg_catalog.strpos(procedure.prosrc, '"Block"') > 0
       AND (
         NOT procedure.prosecdef
         OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=pg_catalog']::text[]
         OR NOT (owner_role.rolsuper OR owner_role.rolbypassrls)
       )
  ) THEN
    RAISE EXCEPTION 'Block retained function cannot cross policyless FORCE RLS';
  END IF;
END;
$grainline_block_activation_preflight$;

REVOKE ALL PRIVILEGES ON TABLE public."Block"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

ALTER TABLE public."Block" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Block" FORCE ROW LEVEL SECURITY;

DO $grainline_block_activation_postflight$
DECLARE
  table_oid oid := 'public."Block"'::pg_catalog.regclass;
  table_owner oid;
BEGIN
  SELECT class.relowner INTO table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = table_oid;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid
       AND class.relrowsecurity
       AND class.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) OR EXISTS (
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
    RAISE EXCEPTION 'Block activation did not reach policyless zero-direct FORCE';
  END IF;
END;
$grainline_block_activation_postflight$;

COMMIT;
