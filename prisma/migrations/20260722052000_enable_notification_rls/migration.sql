-- Promoted reviewed Notification activation migration.

-- Apply only through the guarded main-only production migration workflow.

-- docs/rls-drafts/notification-related-user.sql sha256=d8a394e3e586a2f51c006a69415bdf04326ce3affc6f42dba2186c255325e058
-- docs/rls-drafts/notification-recipient-access.sql sha256=8b59ef1d6164be6c48330c0c2c0560f1d5c401b7aa000fa094b3a390c00f14f8
-- docs/rls-drafts/notification-service-authority.sql sha256=03ec2b5c6b7babc1c67e8e86e9505d23747242b51433e1bf8e49cc62424dbe2f

BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.notification.rls.activation', 0)
);

DO $grainline_notification_activation_preflight$
DECLARE
  runtime_role record;
  notification_state record;
  policy_count integer;
  candidate_function_count integer;
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
    RAISE EXCEPTION 'grainline_app_runtime role posture is not Notification-safe';
  END IF;

  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO notification_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification'
     AND class.relkind = 'r';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public.Notification is missing';
  END IF;
  IF notification_state.relrowsecurity OR notification_state.relforcerowsecurity THEN
    RAISE EXCEPTION 'Notification RLS must be disabled before activation';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification';
  IF policy_count <> 0 THEN
    RAISE EXCEPTION 'Notification policies must not exist before activation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'Notification'
       AND attribute.attname = 'relatedUserId'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Notification.relatedUserId is missing from preparation';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO candidate_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY (ARRAY[
       'grainline_notification_unread_count',
       'grainline_notification_bell',
       'grainline_notification_page',
       'grainline_notification_mark_one_read',
       'grainline_notification_mark_many_read',
       'grainline_notification_mark_conversation_read',
       'grainline_notification_export',
       'grainline_notification_recent_low_stock',
       'grainline_notification_create_core',
       'grainline_notification_create_source_fanout',
       'grainline_notification_create_social_event',
       'grainline_notification_create_message_event',
       'grainline_notification_create_case_event',
       'grainline_notification_create_commission_event',
       'grainline_notification_create_inventory_event',
       'grainline_notification_create_verification_event',
       'grainline_notification_create_moderation_event',
       'grainline_notification_create_account_warning',
       'grainline_notification_create_order_event',
       'grainline_notification_claim_back_in_stock',
       'grainline_notification_delete_for_account',
       'grainline_notification_delete_blog_comment',
       'grainline_notification_delete_seller_broadcast',
       'grainline_notification_prune_read_batch',
       'grainline_notification_prune_unread_batch'
     ]::text[]);
  IF candidate_function_count <> 25 THEN
    RAISE EXCEPTION 'Notification preparation RPC inventory is incomplete: expected %, got %',
      25, candidate_function_count;
  END IF;
END
$grainline_notification_activation_preflight$;

LOCK TABLE public."Notification" IN ACCESS EXCLUSIVE MODE;

DO $grainline_notification_locked_purge$
DECLARE
  row_count_before bigint;
  deleted_count bigint;
  row_count_after bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO row_count_before FROM public."Notification";
  DELETE FROM public."Notification";
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  SELECT pg_catalog.count(*) INTO row_count_after FROM public."Notification";
  IF deleted_count <> row_count_before OR row_count_after <> 0 THEN
    RAISE EXCEPTION
      'Notification activation purge mismatch: before %, deleted %, after %',
      row_count_before, deleted_count, row_count_after;
  END IF;
END
$grainline_notification_locked_purge$;

ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Notification" NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grainline_notification_recipient_select
  ON public."Notification";
CREATE POLICY grainline_notification_recipient_select
  ON public."Notification"
  FOR SELECT
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(
      pg_catalog.current_setting('app.user_id', true),
      ''
    )
  );

DROP POLICY IF EXISTS grainline_notification_recipient_update
  ON public."Notification";
CREATE POLICY grainline_notification_recipient_update
  ON public."Notification"
  FOR UPDATE
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(
      pg_catalog.current_setting('app.user_id', true),
      ''
    )
  )
  WITH CHECK (
    "userId" = NULLIF(
      pg_catalog.current_setting('app.user_id', true),
      ''
    )
  );

REVOKE ALL ON TABLE public."Notification" FROM PUBLIC, grainline_app_runtime;
GRANT SELECT ON TABLE public."Notification" TO grainline_app_runtime;
GRANT UPDATE (read) ON TABLE public."Notification" TO grainline_app_runtime;

DO $grainline_notification_activation_postflight$
DECLARE
  notification_state record;
  policy_count integer;
BEGIN
  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO notification_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification';
  IF NOT FOUND OR NOT notification_state.relrowsecurity OR notification_state.relforcerowsecurity THEN
    RAISE EXCEPTION 'Notification must finish with ENABLE and NO FORCE';
  END IF;
  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification'
     AND policy.polname IN (
       'grainline_notification_recipient_select',
       'grainline_notification_recipient_update'
     );
  IF policy_count <> 2 THEN
    RAISE EXCEPTION 'Notification exact recipient policy pair is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public."Notification") THEN
    RAISE EXCEPTION 'Notification activation must finish with no legacy rows';
  END IF;
  IF NOT pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'SELECT')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'INSERT')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'DELETE')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'UPDATE')
     OR NOT pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."Notification"', 'read', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."Notification"', 'title', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'Notification runtime table grants are not activation-safe';
  END IF;
END
$grainline_notification_activation_postflight$;

COMMIT;
