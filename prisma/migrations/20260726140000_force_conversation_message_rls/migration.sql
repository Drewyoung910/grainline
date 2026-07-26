-- Reviewed Conversation/Message FORCE hardening migration.
-- Apply only through the guarded main-only production migration workflow.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.conversation-message.rls.force',
    0
  )
);

LOCK TABLE
  public."Conversation",
  public."Message"
IN ACCESS EXCLUSIVE MODE;

DO $grainline_conversation_message_force_preflight$
DECLARE
  runtime_role record;
  runtime_role_oid oid;
  owner_role record;
  owner_role_oid oid;
  owner_session_count integer;
  expected record;
  table_state record;
  policy_count integer;
  bad_policy_count integer;
  runtime_privileges text[];
  bad_table_acl_count integer;
  bad_column_acl_count integer;
BEGIN
  SELECT
    role.oid,
    role.rolsuper,
    role.rolinherit,
    role.rolcanlogin,
    role.rolcreatedb,
    role.rolcreaterole,
    role.rolreplication,
    role.rolbypassrls
    INTO runtime_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  IF NOT FOUND
     OR runtime_role.rolsuper
     OR runtime_role.rolinherit
     OR NOT runtime_role.rolcanlogin
     OR runtime_role.rolcreatedb
     OR runtime_role.rolcreaterole
     OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION
      'grainline_app_runtime role posture is not Conversation/Message FORCE-safe';
  END IF;
  runtime_role_oid := runtime_role.oid;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.member = runtime_role_oid
  ) THEN
    RAISE EXCEPTION
      'grainline_app_runtime must remain membership-free before Conversation/Message FORCE';
  END IF;

  SELECT
    role.oid,
    role.rolsuper,
    role.rolcanlogin,
    role.rolbypassrls
    INTO owner_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT owner_role.rolcanlogin THEN
    RAISE EXCEPTION
      'migration owner role posture is not Conversation/Message FORCE-safe';
  END IF;
  owner_role_oid := owner_role.oid;

  IF current_user = 'neondb_owner' THEN
    IF owner_role.rolsuper OR NOT owner_role.rolbypassrls THEN
      RAISE EXCEPTION
        'neondb_owner role posture is not Conversation/Message FORCE-safe';
    END IF;
  ELSIF current_user = 'ci'
        AND pg_catalog.current_database() = 'grainline_ci' THEN
    IF NOT owner_role.rolsuper THEN
      RAISE EXCEPTION
        'disposable CI migration owner posture drifted';
    END IF;
  ELSE
    RAISE EXCEPTION
      'Conversation/Message FORCE migration must run as a reviewed migration owner';
  END IF;

  IF owner_role_oid = runtime_role_oid THEN
    RAISE EXCEPTION
      'grainline_app_runtime must not be the Conversation/Message migration owner';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO owner_session_count
    FROM pg_catalog.pg_stat_activity AS activity
   WHERE activity.datname = pg_catalog.current_database()
     AND activity.usename = current_user
     AND activity.backend_type = 'client backend'
     AND activity.pid <> pg_catalog.pg_backend_pid();
  IF owner_session_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message owner-session drain is incomplete: % other owner sessions remain',
      owner_session_count;
  END IF;

  FOR expected IN
    SELECT *
      FROM (VALUES
        (
          'Conversation'::text,
          'grainline_conversation_participant_or_reported_select'::text,
          '((NULLIF(current_setting(''app.user_id'', true), '''') = "userAId") OR (NULLIF(current_setting(''app.user_id'', true), '''') = "userBId")) OR grainline_conversation_staff_report_visible(id)'::text
        ),
        (
          'Message'::text,
          'grainline_message_participant_or_reported_select'::text,
          '((NULLIF(current_setting(''app.user_id'', true), '''') = "senderId") OR (NULLIF(current_setting(''app.user_id'', true), '''') = "recipientId")) OR grainline_conversation_staff_report_visible("conversationId")'::text
        )
      ) AS expected_value(table_name, policy_name, using_expression)
  LOOP
    SELECT
      class.oid,
      class.relowner,
      class.relrowsecurity,
      class.relforcerowsecurity
      INTO table_state
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = expected.table_name
       AND class.relkind = 'r';
    IF NOT FOUND
       OR table_state.relowner <> owner_role_oid
       OR NOT table_state.relrowsecurity
       OR table_state.relforcerowsecurity THEN
      RAISE EXCEPTION
        'public.% must be exact owner-held ENABLE/NO FORCE before FORCE',
        expected.table_name;
    END IF;

    SELECT
      pg_catalog.count(*)::integer,
      pg_catalog.count(*) FILTER (
        WHERE policy.polname <> expected.policy_name
          OR policy.polcmd <> 'r'
          OR NOT policy.polpermissive
          OR policy.polroles IS DISTINCT FROM
            ARRAY[runtime_role_oid]::oid[]
          OR policy.polqual IS NULL
          OR policy.polwithcheck IS NOT NULL
          OR pg_catalog.regexp_replace(
            pg_catalog.replace(
              pg_catalog.pg_get_expr(
                policy.polqual,
                policy.polrelid
              ),
              '::text',
              ''
            ),
            '\s+',
            '',
            'g'
          ) <> pg_catalog.regexp_replace(
            expected.using_expression,
            '\s+',
            '',
            'g'
          )
      )::integer
      INTO policy_count, bad_policy_count
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_state.oid;
    IF policy_count <> 1 OR bad_policy_count <> 0 THEN
      RAISE EXCEPTION
        'public.% exact SELECT policy drifted before FORCE: count=% bad=%',
        expected.table_name,
        policy_count,
        bad_policy_count;
    END IF;

    SELECT COALESCE(
      pg_catalog.array_agg(
        DISTINCT pg_catalog.upper(acl.privilege_type)
        ORDER BY pg_catalog.upper(acl.privilege_type)
      ),
      ARRAY[]::text[]
    )
      INTO runtime_privileges
      FROM pg_catalog.aclexplode(
        COALESCE(
          (
            SELECT class.relacl
              FROM pg_catalog.pg_class AS class
             WHERE class.oid = table_state.oid
          ),
          pg_catalog.acldefault('r', table_state.relowner)
        )
      ) AS acl
     WHERE acl.grantee = runtime_role_oid;
    IF runtime_privileges IS DISTINCT FROM ARRAY['SELECT']::text[] THEN
      RAISE EXCEPTION
        'public.% runtime table privileges must remain exact SELECT-only before FORCE',
        expected.table_name;
    END IF;
  END LOOP;

  SELECT pg_catalog.count(*)::integer
    INTO bad_table_acl_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        class.relacl,
        pg_catalog.acldefault('r', class.relowner)
      )
    ) AS acl
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message')
     AND class.relkind = 'r'
     AND acl.grantee IN (0, runtime_role_oid)
     AND (
       acl.grantee = 0
       OR acl.privilege_type <> 'SELECT'
       OR acl.is_grantable
     );
  IF bad_table_acl_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message runtime or PUBLIC table ACLs are broader than SELECT-only before FORCE';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO bad_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message')
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee IN (0, runtime_role_oid);
  IF bad_column_acl_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message runtime or PUBLIC column ACLs must remain empty before FORCE';
  END IF;
