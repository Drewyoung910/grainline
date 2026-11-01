BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.seller_broadcast.rls.activation', 0)
);

-- SellerBroadcast participates in notification, email, upload, staff, and
-- account-deletion lock graphs. Freeze only this source table: locking any of
-- those adjacent tables here would introduce a new cross-domain lock order.
LOCK TABLE public."SellerBroadcast" IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_broadcast_rls_preflight$
DECLARE
  runtime_oid oid;
  staff_oid oid;
  table_oid oid;
  table_owner oid;
  current_role_oid oid;
  reviewed_function text;
  expected_source_md5 text;
  expected_volatility "char";
  expected_runtime_execute boolean;
  expected_staff_execute boolean;
  existing_privileges text[];
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT oid INTO staff_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_staff_read_runtime';
  IF runtime_oid IS NULL OR staff_oid IS NULL THEN
    RAISE EXCEPTION 'SellerBroadcast runtime roles are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE oid IN (runtime_oid, staff_oid)
       AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
            OR rolreplication OR rolbypassrls)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
     WHERE member IN (runtime_oid, staff_oid)
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast runtime role posture is unsafe';
  END IF;

  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerBroadcast'
     AND class.relkind = 'r';
  SELECT oid INTO current_role_oid FROM pg_catalog.pg_roles
   WHERE rolname = current_user;
  IF table_oid IS NULL OR table_owner IS DISTINCT FROM current_role_oid
     OR current_user <> session_user OR table_owner IN (runtime_oid, staff_oid) THEN
    RAISE EXCEPTION 'SellerBroadcast activation must run as the non-runtime table owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS owner_role
     WHERE owner_role.oid = table_owner
       AND (owner_role.rolsuper OR owner_role.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast owner must bypass RLS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast predecessor RLS posture drifted';
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
    'sellerProfileId:text:true',
    'message:character varying(500):true',
    'imageUrl:character varying(2048):false',
    'sentAt:timestamp(3) without time zone:true',
    'recipientCount:integer:true'
  ]::text[] THEN
    RAISE EXCEPTION 'SellerBroadcast columns drifted';
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
    'SellerBroadcast_pkey:p:PRIMARY KEY (id)',
    'SellerBroadcast_sellerProfileId_fkey:f:FOREIGN KEY ("sellerProfileId") REFERENCES "SellerProfile"(id) ON UPDATE CASCADE ON DELETE CASCADE'
  ]::text[] THEN
    RAISE EXCEPTION 'SellerBroadcast constraints drifted';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(
      index_class.relname::text || ':' || index_state.indisprimary::text
      || ':' || index_state.indisunique::text || ':'
      || pg_catalog.pg_get_indexdef(index_state.indexrelid)
      ORDER BY index_class.relname
    )
      FROM pg_catalog.pg_index AS index_state
      JOIN pg_catalog.pg_class AS index_class
        ON index_class.oid = index_state.indexrelid
     WHERE index_state.indrelid = table_oid
       AND index_state.indisvalid AND index_state.indisready
       AND NOT index_state.indisexclusion
       AND index_state.indpred IS NULL AND index_state.indexprs IS NULL
  ) IS DISTINCT FROM ARRAY[
    'SellerBroadcast_pkey:true:true:CREATE UNIQUE INDEX "SellerBroadcast_pkey" ON public."SellerBroadcast" USING btree (id)',
    'SellerBroadcast_sellerProfileId_idx:false:false:CREATE INDEX "SellerBroadcast_sellerProfileId_idx" ON public."SellerBroadcast" USING btree ("sellerProfileId")',
    'SellerBroadcast_sentAt_idx:false:false:CREATE INDEX "SellerBroadcast_sentAt_idx" ON public."SellerBroadcast" USING btree ("sentAt")'
  ]::text[] THEN
    RAISE EXCEPTION 'SellerBroadcast indexes drifted';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(
      trigger_state.tgname::text || ':' || trigger_state.tgtype::text || ':'
      || trigger_function.oid::pg_catalog.regprocedure::text
      ORDER BY trigger_state.tgname
    )
      FROM pg_catalog.pg_trigger AS trigger_state
      JOIN pg_catalog.pg_proc AS trigger_function
        ON trigger_function.oid = trigger_state.tgfoid
     WHERE trigger_state.tgrelid = table_oid
       AND NOT trigger_state.tgisinternal
  ) IS DISTINCT FROM ARRAY[
    'grainline_direct_upload_release_seller_broadcast_delete:11:grainline_direct_upload_source_delete_trigger()'
  ]::text[] THEN
    RAISE EXCEPTION 'SellerBroadcast trigger inventory drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = procedure.proowner
    WHERE procedure.oid = 'public.grainline_direct_upload_source_delete_trigger()'::pg_catalog.regprocedure
      AND procedure.proowner = table_owner AND procedure.prosecdef
      AND procedure.provolatile = 'v' AND procedure.proparallel = 'u'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND pg_catalog.md5(procedure.prosrc) = 'dc9654ce4d73f46ba9220b751b8d7711'
      AND (owner_role.rolsuper OR owner_role.rolbypassrls)
      AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(runtime_oid, procedure.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(staff_oid, procedure.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast delete trigger function drifted';
  END IF;

  FOR reviewed_function, expected_source_md5, expected_volatility,
      expected_runtime_execute, expected_staff_execute IN
    SELECT expected.identity, expected.source_md5, expected.volatility,
           expected.runtime_execute, expected.staff_execute
      FROM (VALUES
        ('public.grainline_seller_broadcast_owner_cooldown()', 'a07a426d3dc919c6ae1b09a1410e6509', 's'::"char", true, false),
        ('public.grainline_seller_broadcast_owner_create(text,text,text,integer)', 'f1590be19d88eedd57f365f0524d16f8', 'v'::"char", true, false),
        ('public.grainline_seller_broadcast_owner_count()', 'e20c535d70ad5903feb5a7c28d6d37d1', 's'::"char", true, false),
        ('public.grainline_seller_broadcast_owner_page(integer,integer)', '1baad1295befca86b13e54e4c101e502', 's'::"char", true, false),
        ('public.grainline_seller_broadcast_owner_export()', 'f9f5919af560a7581eb4be93e25504a5', 's'::"char", true, false),
        ('public.grainline_seller_broadcast_public_latest(text)', '3be3cf56a24315784671ce2178dbd61f', 's'::"char", true, false),
        ('public.grainline_seller_broadcast_actor_feed_page(text[],timestamp without time zone,timestamp without time zone,text,text,integer)', 'de74178cf7edfa8883640bf02d94fe0c', 's'::"char", true, false),
        ('public.grainline_seller_broadcast_owner_delivery_source(text)', '7a770896bd57fc413a388cb877eb3d14', 's'::"char", true, false),
        ('public.grainline_seller_broadcast_owner_record_delivery(text,integer)', '61898781194429f66d0af20990787056', 'v'::"char", true, false),
        ('public.grainline_seller_broadcast_staff_count(text,text)', 'b572b25ca4e137dd59bd13c0d1161ff8', 's'::"char", false, true),
        ('public.grainline_seller_broadcast_staff_page(text,text,integer,integer)', '11e20437f90fdcfbebbf5bfcb46550cf', 's'::"char", false, true),
        ('public.grainline_seller_broadcast_staff_delete(text,text)', 'ac86e72979124163b53cb92daa304ab9', 'v'::"char", false, true),
        ('public.grainline_seller_broadcast_account_deletion_ids(text)', '83f46e05b031d51f867a306361d36b66', 'v'::"char", true, false),
        ('public.grainline_seller_broadcast_account_deletion_cleanup(text)', 'cf873e708d6c6523b7b8ed66158793b0', 'v'::"char", true, false),
        ('public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)', 'b439d44fe29c656392c8322e4ec03149', 'v'::"char", true, false),
        ('public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)', '974a228c0b6feb00564f107a858ff526', 'v'::"char", false, false),
        ('public.grainline_notification_delete_seller_broadcast(text)', 'a34d24cf5abbb0795249c812467d5ab2', 'v'::"char", true, false),
        ('public.grainline_direct_upload_sync_seller_broadcast(text,text)', '1602c79d3fb59aa5661ca784465200b3', 'v'::"char", true, false),
        ('public.grainline_email_outbox_source_owner(text,text)', 'f32d2865aba66aab667b098998cdb53d', 's'::"char", false, false),
        ('public.grainline_seller_staff_broadcast_targets(text,text[])', '734e8fcf676102b82d31203304e607d6', 's'::"char", false, true)
      ) AS expected(identity, source_md5, volatility, runtime_execute, staff_execute)
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
    ) THEN
      RAISE EXCEPTION 'SellerBroadcast reviewed function posture drifted: %', reviewed_function;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosrc LIKE '%public."SellerBroadcast"%'
      AND procedure.oid <> ALL (ARRAY[
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_owner_cooldown()'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_owner_create(text,text,text,integer)'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_owner_count()'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_owner_page(integer,integer)'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_owner_export()'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_public_latest(text)'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_actor_feed_page(text[],timestamp without time zone,timestamp without time zone,text,text,integer)'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_owner_delivery_source(text)'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_owner_record_delivery(text,integer)'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_staff_count(text,text)'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_staff_page(text,text,integer,integer)'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_staff_delete(text,text)'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_account_deletion_ids(text)'),
        pg_catalog.to_regprocedure('public.grainline_seller_broadcast_account_deletion_cleanup(text)'),
        pg_catalog.to_regprocedure('public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)'),
        pg_catalog.to_regprocedure('public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)'),
        pg_catalog.to_regprocedure('public.grainline_notification_delete_seller_broadcast(text)'),
        pg_catalog.to_regprocedure('public.grainline_direct_upload_sync_seller_broadcast(text,text)'),
        pg_catalog.to_regprocedure('public.grainline_email_outbox_source_owner(text,text)'),
        pg_catalog.to_regprocedure('public.grainline_seller_staff_broadcast_targets(text,text[])')
      ]::oid[])
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast has an unreviewed function reader';
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
    RAISE EXCEPTION 'SellerBroadcast runtime predecessor grants drifted';
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
    RAISE EXCEPTION 'SellerBroadcast predecessor ACL drifted';
  END IF;
END
$grainline_seller_broadcast_rls_preflight$;

REVOKE ALL ON TABLE public."SellerBroadcast"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

ALTER TABLE public."SellerBroadcast" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SellerBroadcast" FORCE ROW LEVEL SECURITY;

DO $grainline_seller_broadcast_rls_postflight$
DECLARE
  table_oid oid;
  table_owner oid;
BEGIN
  SELECT class.oid, class.relowner INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerBroadcast' AND class.relkind = 'r';
  IF table_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND relrowsecurity AND relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'SellerBroadcast activation posture drifted';
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
    RAISE EXCEPTION 'SellerBroadcast activation left direct authority';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(
      trigger_state.tgname::text || ':' || trigger_state.tgtype::text
      ORDER BY trigger_state.tgname)
      FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid AND NOT trigger_state.tgisinternal
  ) IS DISTINCT FROM ARRAY[
    'grainline_direct_upload_release_seller_broadcast_delete:11'
  ]::text[] THEN
    RAISE EXCEPTION 'SellerBroadcast trigger drifted after activation';
  END IF;
END
$grainline_seller_broadcast_rls_postflight$;

COMMIT;
