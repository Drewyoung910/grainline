-- Posture-only FORCE for the already-policyless SupportRequest table.
-- The table owner is required to bypass RLS and every application path stays
-- on the reviewed SECURITY DEFINER functions, so this changes no app behavior.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.support-request.rls.activation', 0)
);

LOCK TABLE public."SupportRequest" IN ACCESS EXCLUSIVE MODE;

DO $grainline_support_request_force_preflight$
DECLARE
  table_owner oid;
  migration_role record;
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
    RAISE EXCEPTION 'SupportRequest FORCE requires a direct table-owner session';
  END IF;
  SELECT role.rolsuper, role.rolbypassrls
    INTO migration_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (migration_role.rolsuper OR migration_role.rolbypassrls) THEN
    RAISE EXCEPTION 'SupportRequest owner must bypass FORCE RLS';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM (
        VALUES
          ('20261023010000_prepare_support_request_authorities',
           'c65e259df2bd476e2d265c8973fabbcf018b5f989b4b01a2ca923bb1013dc384'),
          ('20261023020000_enable_support_request_rls',
           '370698b0617fbb5eb2d4d04d7acef43141628f8a8d3a6e672d4b1ef973493b61'),
          ('20261023050000_correct_support_request_email_reuse_privacy',
           '9db6f9bf2db0dc1d8b96199e4381a33cea51233521e0a59ba9328caa59d337a1')
      ) AS expected(name, checksum)
      JOIN public._prisma_migrations AS migration
        ON migration.migration_name = expected.name
       AND migration.checksum = expected.checksum
       AND migration.finished_at IS NOT NULL
       AND migration.rolled_back_at IS NULL
       AND migration.applied_steps_count = 1
  ) <> 3 THEN
    RAISE EXCEPTION 'SupportRequest FORCE migration prerequisites drifted';
  END IF;

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
    RAISE EXCEPTION 'SupportRequest FORCE requires exact policyless ENABLE posture';
  END IF;

  WITH expected(name, arguments, volatility, source_md5) AS (
    VALUES
      ('grainline_support_request_account_deletion_redact_batch', 'text[], text[]', 'v', '60b1f3e40e9e396231d3786bb0a79900'),
      ('grainline_support_request_delivery_record', 'text, uuid, boolean, text', 'v', '8df5419afc017a55e5192c5eda1eb7ce'),
      ('grainline_support_request_overdue_count', '', 's', '086ff266df2a492650fff8a3eb8fd450'),
      ('grainline_support_request_owner_export', '', 's', '0181f0e21eea256d9adcb3d426354dec'),
      ('grainline_support_request_provider_deletion_upsert', 'text', 'v', '2b3bd2105b065a2051fae05fd03ac3fb'),
      ('grainline_support_request_retention_delete_batch', 'integer', 'v', '72c98632508fef0ceb08cba069c7466d'),
      ('grainline_support_request_staff_state', 'integer, integer, integer', 's', '9ddd34e83db346231eca688557b2616d'),
      ('grainline_support_request_staff_transition', 'text, text, text', 'v', '2db010ae88a75ccdd31ffe3fb3442828'),
      ('grainline_support_request_submit', 'text, text, text, text, text, text, text', 'v', '9f8037a3c78d5696fa88cc65e8ea6ea9')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.name
     AND pg_catalog.oidvectortypes(procedure.proargtypes)::text = expected.arguments
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
   WHERE namespace.nspname = 'public'
     AND procedure.proowner = table_owner
     AND (owner.rolsuper OR owner.rolbypassrls)
     AND procedure.prosecdef
     AND procedure.provolatile::text = expected.volatility
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE');
  IF accepted_function_count <> 9 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname LIKE 'grainline_support_request_%'
  ) <> 9 THEN
    RAISE EXCEPTION 'SupportRequest FORCE function boundary drifted';
  END IF;
END
$grainline_support_request_force_preflight$;

ALTER TABLE public."SupportRequest" FORCE ROW LEVEL SECURITY;

DO $grainline_support_request_force_postflight$
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
    RAISE EXCEPTION 'SupportRequest FORCE did not persist exact policyless posture';
  END IF;
END
$grainline_support_request_force_postflight$;

COMMIT;