END
$grainline_conversation_message_force_preflight$;

ALTER TABLE public."Conversation" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Message" FORCE ROW LEVEL SECURITY;

DO $grainline_conversation_message_force_postflight$
DECLARE
  runtime_role_oid oid;
  owner_role_oid oid;
  table_count integer;
  policy_count integer;
  bad_policy_count integer;
  bad_table_acl_count integer;
  bad_column_acl_count integer;
BEGIN
  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';

  SELECT role.oid
    INTO STRICT owner_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;

  SELECT pg_catalog.count(*)::integer
    INTO table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message')
     AND class.relkind = 'r'
     AND class.relowner = owner_role_oid
     AND class.relrowsecurity
     AND class.relforcerowsecurity;
  IF table_count <> 2 THEN
    RAISE EXCEPTION
      'Conversation/Message FORCE state did not persist on both reviewed tables';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (
      WHERE policy.polname NOT IN (
        'grainline_conversation_participant_or_reported_select',
        'grainline_message_participant_or_reported_select'
      )
      OR policy.polcmd <> 'r'
      OR NOT policy.polpermissive
      OR policy.polroles IS DISTINCT FROM
        ARRAY[runtime_role_oid]::oid[]
      OR policy.polqual IS NULL
      OR policy.polwithcheck IS NOT NULL
      OR (
        class.relname = 'Conversation'
        AND policy.polname <>
          'grainline_conversation_participant_or_reported_select'
      )
      OR (
        class.relname = 'Message'
        AND policy.polname <>
          'grainline_message_participant_or_reported_select'
      )
    )::integer
    INTO policy_count, bad_policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message');
  IF policy_count <> 2 OR bad_policy_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message policy catalog drifted during FORCE: count=% bad=%',
      policy_count,
      bad_policy_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO bad_table_acl_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        class.relacl,
        pg_catalog.acldefault('r', class.relowner)
      )
    ) AS acl
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message')
     AND class.relkind = 'r'
     AND acl.grantee IN (0, runtime_role_oid)
     AND (
       acl.grantee = 0
       OR acl.privilege_type <> 'SELECT'
       OR acl.is_grantable
     );
  IF bad_table_acl_count <> 0
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."Conversation"',
       'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."Message"',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."Conversation"',
       'INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."Message"',
       'INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'Conversation/Message runtime or PUBLIC table ACLs drifted during FORCE';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO bad_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message')
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee IN (0, runtime_role_oid);
  IF bad_column_acl_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message runtime or PUBLIC column ACLs drifted during FORCE';
  END IF;
END
$grainline_conversation_message_force_postflight$;

COMMIT;
