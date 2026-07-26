-- Promoted reviewed Conversation/Message initial RLS activation migration.

-- Apply only through the guarded main-only production migration workflow.

-- docs/rls-drafts/conversation-message-policies.sql sha256=34b70a13659ab78af85779c95788e7c1c444011950b8cdd70eeddb96605b4da7

BEGIN;

SET LOCAL lock_timeout = '10s';

SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.conversation-message.rls.activation', 0)
);

DO $grainline_conversation_message_activation_preflight$
DECLARE
  runtime_role record;
  table_count integer;
  policy_count integer;
  function_count integer;
  expected record;
  function_oid oid;
  actual record;
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
      'grainline_app_runtime role posture is not Conversation/Message-safe';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message')
     AND class.relkind = 'r'
     AND NOT class.relrowsecurity
     AND NOT class.relforcerowsecurity;
  IF table_count <> 2 THEN
    RAISE EXCEPTION
      'Conversation and Message must both exist with RLS and FORCE disabled';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message');
  IF policy_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message activation requires zero predecessor policies';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"', 'DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"', 'DELETE'
     ) THEN
    RAISE EXCEPTION
      'Conversation/Message activation requires old-application CRUD predecessor grants';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_conversation_staff_report_visible',
       'grainline_conversation_get',
       'grainline_conversation_pair',
       'grainline_message_list',
       'grainline_message_unread_count',
       'grainline_message_latest_custom_request',
       'grainline_message_report_target_valid',
       'grainline_message_export',
       'grainline_conversation_inbox',
       'grainline_conversation_lock_pair_core',
       'grainline_conversation_listing_core',
       'grainline_conversation_get_or_create_core',
       'grainline_conversation_start',
       'grainline_message_send_ordinary',
       'grainline_conversation_set_archived',
       'grainline_message_mark_read',
       'grainline_conversation_claim_message_email',
       'grainline_message_send_custom_request',
       'grainline_message_create_commission_interest',
       'grainline_message_send_custom_order_ready',
       'grainline_account_deletion_email_key_core',
       'grainline_account_deletion_regex_escape_core',
       'grainline_account_deletion_redact_text_core',
       'grainline_message_redact_for_account_deletion',
       'grainline_seller_message_response_metrics'
     );
  IF function_count <> 25 THEN
    RAISE EXCEPTION
      'Conversation/Message authority function overload catalog drifted: %',
      function_count;
  END IF;

  FOR expected IN
    SELECT *
      FROM (VALUES
        (
      'grainline_conversation_staff_report_visible',
      'text',
      true,
      true
    ),
    (
      'grainline_conversation_get',
      'text,text',
      false,
      true
    ),
    (
      'grainline_conversation_pair',
      'text,text',
      false,
      true
    ),
    (
      'grainline_message_list',
      'text,text,text,timestamp without time zone,text,integer',
      false,
      true
    ),
    (
      'grainline_message_unread_count',
      'text',
      false,
      true
    ),
    (
      'grainline_message_latest_custom_request',
      'text,text,text',
      false,
      true
    ),
    (
      'grainline_message_report_target_valid',
      'text,text,text,text',
      false,
      true
    ),
    (
      'grainline_message_export',
      'text',
      false,
      true
    ),
    (
      'grainline_conversation_inbox',
      'text,boolean,text,timestamp without time zone,text,integer',
      false,
      true
    ),
    (
      'grainline_conversation_lock_pair_core',
      'text,text',
      true,
      false
    ),
    (
      'grainline_conversation_listing_core',
      'text,text,text',
      true,
      false
    ),
    (
      'grainline_conversation_get_or_create_core',
      'text,text,text,text',
      true,
      false
    ),
    (
      'grainline_conversation_start',
      'text,text,text,text',
      true,
      true
    ),
    (
      'grainline_message_send_ordinary',
      'text,text,text,text,text,text',
      true,
      true
    ),
    (
      'grainline_conversation_set_archived',
      'text,text,boolean',
      true,
      true
    ),
    (
      'grainline_message_mark_read',
      'text,text',
      true,
      true
    ),
    (
      'grainline_conversation_claim_message_email',
      'text,text',
      true,
      true
    ),
    (
      'grainline_message_send_custom_request',
      'text,text,text,text,text,text,integer,text,text',
      true,
      true
    ),
    (
      'grainline_message_create_commission_interest',
      'text,text,text,text,text',
      true,
      true
    ),
    (
      'grainline_message_send_custom_order_ready',
      'text,text,text',
      true,
      true
    ),
    (
      'grainline_account_deletion_email_key_core',
      'text',
      true,
      false
    ),
    (
      'grainline_account_deletion_regex_escape_core',
      'text',
      true,
      false
    ),
    (
      'grainline_account_deletion_redact_text_core',
      'text,text[]',
      true,
      false
    ),
    (
      'grainline_message_redact_for_account_deletion',
      'text',
      true,
      true
    ),
    (
      'grainline_seller_message_response_metrics',
      'text,timestamp without time zone',
      true,
      true
    )
      ) AS expected_function(
        function_name,
        identity_arguments,
        security_definer,
        runtime_execute
      )
  LOOP
    function_oid := pg_catalog.to_regprocedure(
      pg_catalog.format(
        'public.%I(%s)',
        expected.function_name,
        expected.identity_arguments
      )
    );
    IF function_oid IS NULL THEN
      RAISE EXCEPTION
        'Conversation/Message authority function is missing: %(%)',
        expected.function_name,
        expected.identity_arguments;
    END IF;

    SELECT
      procedure.prosecdef,
      procedure.proleakproof,
      procedure.proconfig,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      pg_catalog.has_function_privilege(
        'grainline_app_runtime',
        procedure.oid,
        'EXECUTE'
      ) AS runtime_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute
      INTO actual
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = function_oid;

    IF actual.prosecdef IS DISTINCT FROM expected.security_definer
       OR actual.proleakproof
       OR actual.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog']::text[]
       OR actual.owner_name IS DISTINCT FROM current_user
       OR actual.runtime_execute IS DISTINCT FROM expected.runtime_execute
       OR actual.public_execute THEN
      RAISE EXCEPTION
        'Conversation/Message authority function or ACL drifted: %',
        expected.function_name;
    END IF;
  END LOOP;
