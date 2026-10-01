-- Reviewed policyless OrderItem ENABLE and zero-direct authority retention.
-- Apply only through the guarded main-only production migration workflow.
-- Policyless OrderItem ENABLE follows the accepted zero-direct runtime lock and
-- exact read-only Production authority inspection. OrderShippingRateQuote stays
-- RLS-off as a separate successor release.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order-item.rls.activation', 0)
);
LOCK TABLE public."OrderItem" IN ACCESS EXCLUSIVE MODE;

DO $grainline_order_item_activation_preflight$
DECLARE
  table_owner oid;
  accepted_tables integer;
  accepted_functions integer;
  actual_function_count integer;
  expected_function_count integer;
  accepted_triggers integer;
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'OrderItem ENABLE requires a direct owner session';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = 'grainline_app_runtime'
       AND role.rolcanlogin AND NOT role.rolsuper
       AND NOT role.rolinherit AND NOT role.rolbypassrls
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = 'grainline_staff_read_runtime'
       AND role.rolcanlogin AND NOT role.rolsuper
       AND NOT role.rolinherit AND NOT role.rolbypassrls
  ) THEN
    RAISE EXCEPTION 'OrderItem ENABLE restricted role posture drifted';
  END IF;

  SELECT class.relowner INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderItem"'::pg_catalog.regclass
     AND class.relkind = 'r';
  IF table_owner <> (
    SELECT role.oid FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) THEN
    RAISE EXCEPTION 'OrderItem ENABLE table owner drifted';
  END IF;
  IF NOT (
    (current_user = 'neondb_owner' AND pg_catalog.current_database() = 'neondb'
      AND NOT (SELECT role.rolsuper FROM pg_catalog.pg_roles AS role WHERE role.oid = table_owner)
      AND (SELECT role.rolbypassrls FROM pg_catalog.pg_roles AS role WHERE role.oid = table_owner))
    OR
    (current_user = 'ci' AND pg_catalog.current_database() = 'grainline_ci'
      AND (SELECT role.rolsuper FROM pg_catalog.pg_roles AS role WHERE role.oid = table_owner))
  ) THEN
    RAISE EXCEPTION 'OrderItem ENABLE owner boundary is unreviewed';
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
       (class.relname IN ('OrderItem', 'OrderShippingRateQuote')
        AND NOT class.relrowsecurity AND NOT class.relforcerowsecurity)
     );
  IF accepted_tables <> 3 THEN
    RAISE EXCEPTION 'OrderItem ENABLE predecessor table posture drifted';
  END IF;

  WITH expected(function_identity, source_md5) AS (
    VALUES
      ('grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)', '57afbb69975aabeff64b8a069f9088cf'),
      ('grainline_case_open(text,text,text,text)', '741cef386e47a5047c059656f22f3812'),
      ('grainline_case_order_active_for_seller(text,text)', 'e1bd9e5ffec798a749f2305d88ba8d81'),
      ('grainline_case_relationship_valid()', '5c8cd6676aab7214cebf12c856be0735'),
      ('grainline_case_seller_refund_apply(text,text)', '7ea7a74ab55bc55e820e6b53f66c2bc6'),
      ('grainline_case_staff_resolution_finalize(text,text)', 'fb6fc41b09f72ff9829d86c60bf35018'),
      ('grainline_case_staff_resolution_prepare(text,text,"CaseResolution",integer,jsonb)', '8381d17e1e4ad3436f2656253e9739e3'),
      ('grainline_case_stripe_dispute_apply(text)', '80ffd7529e4c60abf58a74b8bd413641'),
      ('grainline_listing_order_archive_blocked(text,text,bigint)', 'ae0a686ef16514bb33ea841cfc712abd'),
      ('grainline_notification_create_core(text,text,"NotificationType",text,text,text)', '9b40f25710d5ee3cac009a0caa903a5a'),
      ('grainline_order_buyer_detail_v3(text,text)', '556b29d2864993ce6b2b2a57c76ed71a'),
      ('grainline_order_buyer_detail(text,text)', '10a32366a0b5813358734682fea8275e'),
      ('grainline_order_buyer_export_page(text,integer,bigint,text)', '8eace73cd359c4f995f4d42857136d3e'),
      ('grainline_order_public_listing_counts(text[])', '82580230c9612ff046c0a62f9b999e47'),
      ('grainline_order_public_marketplace_listing_metrics()', '7f968c15969b4f935e286f5a900e062d'),
      ('grainline_order_public_seller_stats(text,bigint)', '33503a4cbf24f53b129f333b439664f6'),
      ('grainline_order_review_eligibility_lock(text,text,bigint)', 'bfd9386e3bb872ba6cc78cc6d1e4acd2'),
      ('grainline_order_seller_analytics_buckets(text,bigint,bigint,boolean,text)', 'ccb51dc955603c009f64f4bd434240bd'),
      ('grainline_order_seller_analytics_summary(text,bigint,bigint,boolean)', '3996c8a65104b6fa30aeceb3e1294175'),
      ('grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)', '195c87faa7dab7e74006f768b0a2e488'),
      ('grainline_order_seller_detail_v3(text,text)', 'a14f6d9ac4cc9c45e553df1218678f77'),
      ('grainline_order_seller_detail(text,text)', '241f803eec631729808de3fe80ced481'),
      ('grainline_order_seller_export_page(text,integer,bigint,text)', '3823a99388b6903dbf2618faf8485f78'),
      ('grainline_order_seller_key_assert(text)', '8e75629c22f5da0fcf4f776f13bce04f'),
      ('grainline_order_seller_label_preflight(text,text)', 'e6f2c0bcda6d4eb87760c371c10d3e4c'),
      ('grainline_order_seller_metrics_facts(text,bigint)', 'd5ec7383846a3d8d1f870c8f7405626c'),
      ('grainline_order_seller_recent_sales(text)', 'c4ea0bdb0b76c03ae3ce8629a857878b'),
      ('grainline_order_seller_verification_sales(text,text)', 'ea74eb7deb00c3ad71c8f16c7073587a'),
      ('grainline_order_staff_detail(text,text)', '62999162d995c7f3a462548472cfed5b'),
      ('grainline_order_staff_page(text,text,integer,integer)', '1080ddc6ad70f2af5cda7daa48228b1f'),
      ('grainline_order_summary_items(text)', '26a7d771f7421fdd54cbacb23985d3ae'),
      ('grainline_seller_refund_record(text,text,bigint,text,text,text,integer)', '90696d8074ce8af6b683513b5af153c7'),
      ('grainline_stripe_checkout_order_create(text,bigint,text,text,timestamp without time zone,jsonb)', 'f3f6cee9d60e2688a4adf1e61aee58c8'),
      ('grainline_stripe_checkout_postpayment(text,bigint,text)', '29bf0946a48fe5b42f6ebe9e1a2cadd2')
  ), actual AS (
    SELECT procedure.oid,
           procedure.proname || '(' || pg_catalog.replace(
             pg_catalog.oidvectortypes(procedure.proargtypes), ', ', ','
           ) || ')' AS function_identity,
           pg_catalog.md5(procedure.prosrc) AS source_md5,
           procedure.proowner,
           language.lanname,
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
       JOIN actual USING (function_identity, source_md5)
      WHERE actual.proowner = table_owner
        AND actual.lanname = 'plpgsql'
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
    RAISE EXCEPTION 'OrderItem ENABLE exact function catalog drifted';
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
    RAISE EXCEPTION 'OrderItem ENABLE trigger catalog drifted';
  END IF;
END
$grainline_order_item_activation_preflight$;

ALTER TABLE public."OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderItem" NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."OrderItem"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_order_item_activation_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderItem"'::pg_catalog.regclass
     AND class.relrowsecurity AND NOT class.relforcerowsecurity
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
    RAISE EXCEPTION 'OrderItem ENABLE posture did not converge';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."OrderShippingRateQuote"'::pg_catalog.regclass
       AND NOT class.relrowsecurity AND NOT class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = class.oid
       )
  ) THEN
    RAISE EXCEPTION 'OrderItem ENABLE crossed the quote-table boundary';
  END IF;
END
$grainline_order_item_activation_postflight$;

COMMIT;
