-- Database-first emergency rollback for the email-service zero-direct
-- activation. Run this while the compatible fixed-operation app remains live.
-- It restores predecessor CRUD before any predecessor app may serve traffic.
-- After the database rollback, restore compatible predecessor application
-- source and its provisioning/audit expectations. Keep the successfully
-- applied Prisma ledger row intact: Prisma's rollback resolution accepts
-- failed migrations only and cannot rewrite this completed row. Do not replay
-- the successor provisioning script while predecessor CRUD is restored. If
-- zero-direct activation is needed again, ship a new reviewed forward
-- migration with a new name.

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
BEGIN
  IF runtime_oid IS NULL OR staff_oid IS NULL OR current_user <> session_user THEN
    RAISE EXCEPTION 'Email service rollback role boundary is incomplete';
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
END
$grainline_email_service_rollback_preflight$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."NewsletterSubscriber",
  public."EmailSuppression",
  public."ResendWebhookEvent",
  public."EmailOutbox",
  public."EmailFailureCount"
TO grainline_app_runtime;

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
END
$grainline_email_service_rollback_postflight$;

COMMIT;
