-- Emergency app-first rollback for
-- 20261102010000_prepare_admin_audit_log_authorities.
--
-- Deploy the reviewed predecessor application before running this transaction.
-- The prepared application calls the functions removed below, so database-first
-- rollback would break audit writes, staff tools and account deletion.
--
-- This rollback removes only the additive preparation objects. It preserves all
-- AdminAuditLog rows, predecessor table grants, RLS-off posture, constraints,
-- existing indexes and the 23 retained cross-domain functions.
--
-- Keep the successfully applied Prisma ledger row intact. Prisma cannot mark a
-- completed migration rolled back. Re-preparation requires a new reviewed
-- forward migration with a new name after the predecessor app is verified.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.admin-audit-log.preparation', 0)
);

LOCK TABLE public."AdminAuditLog" IN ACCESS EXCLUSIVE MODE;

DO $grainline_admin_audit_preparation_rollback_preflight$
DECLARE
  runtime_oid oid;
  staff_oid oid;
  account_deletion_oid oid;
  table_oid oid;
  table_owner oid;
  runtime_privileges text[];
  function_identity text;
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT oid INTO staff_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_staff_read_runtime';
  SELECT oid INTO account_deletion_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_account_deletion_runtime';
  SELECT relation.oid, relation.relowner INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relname = 'AdminAuditLog'
     AND relation.relkind = 'r';

  IF runtime_oid IS NULL OR staff_oid IS NULL OR account_deletion_oid IS NULL
     OR table_oid IS NULL OR current_user <> session_user
     OR table_owner IS DISTINCT FROM (
       SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user
     ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation rollback identity drifted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation rollback requires predecessor RLS posture';
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
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
        pg_catalog.acldefault('r', table_owner)
      )
    ) AS acl
   WHERE acl.grantee = runtime_oid;
  IF runtime_privileges IS DISTINCT FROM
       ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(COALESCE(
           (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
           pg_catalog.acldefault('r', table_owner)
         )) AS acl
        WHERE acl.grantee NOT IN (table_owner, runtime_oid)
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = table_oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
     ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation rollback grants drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             index_state.indexname::text ORDER BY index_state.indexname
           )
      FROM pg_catalog.pg_indexes AS index_state
     WHERE index_state.schemaname = 'public'
       AND index_state.tablename = 'AdminAuditLog'
       AND index_state.indexname IN (
         'AdminAuditLog_action_createdAt_id_idx',
         'AdminAuditLog_createdAt_id_idx'
       )
  ) IS DISTINCT FROM ARRAY[
    'AdminAuditLog_action_createdAt_id_idx',
    'AdminAuditLog_createdAt_id_idx'
  ]::text[] THEN
    RAISE EXCEPTION 'AdminAuditLog preparation rollback index posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             trigger_state.tgname::text || ':' || trigger_state.tgenabled::text
             || ':' || trigger_state.tgtype::text || ':'
             || trigger_function.oid::pg_catalog.regprocedure::text
             ORDER BY trigger_state.tgname
           )
      FROM pg_catalog.pg_trigger AS trigger_state
      JOIN pg_catalog.pg_proc AS trigger_function
        ON trigger_function.oid = trigger_state.tgfoid
     WHERE trigger_state.tgrelid = table_oid
       AND NOT trigger_state.tgisinternal
  ) IS DISTINCT FROM ARRAY[
    'AdminAuditLog_insert_write_fence:O:7:grainline_admin_audit_insert_write_fence()'
  ]::text[] THEN
    RAISE EXCEPTION 'AdminAuditLog preparation rollback trigger posture drifted';
  END IF;

  FOREACH function_identity IN ARRAY ARRAY[
    'public.grainline_admin_audit_insert_write_fence()',
    'public.grainline_admin_audit_append(text,text,text,text,text,jsonb)',
    'public.grainline_admin_audit_staff_count(text,text)',
    'public.grainline_admin_audit_staff_page(text,text,integer,integer)',
    'public.grainline_admin_audit_staff_undo_source(text,text)',
    'public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb)',
    'public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid)',
    'public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer)',
    'public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb)',
    'public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text)',
    'public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)',
    'public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer)',
    'public.grainline_admin_audit_ban_repair_candidates(integer)',
    'public.grainline_admin_audit_ban_repair_state(text,text)',
    'public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)'
  ]::text[] LOOP
    IF pg_catalog.to_regprocedure(function_identity) IS NULL THEN
      RAISE EXCEPTION 'AdminAuditLog preparation rollback function is missing: %',
        function_identity;
    END IF;
  END LOOP;
END;
$grainline_admin_audit_preparation_rollback_preflight$;

