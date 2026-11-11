-- Database-first emergency rollback for the email-service zero-direct
-- activation. Run this while the compatible fixed-operation app remains live.
-- It restores predecessor CRUD before any predecessor app may serve traffic.
-- The rollback writes an exact emergency marker while leaving the activation
-- recorded as applied. Prisma therefore cannot silently reapply it, and the
-- recurring role provisioner plus global grant audit preserve the predecessor
-- grants. Never mark this migration rolled back. Restore compatible
-- predecessor source if needed, then remove the marker only in a new reviewed
-- forward recovery migration that atomically restores the narrow posture.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.email-service.least-privilege.activation', 0)
);

LOCK TABLE
  public."NewsletterSubscriber",
  public."EmailSuppression",
  public."ResendWebhookEvent",
  public."EmailOutbox",
  public."EmailFailureCount"
IN ACCESS EXCLUSIVE MODE;

DO $grainline_email_service_rollback_preflight$
DECLARE
  table_name text;
  table_oid oid;
  table_owner oid;
  runtime_oid oid := (
    SELECT role.oid FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = 'grainline_app_runtime'
  );
  staff_oid oid := (
    SELECT role.oid FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = 'grainline_staff_read_runtime'
  );
  activation_row_count integer;
  exact_activation_count integer;
BEGIN
  IF runtime_oid IS NULL OR staff_oid IS NULL OR current_user <> session_user THEN
    RAISE EXCEPTION 'Email service rollback role boundary is incomplete';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (
      WHERE checksum = '4c9c30b2b95854f5dfe587532ecfb98a0698e54c2c50cf49cfdb4fdf0c8f02cf'
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
        AND applied_steps_count IN (0, 1)
        AND pg_catalog.strpos(
          COALESCE(logs, ''),
          'GRAINLINE_EMERGENCY_ROLLBACK:email_service_v1'
        ) = 0
    )::integer
    INTO activation_row_count, exact_activation_count
    FROM public._prisma_migrations
   WHERE migration_name =
     '20261101090000_activate_email_service_least_privilege';
  IF activation_row_count <> 1 OR exact_activation_count <> 1 THEN
    RAISE EXCEPTION 'Email service rollback activation ledger drifted';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'NewsletterSubscriber',
    'EmailSuppression',
    'ResendWebhookEvent',
    'EmailOutbox',
    'EmailFailureCount'
  ]::text[] LOOP
    table_oid := pg_catalog.to_regclass(pg_catalog.format('public.%I', table_name));
    SELECT class.relowner INTO table_owner
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid;
    IF table_oid IS NULL
       OR table_owner IS DISTINCT FROM (
         SELECT role.oid FROM pg_catalog.pg_roles AS role
          WHERE role.rolname = current_user
       )
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles AS role
          WHERE role.oid = table_owner
            AND (role.rolsuper OR role.rolbypassrls)
       )
       OR NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_class AS class
          WHERE class.oid = table_oid
            AND NOT class.relrowsecurity
            AND NOT class.relforcerowsecurity
       )
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = table_oid
       )
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               (SELECT class.relacl FROM pg_catalog.pg_class AS class
                 WHERE class.oid = table_oid),
               pg_catalog.acldefault('r', table_owner)
             )
           ) AS acl
          WHERE acl.grantee IN (runtime_oid, staff_oid, 0::oid)
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
      RAISE EXCEPTION 'Email service rollback source posture drifted for %', table_name;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege(
       runtime_oid,
       'public.grainline_account_deletion_email_key_core(text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       staff_oid,
       'public.grainline_account_deletion_email_key_core(text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Email service rollback helper posture drifted';
  END IF;
END
$grainline_email_service_rollback_preflight$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."NewsletterSubscriber",
  public."EmailSuppression",
  public."ResendWebhookEvent",
  public."EmailOutbox",
  public."EmailFailureCount"
TO grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_account_deletion_email_key_core(text)
TO grainline_app_runtime;

UPDATE public._prisma_migrations
   SET logs = pg_catalog.concat_ws(
     E'\n',
     NULLIF(logs, ''),
     'GRAINLINE_EMERGENCY_ROLLBACK:email_service_v1'
   )
 WHERE migration_name =
       '20261101090000_activate_email_service_least_privilege'
   AND checksum =
       '4c9c30b2b95854f5dfe587532ecfb98a0698e54c2c50cf49cfdb4fdf0c8f02cf'
   AND finished_at IS NOT NULL
   AND rolled_back_at IS NULL
   AND applied_steps_count IN (0, 1)
   AND pg_catalog.strpos(
     COALESCE(logs, ''),
     'GRAINLINE_EMERGENCY_ROLLBACK:email_service_v1'
   ) = 0;

DO $grainline_email_service_rollback_ledger_postflight$
DECLARE
  activation_row_count integer;
  exact_applied_count integer;
BEGIN
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (
      WHERE checksum = '4c9c30b2b95854f5dfe587532ecfb98a0698e54c2c50cf49cfdb4fdf0c8f02cf'
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
        AND applied_steps_count IN (0, 1)
        AND pg_catalog.strpos(
          COALESCE(logs, ''),
          'GRAINLINE_EMERGENCY_ROLLBACK:email_service_v1'
        ) > 0
    )::integer
    INTO activation_row_count, exact_applied_count
    FROM public._prisma_migrations
   WHERE migration_name =
     '20261101090000_activate_email_service_least_privilege';
  IF activation_row_count <> 1 OR exact_applied_count <> 1 THEN
    RAISE EXCEPTION 'Email service rollback must retain the applied activation ledger';
  END IF;
END
$grainline_email_service_rollback_ledger_postflight$;

DO $grainline_email_service_rollback_postflight$
DECLARE
  table_name text;
  table_oid oid;
  table_owner oid;
  runtime_oid oid := (
    SELECT role.oid FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = 'grainline_app_runtime'
  );
  staff_oid oid := (
    SELECT role.oid FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = 'grainline_staff_read_runtime'
  );
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'NewsletterSubscriber',
    'EmailSuppression',
    'ResendWebhookEvent',
    'EmailOutbox',
    'EmailFailureCount'
  ]::text[] LOOP
    table_oid := pg_catalog.to_regclass(pg_catalog.format('public.%I', table_name));
    SELECT class.relowner INTO table_owner
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid;
    IF NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'SELECT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'INSERT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'UPDATE')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, table_oid, 'DELETE')
       OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'TRUNCATE')
       OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'REFERENCES')
       OR pg_catalog.has_table_privilege(runtime_oid, table_oid, 'TRIGGER')
       OR NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_class AS class
          WHERE class.oid = table_oid
            AND NOT class.relrowsecurity
            AND NOT class.relforcerowsecurity
       )
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = table_oid
       )
       OR EXISTS (
         SELECT 1
           FROM (VALUES
             ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
             ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
           ) AS privilege(name)
          WHERE pg_catalog.has_table_privilege(staff_oid, table_oid, privilege.name)
       )
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               (SELECT class.relacl FROM pg_catalog.pg_class AS class
                 WHERE class.oid = table_oid),
               pg_catalog.acldefault('r', table_owner)
             )
           ) AS acl
          WHERE acl.grantee = 0
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
      RAISE EXCEPTION 'Email service rollback did not restore %', table_name;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege(
       runtime_oid,
       'public.grainline_account_deletion_email_key_core(text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       staff_oid,
       'public.grainline_account_deletion_email_key_core(text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Email service rollback did not restore the indexed-write helper';
  END IF;
END
$grainline_email_service_rollback_postflight$;

COMMIT;
