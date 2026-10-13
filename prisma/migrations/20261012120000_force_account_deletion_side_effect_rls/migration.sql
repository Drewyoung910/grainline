-- AccountDeletionSideEffect Phase B posture hardening. Phase A already removed
-- ordinary application access and retained one dedicated-worker policy. This
-- migration changes only the table-owner bypass posture after live runtime proof.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.account-deletion-side-effect.rls.force',
    0
  )
);

LOCK TABLE public."AccountDeletionSideEffect" IN ACCESS EXCLUSIVE MODE;

DO $grainline_account_deletion_side_effect_force_preflight$
DECLARE
  table_owner oid;
  runtime_role_oid oid;
  worker_role_oid oid;
  owner_session_count integer;
  accepted_table_count integer;
  accepted_function_count integer;
  activation_migration_count integer;
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect FORCE requires a direct owner session';
  END IF;

  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'AccountDeletionSideEffect'
     AND class.relkind = 'r';

  IF table_owner IS DISTINCT FROM (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect FORCE table owner drifted';
  END IF;

  IF NOT (
    (
      current_user = 'neondb_owner'
      AND pg_catalog.current_database() = 'neondb'
      AND NOT (
        SELECT role.rolsuper
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
      AND (
        SELECT role.rolbypassrls
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
    )
    OR
    (
      current_user = 'ci'
      AND pg_catalog.current_database() = 'grainline_ci'
      AND (
        SELECT role.rolsuper
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
    )
  ) THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect FORCE owner boundary is unreviewed';
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

  SELECT role.oid
    INTO STRICT worker_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_account_deletion_runtime'
     AND role.rolcanlogin
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND NOT role.rolcreatedb
     AND NOT role.rolcreaterole
     AND NOT role.rolreplication
     AND NOT role.rolbypassrls;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.member IN (runtime_role_oid, worker_role_oid)
  ) THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect FORCE runtime role membership drifted';
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
        'AccountDeletionSideEffect owner-session drain is incomplete: % other owner sessions remain',
        owner_session_count;
    END IF;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO activation_migration_count
    FROM public._prisma_migrations AS migration
   WHERE migration.migration_name =
         '20261011180000_enable_account_deletion_side_effect_rls'
     AND migration.checksum =
         '86b511f8fec0104c4ef3c1fbc7b2017d40847b286ac92bf26cdafc12518c5b3b'
     AND migration.finished_at IS NOT NULL
     AND migration.rolled_back_at IS NULL
     AND migration.applied_steps_count = 1;
  IF activation_migration_count <> 1 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect FORCE activation ledger drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid =
         'public."AccountDeletionSideEffect"'::pg_catalog.regclass
     AND class.relowner = table_owner
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_account_deletion_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE'
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_account_deletion_runtime', class.oid,
       'TRUNCATE,REFERENCES,TRIGGER'
     )
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee = worker_role_oid
          AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
          AND NOT acl.is_grantable
     ) = 4
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee <> class.relowner
          AND NOT (
            acl.grantee = worker_role_oid
            AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
            AND NOT acl.is_grantable
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee IN (0, runtime_role_oid, worker_role_oid)
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     )
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
          AND policy.polname =
              'AccountDeletionSideEffect_account_deletion_runtime_all'
          AND policy.polcmd = '*'
          AND policy.polpermissive
          AND policy.polroles = ARRAY[worker_role_oid]::oid[]
          AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
          AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) = 'true'
     ) = 1
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     ) = 1;
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect FORCE predecessor table posture drifted';
  END IF;

  WITH expected(function_signature, runtime_execute, worker_execute) AS (
    VALUES
      ('public."grainline_account_deletion_side_effect_claim"(text)', false, true),
      ('public."grainline_account_deletion_side_effect_complete"(text,bigint,uuid)', false, true),
      ('public."grainline_account_deletion_side_effect_fail"(text,bigint,uuid,text)', false, true),
      ('public."grainline_account_deletion_media_enqueue_claimed"(text,bigint,uuid,text[])', false, false),
      ('public."grainline_account_deletion_media_key_enqueue_claimed"(text,bigint,uuid,text[])', true, false),
      ('public."grainline_account_deletion_claim_user"(text,bigint,uuid)', false, false),
      ('public."grainline_user_account_deletion_preflight"(text,bigint,uuid)', true, false),
      ('public."grainline_user_account_deletion_snapshot"(text,bigint,uuid)', true, false),
      ('public."grainline_user_account_deletion_finalize"(text,bigint,uuid)', true, false),
      ('public."grainline_case_account_deletion_redact"(text,bigint,uuid)', true, false),
      ('public."grainline_message_redact_for_account_deletion"(text,text,bigint,uuid)', true, false),
      ('public."grainline_order_account_deletion_scrub"(text,text,bigint,uuid,text[])', true, false),
      ('public."grainline_user_account_deletion_preflight"(text)', false, false),
      ('public."grainline_user_account_deletion_snapshot"(text)', false, false),
      ('public."grainline_user_account_deletion_finalize"(text)', false, false),
      ('public."grainline_case_account_deletion_redact"(text)', false, false),
      ('public."grainline_message_redact_for_account_deletion"(text)', false, false),
      ('public."grainline_order_account_deletion_scrub"(text,text[])', false, false)
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM expected
   WHERE pg_catalog.to_regprocedure(function_signature) IS NOT NULL
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       pg_catalog.to_regprocedure(function_signature),
       'EXECUTE'
     ) = runtime_execute
     AND pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       pg_catalog.to_regprocedure(function_signature),
       'EXECUTE'
     ) = worker_execute
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE procedure.oid =
              pg_catalog.to_regprocedure(function_signature)
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     );
  IF accepted_function_count <> 18 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect FORCE function authority drifted: %',
      accepted_function_count;
  END IF;
