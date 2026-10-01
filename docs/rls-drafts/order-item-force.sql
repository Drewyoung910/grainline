-- DRAFT ONLY. Do not apply to any persistent database.
-- Policyless OrderItem FORCE follows accepted ENABLE and retains the exact
-- zero-direct authority surface. OrderShippingRateQuote stays RLS-off as a
-- separate successor release.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order-item.rls.force', 0)
);
LOCK TABLE public."OrderItem" IN ACCESS EXCLUSIVE MODE;

DO $grainline_order_item_force_preflight$
DECLARE
  table_owner oid;
  runtime_role record;
  runtime_role_oid oid;
  staff_role record;
  staff_role_oid oid;
  owner_role record;
  owner_session_count integer;
  accepted_tables integer;
  accepted_functions integer;
  actual_function_count integer;
  expected_function_count integer;
  accepted_triggers integer;
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'OrderItem FORCE requires a direct owner session';
  END IF;

  SELECT
    role.oid, role.rolsuper, role.rolinherit, role.rolcanlogin,
    role.rolcreatedb, role.rolcreaterole, role.rolreplication,
    role.rolbypassrls
    INTO runtime_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  IF NOT FOUND
     OR runtime_role.rolsuper OR runtime_role.rolinherit
     OR NOT runtime_role.rolcanlogin OR runtime_role.rolcreatedb
     OR runtime_role.rolcreaterole OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION 'grainline_app_runtime role posture is not OrderItem FORCE-safe';
  END IF;
  runtime_role_oid := runtime_role.oid;

  -- Neon may retain only its non-effective administrative bootstrap edge:
  -- neondb_owner is a member of the restricted role, granted by cloud_admin
  -- with ADMIN but without INHERIT or SET. The restricted role must never be
  -- a member of the owner or another privileged role.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
     WHERE (
       member.rolname = 'grainline_app_runtime'
       OR granted_role.rolname = 'grainline_app_runtime'
     )
       AND NOT (
         granted_role.rolname = 'grainline_app_runtime'
         AND member.rolname = 'neondb_owner'
         AND grantor.rolname = 'cloud_admin'
         AND membership.admin_option
         AND NOT membership.inherit_option
         AND NOT membership.set_option
       )
  ) OR EXISTS (
    WITH RECURSIVE restricted_members AS (
      SELECT child.oid, child.rolname
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS parent ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles AS child ON child.oid = membership.member
       WHERE parent.rolname = 'grainline_app_runtime'
      UNION
      SELECT child.oid, child.rolname
        FROM restricted_members AS parent
        JOIN pg_catalog.pg_auth_members AS membership ON membership.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS child ON child.oid = membership.member
    )
    SELECT 1 FROM restricted_members WHERE rolname <> 'neondb_owner'
  ) THEN
    RAISE EXCEPTION 'OrderItem runtime role retains unreviewed role membership';
  END IF;

  SELECT
    role.oid, role.rolsuper, role.rolinherit, role.rolcanlogin,
    role.rolcreatedb, role.rolcreaterole, role.rolreplication,
    role.rolbypassrls
    INTO staff_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime';
  IF NOT FOUND
     OR staff_role.rolsuper OR staff_role.rolinherit
     OR NOT staff_role.rolcanlogin OR staff_role.rolcreatedb
     OR staff_role.rolcreaterole OR staff_role.rolreplication
     OR staff_role.rolbypassrls OR staff_role.oid = runtime_role_oid THEN
    RAISE EXCEPTION
      'grainline_staff_read_runtime role posture is not OrderItem FORCE-safe';
  END IF;
  staff_role_oid := staff_role.oid;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
     WHERE (
       member.rolname = 'grainline_staff_read_runtime'
       OR granted_role.rolname = 'grainline_staff_read_runtime'
     )
       AND NOT (
         granted_role.rolname = 'grainline_staff_read_runtime'
         AND member.rolname = 'neondb_owner'
         AND grantor.rolname = 'cloud_admin'
         AND membership.admin_option
         AND NOT membership.inherit_option
         AND NOT membership.set_option
       )
  ) OR EXISTS (
    WITH RECURSIVE restricted_members AS (
      SELECT child.oid, child.rolname
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS parent ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles AS child ON child.oid = membership.member
       WHERE parent.rolname = 'grainline_staff_read_runtime'
      UNION
      SELECT child.oid, child.rolname
        FROM restricted_members AS parent
        JOIN pg_catalog.pg_auth_members AS membership ON membership.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS child ON child.oid = membership.member
    )
    SELECT 1 FROM restricted_members WHERE rolname <> 'neondb_owner'
  ) THEN
    RAISE EXCEPTION 'OrderItem staff role retains unreviewed role membership';
  END IF;

  SELECT class.relowner INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderItem"'::pg_catalog.regclass
     AND class.relkind = 'r';
  SELECT
    role.oid, role.rolsuper, role.rolcanlogin, role.rolbypassrls
    INTO owner_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND
     OR NOT owner_role.rolcanlogin
     OR owner_role.oid IS DISTINCT FROM table_owner
     OR owner_role.oid IN (runtime_role_oid, staff_role_oid) THEN
    RAISE EXCEPTION 'OrderItem FORCE owner identity drifted';
  END IF;
  IF current_user = 'neondb_owner' THEN
    IF owner_role.rolsuper OR NOT owner_role.rolbypassrls
       OR pg_catalog.current_database() <> 'neondb' THEN
      RAISE EXCEPTION 'neondb_owner role posture is not OrderItem FORCE-safe';
    END IF;
  ELSIF current_user = 'ci'
        AND pg_catalog.current_database() = 'grainline_ci' THEN
    IF NOT owner_role.rolsuper THEN
      RAISE EXCEPTION 'disposable CI migration owner posture drifted';
    END IF;
  ELSE
    RAISE EXCEPTION 'OrderItem FORCE requires a reviewed migration owner';
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
      'OrderItem owner-session drain is incomplete: % other owner sessions remain',
      owner_session_count;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO accepted_tables
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Order', 'OrderItem', 'OrderShippingRateQuote')
     AND class.relkind = 'r'
     AND class.relowner = table_owner
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = class.oid
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
       ) AS acl
       WHERE acl.grantee <> class.relowner
         AND acl.privilege_type IN (
           'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
         )
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS attribute
       CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
       WHERE attribute.attrelid = class.oid
         AND attribute.attnum > 0 AND NOT attribute.attisdropped
         AND acl.grantee <> class.relowner
         AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','REFERENCES')
     )
     AND (
       (class.relname = 'Order' AND class.relrowsecurity AND class.relforcerowsecurity)
       OR
       (class.relname = 'OrderItem'
        AND class.relrowsecurity AND NOT class.relforcerowsecurity)
       OR
       (class.relname = 'OrderShippingRateQuote'
        AND NOT class.relrowsecurity AND NOT class.relforcerowsecurity)
     );
  IF accepted_tables <> 3 THEN
    RAISE EXCEPTION 'OrderItem FORCE predecessor table posture drifted';
  END IF;

  WITH expected(function_identity, source_md5, language_name, volatility, parallel_safety) AS (
    VALUES
      ('grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)', '57afbb69975aabeff64b8a069f9088cf', 'plpgsql', 'v', 'u'),
      ('grainline_case_open(text,text,text,text)', '741cef386e47a5047c059656f22f3812', 'plpgsql', 'v', 'u'),
      ('grainline_case_order_active_for_seller(text,text)', 'e1bd9e5ffec798a749f2305d88ba8d81', 'plpgsql', 'v', 'u'),
      ('grainline_case_relationship_valid()', '5c8cd6676aab7214cebf12c856be0735', 'plpgsql', 'v', 'u'),
      ('grainline_case_seller_refund_apply(text,text)', '7ea7a74ab55bc55e820e6b53f66c2bc6', 'plpgsql', 'v', 'u'),
      ('grainline_case_staff_resolution_finalize(text,text)', 'fb6fc41b09f72ff9829d86c60bf35018', 'plpgsql', 'v', 'u'),
      ('grainline_case_staff_resolution_prepare(text,text,"CaseResolution",integer,jsonb)', '8381d17e1e4ad3436f2656253e9739e3', 'plpgsql', 'v', 'u'),
      ('grainline_case_stripe_dispute_apply(text)', '80ffd7529e4c60abf58a74b8bd413641', 'plpgsql', 'v', 'u'),
      ('grainline_listing_order_archive_blocked(text,text,bigint)', 'ae0a686ef16514bb33ea841cfc712abd', 'plpgsql', 's', 's'),
      ('grainline_notification_create_core(text,text,"NotificationType",text,text,text)', '9b40f25710d5ee3cac009a0caa903a5a', 'plpgsql', 'v', 'u'),
      ('grainline_order_buyer_detail_v3(text,text)', '556b29d2864993ce6b2b2a57c76ed71a', 'sql', 's', 's'),
      ('grainline_order_buyer_detail(text,text)', '10a32366a0b5813358734682fea8275e', 'plpgsql', 's', 's'),
      ('grainline_order_buyer_export_page(text,integer,bigint,text)', '8eace73cd359c4f995f4d42857136d3e', 'plpgsql', 's', 's'),
      ('grainline_order_public_listing_counts(text[])', '82580230c9612ff046c0a62f9b999e47', 'plpgsql', 's', 's'),
      ('grainline_order_public_marketplace_listing_metrics()', '7f968c15969b4f935e286f5a900e062d', 'sql', 's', 's'),
      ('grainline_order_public_seller_stats(text,bigint)', '33503a4cbf24f53b129f333b439664f6', 'plpgsql', 's', 's'),
      ('grainline_order_review_eligibility_lock(text,text,bigint)', 'bfd9386e3bb872ba6cc78cc6d1e4acd2', 'plpgsql', 'v', 'u'),
      ('grainline_order_seller_analytics_buckets(text,bigint,bigint,boolean,text)', 'ccb51dc955603c009f64f4bd434240bd', 'plpgsql', 's', 's'),
      ('grainline_order_seller_analytics_summary(text,bigint,bigint,boolean)', '3996c8a65104b6fa30aeceb3e1294175', 'plpgsql', 's', 's'),
      ('grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)', '195c87faa7dab7e74006f768b0a2e488', 'plpgsql', 's', 's'),
      ('grainline_order_seller_detail_v3(text,text)', 'a14f6d9ac4cc9c45e553df1218678f77', 'sql', 's', 's'),
      ('grainline_order_seller_detail(text,text)', '241f803eec631729808de3fe80ced481', 'plpgsql', 's', 's'),
      ('grainline_order_seller_export_page(text,integer,bigint,text)', '3823a99388b6903dbf2618faf8485f78', 'plpgsql', 's', 's'),
      ('grainline_order_seller_key_assert(text)', '8e75629c22f5da0fcf4f776f13bce04f', 'plpgsql', 's', 's'),
      ('grainline_order_seller_label_preflight(text,text)', 'e6f2c0bcda6d4eb87760c371c10d3e4c', 'plpgsql', 's', 's'),
      ('grainline_order_seller_metrics_facts(text,bigint)', 'd5ec7383846a3d8d1f870c8f7405626c', 'plpgsql', 's', 's'),
      ('grainline_order_seller_recent_sales(text)', 'c4ea0bdb0b76c03ae3ce8629a857878b', 'plpgsql', 's', 's'),
      ('grainline_order_seller_verification_sales(text,text)', 'ea74eb7deb00c3ad71c8f16c7073587a', 'plpgsql', 's', 's'),
      ('grainline_order_staff_detail(text,text)', '62999162d995c7f3a462548472cfed5b', 'plpgsql', 's', 's'),
      ('grainline_order_staff_page(text,text,integer,integer)', '1080ddc6ad70f2af5cda7daa48228b1f', 'plpgsql', 's', 's'),
      ('grainline_order_summary_items(text)', '26a7d771f7421fdd54cbacb23985d3ae', 'sql', 's', 's'),
      ('grainline_seller_refund_record(text,text,bigint,text,text,text,integer)', '90696d8074ce8af6b683513b5af153c7', 'plpgsql', 'v', 'u'),
      ('grainline_stripe_checkout_order_create(text,bigint,text,text,timestamp without time zone,jsonb)', 'f3f6cee9d60e2688a4adf1e61aee58c8', 'plpgsql', 'v', 'u'),
      ('grainline_stripe_checkout_postpayment(text,bigint,text)', '29bf0946a48fe5b42f6ebe9e1a2cadd2', 'plpgsql', 'v', 'u')
  ), actual AS (
    SELECT procedure.oid,
           procedure.proname || '(' || pg_catalog.replace(
             pg_catalog.oidvectortypes(procedure.proargtypes), ', ', ','
           ) || ')' AS function_identity,
           pg_catalog.md5(procedure.prosrc) AS source_md5,
           procedure.proowner,
           language.lanname::text AS language_name,
           procedure.provolatile::text AS volatility,
           procedure.proparallel::text AS parallel_safety,
           procedure.prokind,
           procedure.prosecdef,
           procedure.proleakproof,
           procedure.proconfig,
           pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') > 0
             AS contains_dynamic_execute
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
     WHERE namespace.nspname = 'public'
       AND pg_catalog.strpos(procedure.prosrc, '"OrderItem"') > 0
  )
  SELECT
    (SELECT pg_catalog.count(*)::integer FROM expected),
    (SELECT pg_catalog.count(*)::integer FROM actual),
    (SELECT pg_catalog.count(*)::integer
       FROM expected
       JOIN actual USING (
         function_identity, source_md5, language_name, volatility, parallel_safety
       )
      WHERE actual.proowner = table_owner
        AND actual.prokind = 'f'
        AND actual.prosecdef AND NOT actual.proleakproof
        AND actual.proconfig = ARRAY['search_path=pg_catalog']::text[]
        AND NOT actual.contains_dynamic_execute
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(
            COALESCE((SELECT procedure.proacl FROM pg_catalog.pg_proc AS procedure
                       WHERE procedure.oid = actual.oid),
                     pg_catalog.acldefault('f', actual.proowner))
          ) AS acl
          WHERE acl.grantee <> actual.proowner
            AND (acl.privilege_type <> 'EXECUTE'
              OR acl.is_grantable
              OR acl.grantee = 0
              OR pg_catalog.pg_get_userbyid(acl.grantee) NOT IN (
                'grainline_app_runtime', 'grainline_staff_read_runtime'
              ))
        ))
    INTO expected_function_count, actual_function_count, accepted_functions;
  IF accepted_functions <> 34
     OR actual_function_count <> 34
     OR expected_function_count <> 34 THEN
    RAISE EXCEPTION 'OrderItem FORCE exact function catalog drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO accepted_triggers
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger_row.tgfoid
    JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
   WHERE trigger_row.tgrelid = 'public."OrderItem"'::pg_catalog.regclass
     AND NOT trigger_row.tgisinternal
     AND trigger_row.tgenabled = 'O'
     AND procedure.proowner = table_owner
     AND language.lanname = 'plpgsql'
     AND procedure.prokind = 'f'
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') = 0
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(procedure.proacl,
                  pg_catalog.acldefault('f', procedure.proowner))
       ) AS acl
       WHERE acl.grantee <> procedure.proowner
     )
     AND (
       (trigger_row.tgname = 'grainline_order_item_seller_key_bind'
        AND procedure.proname = 'grainline_order_item_seller_key_bind'
        AND pg_catalog.md5(procedure.prosrc) = '34c8dab8a6d39ca9951ee049f9f2a7ea'
        AND NOT trigger_row.tgdeferrable AND NOT trigger_row.tginitdeferred)
       OR
       (trigger_row.tgname = 'grainline_order_item_seller_key_complete'
        AND procedure.proname = 'grainline_order_item_seller_key_complete'
        AND pg_catalog.md5(procedure.prosrc) = '878a575c4b0a823fa9acf6c379f5199b'
        AND trigger_row.tgdeferrable AND trigger_row.tginitdeferred)
     );
  IF accepted_triggers <> 2 OR (
    SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public."OrderItem"'::pg_catalog.regclass
       AND NOT trigger_row.tgisinternal
  ) <> 2 THEN
    RAISE EXCEPTION 'OrderItem FORCE trigger catalog drifted';
  END IF;
END
$grainline_order_item_force_preflight$;

ALTER TABLE public."OrderItem" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."OrderItem"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_order_item_force_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderItem"'::pg_catalog.regclass
     AND class.relrowsecurity AND class.relforcerowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = class.oid
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.aclexplode(
         COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
       ) AS acl
       WHERE acl.grantee <> class.relowner
         AND acl.privilege_type IN (
           'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
         )
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_staff_read_runtime', class.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'OrderItem FORCE posture did not converge';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."OrderShippingRateQuote"'::pg_catalog.regclass
       AND NOT class.relrowsecurity AND NOT class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = class.oid
       )
  ) THEN
    RAISE EXCEPTION 'OrderItem FORCE crossed the quote-table boundary';
  END IF;
END
$grainline_order_item_force_postflight$;

COMMIT;
