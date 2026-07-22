-- Reviewed Notification FORCE hardening migration.
-- Apply only through the guarded main-only production migration workflow.

BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.notification.rls.force', 0)
);

DO $grainline_notification_force_preflight$
DECLARE
  runtime_role record;
  owner_role record;
  notification_state record;
  policy_count integer;
BEGIN
  SELECT rolsuper, rolinherit, rolcanlogin, rolreplication, rolbypassrls
    INTO runtime_role
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  IF NOT FOUND
     OR runtime_role.rolsuper
     OR runtime_role.rolinherit
     OR NOT runtime_role.rolcanlogin
     OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION 'grainline_app_runtime role posture is not Notification FORCE-safe';
  END IF;

  SELECT rolsuper, rolcanlogin, rolbypassrls
    INTO owner_role
    FROM pg_catalog.pg_roles
   WHERE rolname = current_user;
  IF NOT FOUND OR NOT owner_role.rolcanlogin THEN
    RAISE EXCEPTION 'migration owner role posture is not Notification FORCE-safe';
  END IF;

  IF current_user = 'neondb_owner' THEN
    IF owner_role.rolsuper OR NOT owner_role.rolbypassrls THEN
      RAISE EXCEPTION 'neondb_owner role posture is not Notification FORCE-safe';
    END IF;
  ELSIF current_user = 'ci'
        AND pg_catalog.current_database() = 'grainline_ci' THEN
    IF NOT owner_role.rolsuper THEN
      RAISE EXCEPTION 'disposable CI migration owner posture drifted';
    END IF;
  ELSE
    RAISE EXCEPTION 'Notification FORCE migration must run as a reviewed migration owner';
  END IF;

  SELECT class.relrowsecurity,
         class.relforcerowsecurity,
         pg_catalog.pg_get_userbyid(class.relowner) AS owner_name
    INTO notification_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification'
     AND class.relkind = 'r';
  IF NOT FOUND
     OR NOT notification_state.relrowsecurity
     OR notification_state.relforcerowsecurity
     OR notification_state.owner_name <> current_user THEN
    RAISE EXCEPTION 'Notification must be exact ENABLE/NO FORCE and owner-held before FORCE';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification';
  IF policy_count <> 2 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
      JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'Notification'
       AND policy.polname NOT IN (
         'grainline_notification_recipient_select',
         'grainline_notification_recipient_update'
       )
  ) THEN
    RAISE EXCEPTION 'Notification exact recipient policy pair drifted before FORCE';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Notification"', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Notification"', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Notification"', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Notification"', 'UPDATE'
     )
     OR NOT pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."Notification"', 'read', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."Notification"', 'title', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'Notification runtime grants drifted before FORCE';
  END IF;
END
$grainline_notification_force_preflight$;

ALTER TABLE public."Notification" FORCE ROW LEVEL SECURITY;

DO $grainline_notification_force_postflight$
DECLARE
  notification_state record;
  policy_count integer;
BEGIN
  SELECT class.relrowsecurity,
         class.relforcerowsecurity,
         pg_catalog.pg_get_userbyid(class.relowner) AS owner_name
    INTO notification_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification'
     AND class.relkind = 'r';
  IF NOT FOUND
     OR NOT notification_state.relrowsecurity
     OR NOT notification_state.relforcerowsecurity
     OR notification_state.owner_name <> current_user THEN
    RAISE EXCEPTION 'Notification must finish FORCE-hardened with reviewed ownership';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification';
  IF policy_count <> 2 THEN
    RAISE EXCEPTION 'Notification recipient policy count drifted during FORCE';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Notification"', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Notification"', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Notification"', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Notification"', 'UPDATE'
     )
     OR NOT pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."Notification"', 'read', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."Notification"', 'title', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'Notification runtime grants drifted during FORCE';
  END IF;
END
$grainline_notification_force_postflight$;

COMMIT;