END
$grainline_conversation_message_activation_preflight$;

LOCK TABLE public."Conversation", public."Message" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public."Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Conversation" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Message" NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grainline_conversation_participant_or_reported_select
  ON public."Conversation";
CREATE POLICY grainline_conversation_participant_or_reported_select
  ON public."Conversation"
  FOR SELECT
  TO grainline_app_runtime
  USING (
    NULLIF(
      pg_catalog.current_setting('app.user_id', true),
      ''
    ) IN ("userAId", "userBId")
    OR public.grainline_conversation_staff_report_visible(id)
  );

DROP POLICY IF EXISTS grainline_message_participant_or_reported_select
  ON public."Message";
CREATE POLICY grainline_message_participant_or_reported_select
  ON public."Message"
  FOR SELECT
  TO grainline_app_runtime
  USING (
    NULLIF(
      pg_catalog.current_setting('app.user_id', true),
      ''
    ) IN ("senderId", "recipientId")
    OR public.grainline_conversation_staff_report_visible("conversationId")
  );

REVOKE ALL ON TABLE public."Conversation"
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON TABLE public."Message"
  FROM PUBLIC, grainline_app_runtime;
GRANT SELECT ON TABLE public."Conversation" TO grainline_app_runtime;
GRANT SELECT ON TABLE public."Message" TO grainline_app_runtime;

DO $grainline_conversation_message_activation_postflight$
DECLARE
  runtime_role_oid oid;
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

  SELECT pg_catalog.count(*)::integer
    INTO table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message')
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity;
  IF table_count <> 2 THEN
    RAISE EXCEPTION
      'Conversation/Message activation did not retain exact ENABLE plus NO FORCE state';
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
      OR policy.polroles IS DISTINCT FROM ARRAY[runtime_role_oid]::oid[]
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
      'Conversation/Message exact SELECT policy catalog drifted: count=% bad=%',
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
  IF bad_table_acl_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message runtime or PUBLIC table ACLs are broader than SELECT-only';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
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
      'Conversation/Message effective runtime table privileges are not SELECT-only';
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
      'Conversation/Message runtime or PUBLIC column ACLs must remain empty';
  END IF;
END
$grainline_conversation_message_activation_postflight$;

COMMIT;