DROP TRIGGER "AdminAuditLog_insert_write_fence"
  ON public."AdminAuditLog";

DROP FUNCTION
  public.grainline_admin_audit_append(text,text,text,text,text,jsonb),
  public.grainline_admin_audit_staff_count(text,text),
  public.grainline_admin_audit_staff_page(text,text,integer,integer),
  public.grainline_admin_audit_staff_undo_source(text,text),
  public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb),
  public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid),
  public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer),
  public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb),
  public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text),
  public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text),
  public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer),
  public.grainline_admin_audit_ban_repair_candidates(integer),
  public.grainline_admin_audit_ban_repair_state(text,text),
  public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb),
  public.grainline_admin_audit_insert_write_fence();

DROP INDEX
  public."AdminAuditLog_action_createdAt_id_idx",
  public."AdminAuditLog_createdAt_id_idx";

DO $grainline_admin_audit_preparation_rollback_postflight$
DECLARE
  table_oid oid := 'public."AdminAuditLog"'::pg_catalog.regclass;
  function_identity text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation rollback changed RLS posture';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
     WHERE tgrelid = table_oid
       AND NOT tgisinternal
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'AdminAuditLog'
       AND indexname IN (
         'AdminAuditLog_action_createdAt_id_idx',
         'AdminAuditLog_createdAt_id_idx'
       )
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation rollback left additive objects';
  END IF;

  FOREACH function_identity IN ARRAY ARRAY[
    'public.grainline_admin_audit_insert_write_fence()',
    'public.grainline_admin_audit_append(text,text,text,text,text,jsonb)',
    'public.grainline_admin_audit_staff_count(text,text)',
    'public.grainline_admin_audit_staff_page(text,text,integer,integer)',
    'public.grainline_admin_audit_staff_undo_source(text,text)',
    'public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb)',
    'public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid)',
    'public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer)',
    'public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb)',
    'public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text)',
    'public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)',
    'public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer)',
    'public.grainline_admin_audit_ban_repair_candidates(integer)',
    'public.grainline_admin_audit_ban_repair_state(text,text)',
    'public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)'
  ]::text[] LOOP
    IF pg_catalog.to_regprocedure(function_identity) IS NOT NULL THEN
      RAISE EXCEPTION 'AdminAuditLog preparation rollback left function: %',
        function_identity;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid IN (
       pg_catalog.to_regprocedure('public.grainline_case_escalate(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_case_mark_resolved(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_case_open(text,text,text,text)'),
       pg_catalog.to_regprocedure('public.grainline_case_staff_resolution_finalize(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_case_staff_resolution_prepare(text,text,"CaseResolution",integer,jsonb)'),
       pg_catalog.to_regprocedure('public.grainline_case_staff_resolution_provider_recover(text,text,text,bigint,text)'),
       pg_catalog.to_regprocedure('public.grainline_case_staff_resolution_provider_recovery_load(text,text,"CaseResolution",integer)'),
       pg_catalog.to_regprocedure('public.grainline_case_staff_resolution_provider_recovery_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)'),
       pg_catalog.to_regprocedure('public.grainline_case_staff_resolution_reconcile(text,text,text,text)'),
       pg_catalog.to_regprocedure('public.grainline_case_staff_resolution_recovery_finalize(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_notification_create_core(text,text,"NotificationType",text,text,text)'),
       pg_catalog.to_regprocedure('public.grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)'),
       pg_catalog.to_regprocedure('public.grainline_order_staff_append_note(text,text,text)'),
       pg_catalog.to_regprocedure('public.grainline_order_staff_mark_reviewed(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_order_staff_record_label_voided(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_seller_broadcast_staff_delete(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_seller_guild_staff_transition(text,text,text,text,text,boolean)'),
       pg_catalog.to_regprocedure('public.grainline_seller_guild_staff_transition_prepared_impl(text,text,text,text,text,boolean)'),
       pg_catalog.to_regprocedure('public.grainline_seller_staff_feature_transition(text,text,text)'),
       pg_catalog.to_regprocedure('public.grainline_seller_staff_listing_review_transition(text,text,text,text)'),
       pg_catalog.to_regprocedure('public.grainline_support_request_staff_transition(text,text,text)'),
       pg_catalog.to_regprocedure('public.grainline_user_ban_repair_target(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_user_report_staff_resolve(text,text,text,text)')
     )
  ) <> 23 THEN
    RAISE EXCEPTION 'AdminAuditLog preparation rollback changed retained functions';
  END IF;
END;
$grainline_admin_audit_preparation_rollback_postflight$;

COMMIT;
