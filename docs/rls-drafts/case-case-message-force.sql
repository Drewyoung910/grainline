-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Separate post-drain FORCE hardening. This migration changes no row, policy,
-- table grant, function, invariant or private ledger.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.case.rls.activation', 0)
);

LOCK TABLE
  public."Case",
  public."CaseMessage",
  public."CaseMessageAttachment"
IN ACCESS EXCLUSIVE MODE;

DO $grainline_case_force_preflight$
DECLARE
  case_owner oid;
  runtime_role record;
  runtime_role_oid oid;
  owner_role record;
  owner_session_count integer;
  accepted_table_count integer;
  accepted_function_count integer;
  runtime_function_count integer;
  invariant_definer_function_count integer;
  invariant_invoker_function_count integer;
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
      'grainline_app_runtime role posture is not Case FORCE-safe';
  END IF;
  runtime_role_oid := runtime_role.oid;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.member = runtime_role_oid
        OR membership.roleid = runtime_role_oid
  ) THEN
    RAISE EXCEPTION
      'grainline_app_runtime must remain membership-free before Case FORCE';
  END IF;

  SELECT class.relowner
    INTO STRICT case_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Case'
     AND class.relkind = 'r';

  SELECT
    role.oid,
    role.rolsuper,
    role.rolcanlogin,
    role.rolbypassrls
    INTO owner_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND
     OR NOT owner_role.rolcanlogin
     OR owner_role.oid IS DISTINCT FROM case_owner
     OR owner_role.oid = runtime_role_oid THEN
    RAISE EXCEPTION
      'Case FORCE migration owner identity drifted';
  END IF;

  IF current_user = 'neondb_owner' THEN
    IF owner_role.rolsuper OR NOT owner_role.rolbypassrls THEN
      RAISE EXCEPTION
        'neondb_owner role posture is not Case FORCE-safe';
    END IF;
  ELSIF current_user = 'ci'
        AND pg_catalog.current_database() = 'grainline_ci' THEN
    IF NOT owner_role.rolsuper THEN
      RAISE EXCEPTION
        'disposable CI migration owner posture drifted';
    END IF;
  ELSE
    RAISE EXCEPTION
      'Case FORCE migration must run as a reviewed migration owner';
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
      'Case owner-session drain is incomplete: % other owner sessions remain',
      owner_session_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN (
       'Case',
       'CaseMessage',
       'CaseMessageAttachment'
     )
     AND class.relkind = 'r'
     AND class.relowner = case_owner
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime',
       class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT pg_catalog.has_table_privilege(
       'PUBLIC',
       class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'PUBLIC',
       class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF accepted_table_count <> 3 THEN
    RAISE EXCEPTION
      'Case FORCE predecessor drifted: %',
      accepted_table_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_case_get',
       'grainline_case_get_by_order',
       'grainline_case_message_page',
       'grainline_case_staff_queue',
       'grainline_case_staff_active_count',
       'grainline_case_export_page',
       'grainline_case_message_preflight',
       'grainline_direct_upload_case_attachment_read',
       'grainline_case_order_active_for_buyer',
       'grainline_case_order_active_for_seller',
       'grainline_order_buyer_pii_prune_batch',
       'grainline_case_seller_active_count',
       'grainline_case_seller_verification_eligibility',
       'grainline_case_guild_unresolved_guard',
       'grainline_case_account_deletion_blockers',
       'grainline_case_open',
       'grainline_case_reply',
       'grainline_case_mark_resolved',
       'grainline_case_escalate',
       'grainline_case_staff_resolution_prepare',
       'grainline_case_staff_resolution_finalize',
       'grainline_case_staff_resolution_provider_record',
       'grainline_case_staff_resolution_reconcile',
       'grainline_case_stripe_dispute_apply',
       'grainline_case_seller_refund_apply',
       'grainline_case_cron_transition_batch',
       'grainline_case_account_deletion_redact'
     )
     AND procedure.prokind = 'f'
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND procedure.proowner = case_owner
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     );
  IF accepted_function_count <> 27 THEN
    RAISE EXCEPTION
      'Case FORCE function catalog drifted: %',
      accepted_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO runtime_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_case_get',
       'grainline_case_get_by_order',
       'grainline_case_message_page',
       'grainline_case_staff_queue',
       'grainline_case_staff_active_count',
       'grainline_case_export_page',
       'grainline_case_message_preflight',
       'grainline_direct_upload_case_attachment_read',
       'grainline_case_order_active_for_buyer',
       'grainline_case_order_active_for_seller',
       'grainline_order_buyer_pii_prune_batch',
       'grainline_case_seller_active_count',
       'grainline_case_seller_verification_eligibility',
       'grainline_case_guild_unresolved_guard',
       'grainline_case_account_deletion_blockers',
       'grainline_case_open',
       'grainline_case_reply',
       'grainline_case_mark_resolved',
       'grainline_case_escalate',
       'grainline_case_staff_resolution_prepare',
       'grainline_case_staff_resolution_finalize',
       'grainline_case_staff_resolution_provider_record',
       'grainline_case_staff_resolution_reconcile',
       'grainline_case_stripe_dispute_apply',
       'grainline_case_seller_refund_apply',
       'grainline_case_cron_transition_batch',
       'grainline_case_account_deletion_redact'
     )
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       procedure.oid,
       'EXECUTE'
     );
  IF runtime_function_count <> 27 THEN
    RAISE EXCEPTION
      'Case FORCE runtime function partition drifted: %',
      runtime_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invariant_definer_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_case_relationship_valid',
       'grainline_case_message_author_valid',
       'grainline_case_message_maintain_thread',
       'grainline_case_opening_evidence_valid',
       'grainline_case_attachment_parent_valid'
     )
     AND procedure.prokind = 'f'
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND procedure.proowner = case_owner
     AND NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       procedure.oid,
       'EXECUTE'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     );
  IF invariant_definer_function_count <> 5 THEN
    RAISE EXCEPTION
      'Case FORCE DEFINER invariant function catalog drifted: %',
      invariant_definer_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invariant_invoker_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_case_authority_fields_immutable',
       'grainline_case_status_transition_valid',
       'grainline_case_message_authority_fields_immutable'
     )
     AND procedure.prokind = 'f'
     AND NOT procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND procedure.proowner = case_owner
     AND NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       procedure.oid,
       'EXECUTE'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     );
  IF invariant_invoker_function_count <> 3 THEN
    RAISE EXCEPTION
      'Case FORCE INVOKER invariant function catalog drifted: %',
      invariant_invoker_function_count;
  END IF;
END
$grainline_case_force_preflight$;

ALTER TABLE public."Case" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessage" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessageAttachment" FORCE ROW LEVEL SECURITY;

DO $grainline_case_force_postflight$
DECLARE
  forced_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO forced_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN (
       'Case',
       'CaseMessage',
       'CaseMessageAttachment'
     )
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND class.relforcerowsecurity
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );
  IF forced_table_count <> 3 THEN
    RAISE EXCEPTION
      'Case FORCE did not harden all three tables: %',
      forced_table_count;
  END IF;
END
$grainline_case_force_postflight$;

COMMIT;
