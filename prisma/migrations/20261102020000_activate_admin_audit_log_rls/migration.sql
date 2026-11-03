BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.admin-audit-log.rls.activation', 0)
);

LOCK TABLE public."AdminAuditLog" IN ACCESS EXCLUSIVE MODE;

DO $grainline_admin_audit_rls_preflight$
DECLARE
  runtime_oid oid;
  staff_oid oid;
  account_deletion_oid oid;
  table_oid oid;
  table_owner oid;
  current_role_oid oid;
  reviewed_function text;
  expected_source_md5 text;
  expected_volatility "char";
  expected_runtime_execute boolean;
  expected_staff_execute boolean;
  expected_account_deletion_execute boolean;
  existing_privileges text[];
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT oid INTO staff_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_staff_read_runtime';
  SELECT oid INTO account_deletion_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_account_deletion_runtime';
  IF runtime_oid IS NULL OR staff_oid IS NULL OR account_deletion_oid IS NULL THEN
    RAISE EXCEPTION 'AdminAuditLog runtime roles are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE oid IN (runtime_oid, staff_oid, account_deletion_oid)
       AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
            OR rolreplication OR rolbypassrls)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
     WHERE member IN (runtime_oid, staff_oid, account_deletion_oid)
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog runtime role posture is unsafe';
  END IF;

  SELECT relation.oid, relation.relowner INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relname = 'AdminAuditLog'
     AND relation.relkind = 'r';
  SELECT oid INTO current_role_oid FROM pg_catalog.pg_roles
   WHERE rolname = current_user;
  IF table_oid IS NULL OR table_owner IS DISTINCT FROM current_role_oid
     OR current_user <> session_user
     OR table_owner IN (runtime_oid, staff_oid, account_deletion_oid) THEN
    RAISE EXCEPTION 'AdminAuditLog activation must run as the non-runtime table owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS owner_role
     WHERE owner_role.oid = table_owner
       AND (owner_role.rolsuper OR owner_role.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog owner must bypass RLS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog predecessor RLS posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
      attribute.attname::text || ':'
      || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
      || ':' || attribute.attnotnull::text
      ORDER BY attribute.attnum
    )
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0 AND NOT attribute.attisdropped
  ) IS DISTINCT FROM ARRAY[
    'id:text:true',
    'adminId:text:true',
    'action:character varying(100):true',
    'targetType:character varying(100):true',
    'targetId:character varying(255):true',
    'reason:character varying(1000):false',
    'metadata:jsonb:true',
    'undone:boolean:true',
    'undoneAt:timestamp(3) without time zone:false',
    'undoneBy:character varying(255):false',
    'undoneReason:character varying(1000):false',
    'createdAt:timestamp(3) without time zone:true'
  ]::text[] THEN
    RAISE EXCEPTION 'AdminAuditLog columns drifted';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(
      constraint_state.conname::text || ':' || constraint_state.contype::text
      || ':' || pg_catalog.pg_get_constraintdef(constraint_state.oid, true)
      ORDER BY constraint_state.conname
    )
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = table_oid
       AND constraint_state.convalidated
  ) IS DISTINCT FROM ARRAY[
    'AdminAuditLog_adminId_fkey:f:FOREIGN KEY ("adminId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT',
    'AdminAuditLog_pkey:p:PRIMARY KEY (id)'
  ]::text[] THEN
    RAISE EXCEPTION 'AdminAuditLog constraints drifted';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(
      index_relation.relname::text || ':' || index_state.indisprimary::text
      || ':' || index_state.indisunique::text || ':'
      || pg_catalog.pg_get_indexdef(index_state.indexrelid)
      ORDER BY index_relation.relname
    )
      FROM pg_catalog.pg_index AS index_state
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_state.indexrelid
     WHERE index_state.indrelid = table_oid
       AND index_state.indisvalid AND index_state.indisready
       AND NOT index_state.indisexclusion
       AND index_state.indpred IS NULL AND index_state.indexprs IS NULL
  ) IS DISTINCT FROM ARRAY[
    'AdminAuditLog_action_createdAt_id_idx:false:false:CREATE INDEX "AdminAuditLog_action_createdAt_id_idx" ON public."AdminAuditLog" USING btree (action, "createdAt" DESC, id DESC)',
    'AdminAuditLog_adminId_idx:false:false:CREATE INDEX "AdminAuditLog_adminId_idx" ON public."AdminAuditLog" USING btree ("adminId")',
    'AdminAuditLog_createdAt_id_idx:false:false:CREATE INDEX "AdminAuditLog_createdAt_id_idx" ON public."AdminAuditLog" USING btree ("createdAt" DESC, id DESC)',
    'AdminAuditLog_createdAt_idx:false:false:CREATE INDEX "AdminAuditLog_createdAt_idx" ON public."AdminAuditLog" USING btree ("createdAt")',
    'AdminAuditLog_pkey:true:true:CREATE UNIQUE INDEX "AdminAuditLog_pkey" ON public."AdminAuditLog" USING btree (id)',
    'AdminAuditLog_targetType_targetId_idx:false:false:CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON public."AdminAuditLog" USING btree ("targetType", "targetId")',
    'AdminAuditLog_undone_idx:false:false:CREATE INDEX "AdminAuditLog_undone_idx" ON public."AdminAuditLog" USING btree (undone)'
  ]::text[] THEN
    RAISE EXCEPTION 'AdminAuditLog indexes drifted';
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
    RAISE EXCEPTION 'AdminAuditLog trigger inventory drifted';
  END IF;

  FOR reviewed_function, expected_source_md5, expected_volatility,
      expected_runtime_execute, expected_staff_execute,
      expected_account_deletion_execute IN
    SELECT expected.identity, expected.source_md5, expected.volatility,
           expected.runtime_execute, expected.staff_execute,
           expected.account_deletion_execute
      FROM (VALUES
        ('public.grainline_admin_audit_redact_deleted_references(jsonb)', 'c551f59a4db7f8983f0303ff39f75081', 's'::"char", false, false, false),
        ('public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer)', 'cf296b4be263c7c4401b772ac2eefa27', 'v'::"char", true, false, false),
        ('public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)', '291d008c79a54361457db79af0866c90', 'v'::"char", false, false, true),
        ('public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text)', '03e3bd3b6492fd92ac5cb185cdd8c140', 'v'::"char", false, false, true),
        ('public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb)', 'aa23e82358410a83bcec6934e91c225f', 'v'::"char", true, false, false),
        ('public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid)', '1946c865fc7648ed804b7843560bd12d', 'v'::"char", true, false, false),
        ('public.grainline_admin_audit_append(text,text,text,text,text,jsonb)', '2717795403771ca43185a692fd044327', 'v'::"char", true, false, false),
        ('public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)', '1badcedb29501f9673047d4956fd3082', 'v'::"char", false, true, false),
        ('public.grainline_admin_audit_ban_repair_candidates(integer)', '7a71e9ad2909ea9b69681d0af4c07ce1', 's'::"char", false, true, false),
        ('public.grainline_admin_audit_ban_repair_state(text,text)', '4bf70e7a81bb1425e25b967ace591c93', 's'::"char", false, true, false),
        ('public.grainline_admin_audit_insert_write_fence()', '4bcd56446a8a9315e4db051953e254db', 'v'::"char", false, false, false),
        ('public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer)', 'da0d1f371915d4514ed707228f13c288', 's'::"char", false, true, false),
        ('public.grainline_admin_audit_staff_count(text,text)', 'f35d09c1ff1ff28358b00368fcfcb74c', 's'::"char", false, true, false),
        ('public.grainline_admin_audit_staff_page(text,text,integer,integer)', 'b3a5996b00f0beebb9a500d82ed85cca', 's'::"char", false, true, false),
        ('public.grainline_admin_audit_staff_undo_source(text,text)', 'ea64170385a49bfa73a7e87e5b9727d5', 's'::"char", false, true, false),
        ('public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb)', '507a0c3289b6e486c714fe212708a7e5', 'v'::"char", true, false, false),
        ('public.grainline_case_escalate(text,text)', '7fb704ae47cceb2ac55b60aa61618e91', 'v'::"char", true, false, false),
        ('public.grainline_case_mark_resolved(text,text)', '27dd289e4be60e8b3df75c7a8b39f148', 'v'::"char", true, false, false),
        ('public.grainline_case_open(text,text,text,text)', '741cef386e47a5047c059656f22f3812', 'v'::"char", true, false, false),
        ('public.grainline_case_staff_resolution_finalize(text,text)', 'd1e73a4b90457eebc4cb8b65a04df528', 'v'::"char", true, false, false),
        ('public.grainline_case_staff_resolution_prepare(text,text,"CaseResolution",integer,jsonb)', 'd5412288461f814b1cbdc8955e871002', 'v'::"char", true, false, false),
        ('public.grainline_case_staff_resolution_provider_recover(text,text,text,bigint,text)', '7840bfc168798289fe9ef3ddab4ebb48', 'v'::"char", true, false, false),
        ('public.grainline_case_staff_resolution_provider_recovery_load(text,text,"CaseResolution",integer)', '327fc22237b066f9985ffea5536351a7', 'v'::"char", true, false, false),
        ('public.grainline_case_staff_resolution_provider_recovery_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)', '4298465f21eb922679fbcdf4cf618f4e', 'v'::"char", true, false, false),
        ('public.grainline_case_staff_resolution_reconcile(text,text,text,text)', '7377d9d6edc8afbda7e1cfb646bfec7a', 'v'::"char", true, false, false),
        ('public.grainline_case_staff_resolution_recovery_finalize(text,text)', '231d5a66f8578e36d878962ae6f6518e', 'v'::"char", true, false, false),
        ('public.grainline_notification_create_core(text,text,"NotificationType",text,text,text)', '974a228c0b6feb00564f107a858ff526', 'v'::"char", false, false, false),
        ('public.grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)', '8f71265e548591a89822e303f3e38edc', 'v'::"char", true, false, false),
        ('public.grainline_order_staff_append_note(text,text,text)', '41e7da012f172b02c422646b45e14331', 'v'::"char", false, true, false),
        ('public.grainline_order_staff_mark_reviewed(text,text)', '35caba734684baa1a9e9fdf881ef6f6e', 'v'::"char", false, true, false),
        ('public.grainline_order_staff_record_label_voided(text,text)', 'f0d0df1cc7ccafcba5a6cc9576c717c5', 'v'::"char", false, true, false),
        ('public.grainline_seller_broadcast_staff_delete(text,text)', 'ac86e72979124163b53cb92daa304ab9', 'v'::"char", false, true, false),
        ('public.grainline_seller_guild_staff_transition(text,text,text,text,text,boolean)', 'f9a3129394ea98c3dde69f81d4702477', 'v'::"char", false, true, false),
        ('public.grainline_seller_guild_staff_transition_prepared_impl(text,text,text,text,text,boolean)', '5cc52746e1be3955628192bf32364d7f', 'v'::"char", false, false, false),
        ('public.grainline_seller_staff_feature_transition(text,text,text)', 'd39ae1720ea58ca08ae2cb973e614f97', 'v'::"char", false, true, false),
        ('public.grainline_seller_staff_listing_review_transition(text,text,text,text)', '22c9d7589dba4a2beed64272f8c2225b', 'v'::"char", false, true, false),
        ('public.grainline_support_request_staff_transition(text,text,text)', '2db010ae88a75ccdd31ffe3fb3442828', 'v'::"char", true, false, false),
        ('public.grainline_user_ban_repair_target(text,text)', '2b5da72431dffa128eca1da12ae8f7d3', 's'::"char", false, true, false),
        ('public.grainline_user_report_staff_resolve(text,text,text,text)', 'bd046f573657ed7a948ef85aa034002f', 'v'::"char", false, true, false)
      ) AS expected(
        identity, source_md5, volatility, runtime_execute, staff_execute,
        account_deletion_execute
      )
  LOOP
    IF pg_catalog.to_regprocedure(reviewed_function) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = procedure.proowner
      WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
        AND procedure.proowner = table_owner AND procedure.prosecdef
        AND procedure.prokind = 'f'
        AND procedure.provolatile = expected_volatility
        AND procedure.proparallel = 'u'
        AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
        AND pg_catalog.md5(procedure.prosrc) = expected_source_md5
        AND (owner_role.rolsuper OR owner_role.rolbypassrls)
        AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
        AND pg_catalog.has_function_privilege(runtime_oid, procedure.oid, 'EXECUTE')
              IS NOT DISTINCT FROM expected_runtime_execute
        AND pg_catalog.has_function_privilege(staff_oid, procedure.oid, 'EXECUTE')
              IS NOT DISTINCT FROM expected_staff_execute
        AND pg_catalog.has_function_privilege(
              account_deletion_oid, procedure.oid, 'EXECUTE'
            ) IS NOT DISTINCT FROM expected_account_deletion_execute
    ) THEN
      RAISE EXCEPTION 'AdminAuditLog reviewed function posture drifted: %',
        reviewed_function;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosrc LIKE '%public."AdminAuditLog"%'
      AND procedure.oid <> ALL (ARRAY[
        pg_catalog.to_regprocedure('public.grainline_admin_audit_redact_deleted_references(jsonb)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_append(text,text,text,text,text,jsonb)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_ban_repair_candidates(integer)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_ban_repair_state(text,text)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_insert_write_fence()'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_staff_count(text,text)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_staff_page(text,text,integer,integer)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_staff_undo_source(text,text)'),
        pg_catalog.to_regprocedure('public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb)'),
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
      ]::oid[])
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog has an unreviewed function reader or writer';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(
      DISTINCT pg_catalog.upper(acl.privilege_type)
      ORDER BY pg_catalog.upper(acl.privilege_type)), ARRAY[]::text[])
    INTO existing_privileges
    FROM pg_catalog.aclexplode(COALESCE(
      (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
      pg_catalog.acldefault('r', table_owner))) AS acl
   WHERE acl.grantee = runtime_oid;
  IF existing_privileges IS DISTINCT FROM
       ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[] THEN
    RAISE EXCEPTION 'AdminAuditLog runtime predecessor grants drifted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
      (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
      pg_catalog.acldefault('r', table_owner))) AS acl
     WHERE acl.grantee NOT IN (table_owner, runtime_oid)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE attribute.attrelid = table_oid AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog predecessor ACL drifted';
  END IF;
END
$grainline_admin_audit_rls_preflight$;

REVOKE ALL ON TABLE public."AdminAuditLog"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime,
       grainline_account_deletion_runtime;

ALTER TABLE public."AdminAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AdminAuditLog" FORCE ROW LEVEL SECURITY;

DO $grainline_admin_audit_rls_postflight$
DECLARE
  table_oid oid := 'public."AdminAuditLog"'::pg_catalog.regclass;
  table_owner oid;
BEGIN
  SELECT relowner INTO table_owner FROM pg_catalog.pg_class WHERE oid = table_oid;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND relrowsecurity AND relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog activation posture drifted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
      (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
      pg_catalog.acldefault('r', table_owner))) AS acl
     WHERE acl.grantee <> table_owner
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE attribute.attrelid = table_oid AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog activation left direct authority';
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
    RAISE EXCEPTION 'AdminAuditLog trigger drifted after activation';
  END IF;
END
$grainline_admin_audit_rls_postflight$;

COMMIT;
