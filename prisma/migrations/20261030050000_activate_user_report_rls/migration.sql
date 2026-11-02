-- Policyless UserReport activation. The compatible fixed-operation app and
-- exact 20261030020000 preparation must be live before this migration.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.user-report.rls.activation', 0)
);

LOCK TABLE public."UserReport" IN ACCESS EXCLUSIVE MODE;

DO $grainline_user_report_activation_preflight$
DECLARE
  table_oid oid := 'public."UserReport"'::pg_catalog.regclass;
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
    RAISE EXCEPTION 'UserReport activation requires the bypass-capable table owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS role
     WHERE role.oid IN (runtime_oid, staff_oid)
       AND (role.rolsuper OR role.rolinherit OR NOT role.rolcanlogin
            OR role.rolcreatedb OR role.rolcreaterole
            OR role.rolreplication OR role.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'UserReport activation role posture is unsafe';
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
    RAISE EXCEPTION 'UserReport activation requires the policyless predecessor';
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
    RAISE EXCEPTION 'UserReport predecessor grants drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('public.grainline_user_report_submit(text,text,text,text,text,text)', 'runtime'),
        ('public.grainline_user_report_owner_submitted_export()', 'runtime'),
        ('public.grainline_user_report_owner_received_export()', 'runtime'),
        ('public.grainline_user_report_staff_open_count(text)', 'staff'),
        ('public.grainline_user_report_staff_open_page(text,timestamp without time zone,text,integer)', 'staff'),
        ('public.grainline_user_report_staff_top_reporters(text,timestamp without time zone,integer)', 'staff'),
        ('public.grainline_user_report_staff_resolve(text,text,text,text)', 'staff'),
        ('public.grainline_user_report_account_deletion_redact(text,bigint,uuid)', 'runtime')
      ) AS expected(signature, execute_role)
     WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL
        OR (
          expected.execute_role = 'runtime'
          AND (
            NOT pg_catalog.has_function_privilege(
              runtime_oid, pg_catalog.to_regprocedure(expected.signature), 'EXECUTE'
            )
            OR pg_catalog.has_function_privilege(
              staff_oid, pg_catalog.to_regprocedure(expected.signature), 'EXECUTE'
            )
          )
        )
        OR (
          expected.execute_role = 'staff'
          AND (
            NOT pg_catalog.has_function_privilege(
              staff_oid, pg_catalog.to_regprocedure(expected.signature), 'EXECUTE'
            )
            OR pg_catalog.has_function_privilege(
              runtime_oid, pg_catalog.to_regprocedure(expected.signature), 'EXECUTE'
            )
          )
        )
  ) THEN
    RAISE EXCEPTION 'UserReport reviewed operation grants drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = procedure.proowner
     WHERE namespace.nspname = 'public'
       AND pg_catalog.strpos(procedure.prosrc, '"UserReport"') > 0
       AND (
         NOT procedure.prosecdef
         OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=pg_catalog']::text[]
         OR NOT (owner_role.rolsuper OR owner_role.rolbypassrls)
       )
  ) THEN
    RAISE EXCEPTION 'UserReport retained function cannot cross policyless FORCE RLS';
  END IF;
END;
$grainline_user_report_activation_preflight$;

REVOKE ALL PRIVILEGES ON TABLE public."UserReport"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

ALTER TABLE public."UserReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."UserReport" FORCE ROW LEVEL SECURITY;

DO $grainline_user_report_activation_postflight$
DECLARE
  table_oid oid := 'public."UserReport"'::pg_catalog.regclass;
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
    RAISE EXCEPTION 'UserReport activation did not reach policyless zero-direct FORCE';
  END IF;
END;
$grainline_user_report_activation_postflight$;

COMMIT;
