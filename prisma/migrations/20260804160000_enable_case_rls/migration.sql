-- Promoted reviewed policyless Case-family ENABLE activation.
-- FORCE RLS remains off for the separate post-activation hardening release.
--
-- Initial Case-family activation after:
--   1. compatible fixed functions and application conversion are live;
--   2. Case invariants are installed and production legacy preflight is clean;
--   3. the compatible read-mode convergence has made all 27 catalog
--      operations SECURITY DEFINER;
--   4. DirectUpload retirement/private-object gates are complete.
--
-- The completed inventory has zero ordinary direct Case-family access. These
-- three tables therefore become policyless service tables: RLS is enabled,
-- FORCE remains off for this release, and PUBLIC/runtime receive no table or
-- column privileges. Exact fixed functions remain the only runtime surface.

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

DO $grainline_case_activation_preflight$
DECLARE
  case_owner oid;
  table_count integer;
  function_count integer;
  runtime_function_count integer;
  validated_constraint_count integer;
  invariant_trigger_count integer;
  invariant_definer_function_count integer;
  invariant_invoker_function_count integer;
BEGIN
  SELECT class.relowner
    INTO STRICT case_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Case'
     AND class.relkind = 'r';

  SELECT pg_catalog.count(*)::integer
    INTO table_count
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
     AND NOT class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       class.oid,
       'SELECT'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       class.oid,
       'INSERT'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       class.oid,
       'UPDATE'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       class.oid,
       'DELETE'
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       class.oid,
       'TRUNCATE,REFERENCES,TRIGGER'
     );
  IF table_count <> 3 THEN
    RAISE EXCEPTION
      'Case activation predecessor table posture drifted: %',
      table_count;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
      JOIN pg_catalog.pg_class AS class
        ON class.oid = policy.polrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN (
         'Case',
         'CaseMessage',
         'CaseMessageAttachment'
       )
  ) THEN
    RAISE EXCEPTION
      'Case activation refuses an existing Case-family policy';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO validated_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS class
      ON class.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND (
       (
         class.relname = 'Case'
         AND constraint_row.conname IN (
           'Case_distinct_participants_check',
           'Case_clock_order_check',
           'Case_lifecycle_evidence_check',
           'Case_resolution_shape_check',
           'Case_resolution_marks_check'
         )
       )
       OR (
         class.relname = 'CaseMessage'
         AND constraint_row.conname = 'CaseMessage_body_check'
       )
     )
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;
  IF validated_constraint_count <> 6 THEN
    RAISE EXCEPTION
      'Case activation invariant constraints drifted: %',
      validated_constraint_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS class
        ON class.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'CaseMessage'
       AND attribute.attname = 'authorKind'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND attribute.attnotnull
  ) THEN
    RAISE EXCEPTION
      'Case activation requires CaseMessage.authorKind NOT NULL';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invariant_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS class
      ON class.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN (
       'Case',
       'CaseMessage',
       'CaseMessageAttachment'
     )
     AND trigger_row.tgname IN (
       'grainline_case_relationship_valid',
       'grainline_case_authority_fields_immutable',
       'grainline_case_status_transition_valid',
       'grainline_case_message_author_valid',
       'grainline_case_message_authority_fields_immutable',
       'grainline_case_message_maintain_thread',
       'grainline_case_opening_evidence_valid',
       'grainline_case_message_delete_keeps_opening_evidence',
       'grainline_case_attachment_parent_valid'
     )
     AND NOT trigger_row.tgisinternal
     AND trigger_row.tgenabled = 'O';
  IF invariant_trigger_count <> 9 THEN
    RAISE EXCEPTION
      'Case activation invariant trigger catalog drifted: %',
      invariant_trigger_count;
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
      'Case activation DEFINER invariant function catalog drifted: %',
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
      'Case activation INVOKER invariant function catalog drifted: %',
      invariant_invoker_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO function_count
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
  IF function_count <> 27 THEN
    RAISE EXCEPTION
      'Case activation function catalog drifted: %',
      function_count;
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
      'Case activation runtime function partition drifted: %',
      runtime_function_count;
  END IF;

END
$grainline_case_activation_preflight$;

ALTER TABLE public."Case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Case" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessage" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessageAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CaseMessageAttachment" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."Case"
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON TABLE public."CaseMessage"
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON TABLE public."CaseMessageAttachment"
  FROM PUBLIC, grainline_app_runtime;

DO $grainline_case_activation_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
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
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             class.relacl,
             pg_catalog.acldefault('r', class.relowner)
           )
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE',
            'REFERENCES',
            'TRIGGER'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT',
            'INSERT',
            'UPDATE',
            'REFERENCES'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     );

  IF accepted_table_count <> 3 THEN
    RAISE EXCEPTION
      'Case activation did not establish exact policyless posture: %',
      accepted_table_count;
  END IF;
END
$grainline_case_activation_postflight$;

COMMIT;
