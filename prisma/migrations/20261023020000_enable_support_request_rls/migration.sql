-- Policyless SupportRequest ENABLE after every application caller moved to
-- the reviewed purpose-bound functions. FORCE remains a separate posture-only
-- release after ENABLE evidence is accepted.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.support-request.rls.activation', 0)
);

LOCK TABLE public."SupportRequest" IN ACCESS EXCLUSIVE MODE;

DO $grainline_support_request_activation_preflight$
DECLARE
  table_owner oid;
  migration_role record;
  restricted_role_count integer;
  predecessor_acl_count integer;
  expected_function_count integer;
  accepted_function_count integer;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
     AND class.relkind = 'r';

  IF table_owner IS DISTINCT FROM (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) OR current_user <> session_user THEN
    RAISE EXCEPTION 'SupportRequest ENABLE requires a direct table-owner session';
  END IF;

  SELECT role.rolsuper, role.rolbypassrls
    INTO migration_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (migration_role.rolsuper OR migration_role.rolbypassrls) THEN
    RAISE EXCEPTION 'SupportRequest owner must bypass later FORCE RLS';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO restricted_role_count
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname IN (
     'grainline_app_runtime',
     'grainline_staff_read_runtime'
   )
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND role.rolcanlogin
     AND NOT role.rolcreatedb
     AND NOT role.rolcreaterole
     AND NOT role.rolreplication
     AND NOT role.rolbypassrls;
  IF restricted_role_count <> 2 THEN
    RAISE EXCEPTION 'SupportRequest restricted-role posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM public._prisma_migrations AS migration
     WHERE migration.migration_name =
           '20261023010000_prepare_support_request_authorities'
       AND migration.checksum =
           'c65e259df2bd476e2d265c8973fabbcf018b5f989b4b01a2ca923bb1013dc384'
       AND migration.finished_at IS NOT NULL
       AND migration.rolled_back_at IS NULL
       AND migration.applied_steps_count = 1
  ) <> 1 THEN
    RAISE EXCEPTION 'SupportRequest ENABLE preparation prerequisite drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
       AND (class.relrowsecurity OR class.relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."SupportRequest"'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'SupportRequest ENABLE requires the exact policyless pre-RLS posture';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO predecessor_acl_count
    FROM pg_catalog.pg_class AS class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) AS acl
    JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
   WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
     AND acl.grantee <> class.relowner
     AND role.rolname = 'grainline_app_runtime'
     AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
     AND NOT acl.is_grantable;
  IF predecessor_acl_count <> 4 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
     WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
       AND acl.grantee <> class.relowner
       AND (
         role.rolname IS DISTINCT FROM 'grainline_app_runtime'
         OR acl.privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
         OR acl.is_grantable
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = 'public."SupportRequest"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> table_owner
       AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION 'SupportRequest predecessor direct authority drifted';
  END IF;

  WITH expected(name, arguments) AS (
    VALUES
      ('grainline_support_request_account_deletion_redact_batch', 'text[], text[]'),
      ('grainline_support_request_delivery_record', 'text, uuid, boolean, text'),
      ('grainline_support_request_overdue_count', ''),
      ('grainline_support_request_owner_export', ''),
      ('grainline_support_request_provider_deletion_upsert', 'text'),
      ('grainline_support_request_retention_delete_batch', 'integer'),
      ('grainline_support_request_staff_state', 'integer, integer, integer'),
      ('grainline_support_request_staff_transition', 'text, text, text'),
      ('grainline_support_request_submit', 'text, text, text, text, text, text, text')
  )
  SELECT pg_catalog.count(*)::integer INTO expected_function_count FROM expected;

  WITH expected(name, arguments) AS (
    VALUES
      ('grainline_support_request_account_deletion_redact_batch', 'text[], text[]'),
      ('grainline_support_request_delivery_record', 'text, uuid, boolean, text'),
      ('grainline_support_request_overdue_count', ''),
      ('grainline_support_request_owner_export', ''),
      ('grainline_support_request_provider_deletion_upsert', 'text'),
      ('grainline_support_request_retention_delete_batch', 'integer'),
      ('grainline_support_request_staff_state', 'integer, integer, integer'),
      ('grainline_support_request_staff_transition', 'text, text, text'),
      ('grainline_support_request_submit', 'text, text, text, text, text, text, text')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.name
     AND pg_catalog.oidvectortypes(procedure.proargtypes)::text = expected.arguments
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
     AND namespace.nspname = 'public'
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
   WHERE procedure.proowner = table_owner
     AND (owner.rolsuper OR owner.rolbypassrls)
     AND procedure.prosecdef
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE');
  IF expected_function_count <> 9 OR accepted_function_count <> expected_function_count OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname LIKE 'grainline_support_request_%'
  ) <> expected_function_count THEN
    RAISE EXCEPTION 'SupportRequest reviewed function boundary drifted';
  END IF;
END
$grainline_support_request_activation_preflight$;

ALTER TABLE public."SupportRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SupportRequest" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."SupportRequest"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_support_request_activation_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
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
          AND acl.grantee <> class.relowner
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_staff_read_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'SupportRequest ENABLE did not establish exact policyless posture';
  END IF;
END
$grainline_support_request_activation_postflight$;

COMMIT;