END
$grainline_account_deletion_side_effect_force_preflight$;

ALTER TABLE public."AccountDeletionSideEffect" FORCE ROW LEVEL SECURITY;

DO $grainline_account_deletion_side_effect_force_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid =
         'public."AccountDeletionSideEffect"'::pg_catalog.regclass
     AND class.relrowsecurity
     AND class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_account_deletion_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE'
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_account_deletion_runtime', class.oid,
       'TRUNCATE,REFERENCES,TRIGGER'
     )
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee = (
          SELECT role.oid
            FROM pg_catalog.pg_roles AS role
           WHERE role.rolname = 'grainline_account_deletion_runtime'
        )
          AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
          AND NOT acl.is_grantable
     ) = 4
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee <> class.relowner
          AND NOT (
            acl.grantee = (
              SELECT role.oid
                FROM pg_catalog.pg_roles AS role
               WHERE role.rolname = 'grainline_account_deletion_runtime'
            )
            AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
            AND NOT acl.is_grantable
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee IN (
            0,
            (SELECT role.oid FROM pg_catalog.pg_roles AS role
              WHERE role.rolname = 'grainline_app_runtime'),
            (SELECT role.oid FROM pg_catalog.pg_roles AS role
              WHERE role.rolname = 'grainline_account_deletion_runtime')
          )
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     )
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
          AND policy.polname =
              'AccountDeletionSideEffect_account_deletion_runtime_all'
          AND policy.polcmd = '*'
          AND policy.polpermissive
          AND policy.polroles = ARRAY[
            (SELECT role.oid
               FROM pg_catalog.pg_roles AS role
              WHERE role.rolname = 'grainline_account_deletion_runtime')
          ]::oid[]
          AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
          AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) = 'true'
     ) = 1
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     ) = 1;
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'AccountDeletionSideEffect FORCE posture did not converge';
  END IF;
END
$grainline_account_deletion_side_effect_force_postflight$;

COMMIT;
