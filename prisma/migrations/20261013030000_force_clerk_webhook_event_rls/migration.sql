-- ClerkWebhookEvent Phase B posture hardening. Phase A already revoked every
-- direct runtime grant and left the service ledger policyless. This migration
-- changes only the table-owner bypass posture after live application proof.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.clerk-webhook-event.rls.force', 0)
);

LOCK TABLE public."ClerkWebhookEvent" IN ACCESS EXCLUSIVE MODE;

DO $grainline_clerk_webhook_event_force_preflight$
DECLARE
  table_owner oid;
  runtime_role_oid oid;
  owner_session_count integer;
  activation_migration_count integer;
  accepted_table_count integer;
  accepted_function_count integer;
  invalid_row_count bigint;
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'ClerkWebhookEvent FORCE requires a direct owner session';
  END IF;

  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'ClerkWebhookEvent'
     AND class.relkind = 'r';

  IF table_owner IS DISTINCT FROM (
    SELECT role.oid FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) THEN
    RAISE EXCEPTION 'ClerkWebhookEvent FORCE table owner drifted';
  END IF;

  IF NOT (
    (
      current_user = 'neondb_owner'
      AND pg_catalog.current_database() = 'neondb'
      AND NOT (SELECT role.rolsuper FROM pg_catalog.pg_roles AS role
                WHERE role.oid = table_owner)
      AND (SELECT role.rolbypassrls FROM pg_catalog.pg_roles AS role
            WHERE role.oid = table_owner)
    )
    OR
    (
      current_user = 'ci'
      AND pg_catalog.current_database() = 'grainline_ci'
      AND (SELECT role.rolsuper FROM pg_catalog.pg_roles AS role
            WHERE role.oid = table_owner)
    )
  ) THEN
    RAISE EXCEPTION 'ClerkWebhookEvent FORCE owner boundary is unreviewed';
  END IF;

  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime'
     AND role.rolcanlogin
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND NOT role.rolcreatedb
     AND NOT role.rolcreaterole
     AND NOT role.rolreplication
     AND NOT role.rolbypassrls;

  -- Neon may retain only this non-effective administrative bootstrap edge.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
     WHERE (
       member.rolname = 'grainline_app_runtime'
       OR granted_role.rolname = 'grainline_app_runtime'
     )
       AND NOT (
         granted_role.rolname = 'grainline_app_runtime'
         AND member.rolname = 'neondb_owner'
         AND grantor.rolname = 'cloud_admin'
         AND membership.admin_option
         AND NOT membership.inherit_option
         AND NOT membership.set_option
       )
  ) THEN
    RAISE EXCEPTION 'ClerkWebhookEvent FORCE runtime membership drifted';
  END IF;

  IF current_user = 'neondb_owner' THEN
    SELECT pg_catalog.count(*)::integer
      INTO owner_session_count
      FROM pg_catalog.pg_stat_activity AS activity
     WHERE activity.datname = pg_catalog.current_database()
       AND activity.usename = current_user
       AND activity.backend_type = 'client backend'
       AND activity.pid <> pg_catalog.pg_backend_pid();
    IF owner_session_count <> 0 THEN
      RAISE EXCEPTION
        'ClerkWebhookEvent owner-session drain is incomplete: % other owner sessions remain',
        owner_session_count;
    END IF;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO activation_migration_count
    FROM public._prisma_migrations AS migration
   WHERE migration.migration_name =
         '20261010160000_enable_clerk_webhook_event_rls'
     AND migration.checksum =
         '7c5fc7f61280a14695b8a2b2c4e1b3d354aeae40f581f952e529015cf70066d9'
     AND migration.finished_at IS NOT NULL
     AND migration.rolled_back_at IS NULL
     AND migration.applied_steps_count = 1;
  IF activation_migration_count <> 1 THEN
    RAISE EXCEPTION 'ClerkWebhookEvent FORCE activation ledger drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."ClerkWebhookEvent"'::pg_catalog.regclass
     AND class.relowner = table_owner
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee <> class.relowner
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = class.oid
          AND constraint_row.conname = 'ClerkWebhookEvent_claimGeneration_check'
          AND constraint_row.contype = 'c'
          AND constraint_row.convalidated
     )
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = class.oid
          AND attribute.attname = 'claimGeneration'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND attribute.attnotnull
          AND attribute.atthasdef
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'ClerkWebhookEvent FORCE predecessor table posture drifted';
  END IF;

  SELECT pg_catalog.count(*)
    INTO invalid_row_count
    FROM public."ClerkWebhookEvent" AS event
   WHERE pg_catalog.btrim(event."svixId") = ''
      OR pg_catalog.btrim(event.type) = ''
      OR event."claimGeneration" < 0
      OR (event."processedAt" IS NOT NULL AND event."processingStartedAt" IS NULL)
      OR (event."processedAt" IS NOT NULL
          AND event."processedAt" < event."processingStartedAt")
      OR (event."processedAt" IS NOT NULL AND event."lastError" IS NOT NULL);
  IF invalid_row_count <> 0 THEN
    RAISE EXCEPTION 'ClerkWebhookEvent FORCE found invalid rows: %', invalid_row_count;
  END IF;

  WITH expected(proname, identity_arguments, source_md5) AS (
    VALUES
      ('grainline_clerk_webhook_begin', 'text, text',
       '7a0c51172ff78879207a9052a4319132'),
      ('grainline_clerk_webhook_complete', 'text, bigint',
       '1f06d03edb937256ef8fab48f63acf9d'),
      ('grainline_clerk_webhook_fail', 'text, bigint, text',
       '21472983636832a7ff75d3e84b1bbf84'),
      ('grainline_clerk_webhook_prune_batch', 'integer',
       '1366d9cfa63ea4f61988085979995ff3'),
      ('grainline_clerk_webhook_health_summary', '',
       'e204c8120a8c26a421de3287e8b1e92b')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.proname
     AND pg_catalog.oidvectortypes(procedure.proargtypes) =
         expected.identity_arguments
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.prokind = 'f'
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND procedure.proowner = table_owner
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.privilege_type = 'EXECUTE'
          AND (
            acl.grantee NOT IN (procedure.proowner, runtime_role_oid)
            OR (acl.grantee = runtime_role_oid
                AND (acl.grantor <> procedure.proowner OR acl.is_grantable))
          )
     )
     AND pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') = 0
     AND pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'FORMAT(') = 0;
  IF accepted_function_count <> 5 THEN
    RAISE EXCEPTION
      'ClerkWebhookEvent FORCE function authority drifted: %',
      accepted_function_count;
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND pg_catalog.has_function_privilege(
         'grainline_app_runtime', procedure.oid, 'EXECUTE'
       )
       AND pg_catalog.strpos(procedure.prosrc, '"ClerkWebhookEvent"') > 0
  ) <> 5 THEN
    RAISE EXCEPTION 'ClerkWebhookEvent FORCE executable function surface drifted';
  END IF;
END
$grainline_clerk_webhook_event_force_preflight$;

ALTER TABLE public."ClerkWebhookEvent" FORCE ROW LEVEL SECURITY;

DO $grainline_clerk_webhook_event_force_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."ClerkWebhookEvent"'::pg_catalog.regclass
     AND class.relrowsecurity
     AND class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee <> class.relowner
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'ClerkWebhookEvent FORCE posture did not converge';
  END IF;
END
$grainline_clerk_webhook_event_force_postflight$;

COMMIT;
