-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Policyless service-ledger activation. All application reads and writes were
-- converted to the exact fixed operations verified below before table access
-- is revoked. No policy is installed and no row data is changed.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order-payment-event.rls.activation',
    0
  )
);

-- Every fixed writer locks the parent Order before appending evidence. Keep
-- the same parent-first relation order so activation cannot deadlock a writer.
LOCK TABLE public."Order" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public."OrderPaymentEvent" IN ACCESS EXCLUSIVE MODE;

DO $grainline_order_payment_event_activation_preflight$
DECLARE
  table_owner oid;
  accepted_table_count integer;
  invalid_table_acl_count integer;
  direct_column_acl_count integer;
  validated_constraint_count integer;
  required_index_count integer;
  required_trigger_count integer;
  order_trigger_count integer;
  invalid_row_count bigint;
  function_count integer;
  named_function_count integer;
  unexpected_direct_function_count integer;
BEGIN
  SELECT class.relowner
    INTO table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'OrderPaymentEvent'
     AND class.relkind = 'r';
  IF table_owner IS NULL
     OR table_owner <> (
       SELECT role.oid
         FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = CURRENT_USER
     )
     OR NOT (
       CURRENT_USER = 'neondb_owner'
       OR (
         CURRENT_USER = 'ci'
         AND CURRENT_DATABASE() = 'grainline_ci'
       )
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = 'grainline_app_runtime'
          AND NOT role.rolsuper
          AND NOT role.rolbypassrls
     ) THEN
    RAISE EXCEPTION 'OrderPaymentEvent activation role boundary drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'OrderPaymentEvent'
     AND class.relkind = 'r'
     AND class.relowner = table_owner
     AND NOT class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'SELECT'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'INSERT'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'UPDATE'
     )
     AND pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid, 'DELETE'
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'TRUNCATE,REFERENCES,TRIGGER'
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'OrderPaymentEvent activation predecessor posture drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invalid_table_acl_count
    FROM pg_catalog.pg_class AS class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) AS acl
   WHERE class.oid = 'public."OrderPaymentEvent"'::pg_catalog.regclass
     AND (
       acl.grantee NOT IN (
         class.relowner,
         (SELECT role.oid FROM pg_catalog.pg_roles AS role
           WHERE role.rolname = 'grainline_app_runtime')
       )
       OR (
         acl.grantee = (
           SELECT role.oid FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = 'grainline_app_runtime'
         )
         AND (
           acl.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE')
           OR acl.grantor <> class.relowner
           OR acl.is_grantable
         )
       )
     );
  IF invalid_table_acl_count <> 0 THEN
    RAISE EXCEPTION 'OrderPaymentEvent predecessor table ACLs drifted: %',
      invalid_table_acl_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO direct_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid =
         'public."OrderPaymentEvent"'::pg_catalog.regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','REFERENCES');
  IF direct_column_acl_count <> 0 THEN
    RAISE EXCEPTION 'OrderPaymentEvent predecessor column ACLs drifted: %',
      direct_column_acl_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO validated_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public."OrderPaymentEvent"'::pg_catalog.regclass
     AND constraint_row.conname IN (
       'OrderPaymentEvent_amountCents_check',
       'OrderPaymentEvent_currency_check',
       'OrderPaymentEvent_eventType_check',
       'OrderPaymentEvent_source_shape_check',
       'OrderPaymentEvent_text_shape_check',
       'OrderPaymentEvent_timestamp_immutable_shape_check'
     )
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;
  IF validated_constraint_count <> 6 THEN
    RAISE EXCEPTION 'OrderPaymentEvent validated constraints drifted: %',
      validated_constraint_count;
  END IF;

  WITH expected(index_name, is_unique, is_primary, key_columns, descending) AS (
    VALUES
      ('OrderPaymentEvent_pkey', true, true,
       ARRAY['id']::text[], ARRAY[false]::boolean[]),
      ('OrderPaymentEvent_stripeEventId_key', true, false,
       ARRAY['stripeEventId']::text[], ARRAY[false]::boolean[]),
      ('OrderPaymentEvent_id_orderId_key', true, false,
       ARRAY['id','orderId']::text[], ARRAY[false,false]::boolean[]),
      ('OrderPaymentEvent_orderId_createdAt_idx', false, false,
       ARRAY['orderId','createdAt']::text[], ARRAY[false,false]::boolean[]),
      ('OrderPaymentEvent_eventType_createdAt_idx', false, false,
       ARRAY['eventType','createdAt']::text[], ARRAY[false,false]::boolean[]),
      ('OrderPaymentEvent_stripeObjectId_idx', false, false,
       ARRAY['stripeObjectId']::text[], ARRAY[false]::boolean[]),
      ('OrderPaymentEvent_order_dispute_event_time_idx', false, false,
       ARRAY['orderId','eventType','stripeObjectId','stripeEventCreatedSeconds','id']::text[],
       ARRAY[false,false,false,true,true]::boolean[])
  ), actual AS (
    SELECT index_class.relname AS index_name,
           index_row.indisunique AS is_unique,
           index_row.indisprimary AS is_primary,
           index_row.indisvalid AS is_valid,
           index_row.indisready AS is_ready,
           index_row.indislive AS is_live,
           index_row.indpred IS NULL AS is_unconditional,
           index_row.indexprs IS NULL AS has_plain_columns,
           ARRAY(
             SELECT attribute.attname::text
               FROM pg_catalog.generate_series(
                 0, index_row.indnkeyatts - 1
               ) AS ordinal(position)
               JOIN pg_catalog.pg_attribute AS attribute
                 ON attribute.attrelid = index_row.indrelid
                AND attribute.attnum = index_row.indkey[ordinal.position]
              ORDER BY ordinal.position
           ) AS key_columns,
           ARRAY(
             SELECT (index_row.indoption[ordinal.position] & 1) = 1
               FROM pg_catalog.generate_series(
                 0, index_row.indnkeyatts - 1
               ) AS ordinal(position)
              ORDER BY ordinal.position
           ) AS descending
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_class AS index_class
        ON index_class.oid = index_row.indexrelid
     WHERE index_row.indrelid =
           'public."OrderPaymentEvent"'::pg_catalog.regclass
  )
  SELECT pg_catalog.count(*)::integer
    INTO required_index_count
    FROM expected
    JOIN actual USING (index_name, is_unique, is_primary, key_columns, descending)
   WHERE actual.is_valid AND actual.is_ready AND actual.is_live
     AND actual.is_unconditional AND actual.has_plain_columns;
  IF required_index_count <> 7 THEN
    RAISE EXCEPTION 'OrderPaymentEvent required indexes drifted: %',
      required_index_count;
  END IF;

  WITH expected(relation_name, trigger_name, function_name, trigger_type) AS (
    VALUES
      ('OrderPaymentEvent','grainline_order_payment_event_validate_insert',
       'grainline_order_payment_event_validate_insert',7),
      ('OrderPaymentEvent','grainline_order_payment_event_immutable',
       'grainline_order_payment_event_immutable',27),
      ('OrderPaymentEvent','grainline_order_payment_projection_refresh',
       'grainline_order_payment_projection_refresh',5),
      ('OrderPaymentEvent','grainline_order_payment_open_dispute_refresh',
       'grainline_order_payment_open_dispute_refresh',5),
      ('Order','grainline_order_currency_payment_immutable',
       'grainline_order_currency_payment_immutable',19),
      ('Order','grainline_order_payment_projection_guard',
       'grainline_order_payment_projection_guard',23),
      ('Order','grainline_order_payment_open_dispute_guard',
       'grainline_order_payment_open_dispute_guard',23)
  )
  SELECT pg_catalog.count(*)::integer
    INTO required_trigger_count
    FROM expected
    JOIN pg_catalog.pg_class AS class
      ON class.relname = expected.relation_name
     AND class.relnamespace = 'public'::pg_catalog.regnamespace
    JOIN pg_catalog.pg_trigger AS trigger_row
      ON trigger_row.tgrelid = class.oid
     AND trigger_row.tgname = expected.trigger_name
     AND trigger_row.tgtype = expected.trigger_type
     AND trigger_row.tgenabled = 'O'
     AND NOT trigger_row.tgisinternal
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger_row.tgfoid
     AND procedure.proname = expected.function_name
     AND procedure.pronamespace = 'public'::pg_catalog.regnamespace;
  IF required_trigger_count <> 7 THEN
    RAISE EXCEPTION 'OrderPaymentEvent required triggers drifted: %',
      required_trigger_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO order_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_row
   WHERE trigger_row.tgrelid =
         'public."OrderPaymentEvent"'::pg_catalog.regclass
     AND NOT trigger_row.tgisinternal;
  IF order_trigger_count <> 4 THEN
    RAISE EXCEPTION 'OrderPaymentEvent trigger surface drifted: %',
      order_trigger_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO invalid_row_count
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."eventType" NOT IN ('REFUND','DISPUTE')
      OR payment."amountCents" < 0
      OR payment.currency !~ '^[a-z]{3}$'
      OR payment."stripeObjectId" IS NULL
      OR payment."stripeObjectType" IS NULL
      OR payment.metadata IS NULL
      OR pg_catalog.jsonb_typeof(payment.metadata) <> 'object'
      OR payment."updatedAt" IS DISTINCT FROM payment."createdAt";
  IF invalid_row_count <> 0 THEN
    RAISE EXCEPTION 'OrderPaymentEvent activation found invalid rows: %',
      invalid_row_count;
  END IF;

  WITH expected(
    function_name,
    identity_arguments,
    language_name,
    volatility,
    parallel_safety,
    security_definer,
    runtime_execute,
    source_md5
  ) AS (
    VALUES
      ('grainline_blocked_checkout_refund_claim', 'text, bigint, text, text, integer', 'plpgsql', 'v', 'u', true, true, 'e0c4cb6d34fd59ce2c0b3043c3f5fa63'),
      ('grainline_blocked_checkout_refund_claim_resume', 'text, bigint, text, text, integer', 'plpgsql', 'v', 'u', true, true, '63e3a6533f3e9557033ededa15967f44'),
      ('grainline_blocked_checkout_refund_reconciliation_record', 'text, text, bigint, text, text, text, integer', 'plpgsql', 'v', 'u', true, true, 'fb4e95894e189462ff2a1d8f953c248d'),
      ('grainline_blocked_checkout_refund_record', 'text, bigint, text, bigint, text, text, text, integer', 'plpgsql', 'v', 'u', true, true, 'a83f7efd6fa31df4c60eb98f9c46f569'),
      ('grainline_blocked_checkout_refund_record_core', 'text, bigint, text, bigint, text, text, text, integer', 'plpgsql', 'v', 'u', true, false, '687ec7b3100828bb21748adda74a8848'),
      ('grainline_blocked_checkout_transfer_bind', 'text, bigint, text, text, text, text, text', 'plpgsql', 'v', 'u', true, true, '8ddd88e3aca67753216cdda94eecc9fd'),
      ('grainline_case_seller_refund_apply', 'text, text', 'plpgsql', 'v', 'u', true, true, '4de7d8fb0486f34922b70b9ea6678a23'),
      ('grainline_order_currency_payment_immutable', '', 'plpgsql', 'v', 'u', true, false, 'bf6dcd2db1e9da969e33fd4feeb0daca'),
      ('grainline_order_payment_buyer_export_page', 'text, integer, bigint, text', 'plpgsql', 's', 's', true, true, '48cc262301e4e88007e9d70563a285b5'),
      ('grainline_order_payment_buyer_refund_outcomes', 'text, text[]', 'plpgsql', 's', 's', true, true, 'd27a83508c75e1d7dc85809b256483f3'),
      ('grainline_order_payment_event_immutable', '', 'plpgsql', 'v', 'u', false, false, '631508bb9f5e20b7f92eb0b4bf27778e'),
      ('grainline_order_payment_event_validate_insert', '', 'plpgsql', 'v', 'u', true, false, '9cbc558836ee47be19ffc62681b3cfe3'),
      ('grainline_order_payment_open_dispute_guard', '', 'plpgsql', 'v', 'u', true, false, 'e8cf3cb5071d23b2c960653f06005911'),
      ('grainline_order_payment_open_dispute_refresh', '', 'plpgsql', 'v', 'u', true, false, '61cce30f4c318ad53d768e1ebc35a413'),
      ('grainline_order_payment_open_dispute_state', 'text', 'sql', 'v', 'u', true, false, '4407a1eb7797c25e10f0cf250839305d'),
      ('grainline_order_payment_projection_guard', '', 'plpgsql', 'v', 'u', true, false, '39827a8b89f04501536f1497250d9936'),
      ('grainline_order_payment_projection_refresh', '', 'plpgsql', 'v', 'u', true, false, 'd677bb8fecdff843aacc11ffe7927073'),
      ('grainline_order_payment_projection_state', 'text', 'sql', 'v', 'u', true, false, '3a895f4e0db8a5f407949efddbd09095'),
      ('grainline_order_payment_seller_export_page', 'text, integer, bigint, text', 'plpgsql', 's', 's', true, true, 'fa91e4788267e64be3b30f78e37d29ad'),
      ('grainline_order_payment_seller_refund_outcomes', 'text, text[]', 'plpgsql', 's', 's', true, true, '6029a5c21d72e6b258b9d2d494303995'),
      ('grainline_order_payment_signed_dispute_apply', 'text, bigint, text, text, bigint, integer, text, text, text', 'plpgsql', 'v', 'u', true, true, '09606f3aaae63e1b935365d0e4afe4ff'),
      ('grainline_order_payment_signed_refund_apply', 'text, bigint, text, bigint, integer, text, text, integer, text, bigint, text', 'plpgsql', 'v', 'u', true, true, 'dae53f93b7411a83b1f55bca3e3a5681'),
      ('grainline_order_payment_staff_timeline', 'text, text, integer', 'plpgsql', 's', 's', true, true, '60841899dccd96b103526744f26f3fae'),
      ('grainline_order_refund_claim_mark_ambiguous', 'text, bigint, text', 'plpgsql', 'v', 'u', true, true, '0378491226cccdaa0edb0ccd8d573093'),
      ('grainline_order_refund_reconcile', 'text, text, bigint, text, text, bigint, text, text', 'plpgsql', 'v', 'u', true, true, '8f71265e548591a89822e303f3e38edc'),
      ('grainline_order_refund_reconciliation_immutable', '', 'plpgsql', 'v', 'u', false, false, '38c5f5e128c4068b70f9cf394890618c'),
      ('grainline_order_refund_reconciliation_prepare', 'text, text', 'plpgsql', 's', 'u', true, true, '67a7ae66d14b3034247eb20c7bb54a5d'),
      ('grainline_seller_refund_claim', 'text, text', 'plpgsql', 'v', 'u', true, true, '52201c09cafd79eee28d7c3bb5f3ee38'),
      ('grainline_seller_refund_record', 'text, text, bigint, text, text, text, integer', 'plpgsql', 'v', 'u', true, true, '90696d8074ce8af6b683513b5af153c7')
  ), actual AS (
    SELECT
      expected.*,
      procedure.oid,
      procedure.proowner,
      procedure.prokind,
      procedure.proleakproof,
      procedure.proconfig,
      procedure.proacl,
      procedure.prosrc,
      procedure.prosecdef,
      procedure.provolatile,
      procedure.proparallel,
      language.lanname,
      pg_catalog.has_function_privilege(
        'grainline_app_runtime', procedure.oid, 'EXECUTE'
      ) AS runtime_can_execute
    FROM expected
    LEFT JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.function_name
     AND pg_catalog.oidvectortypes(procedure.proargtypes) =
         expected.identity_arguments
     AND procedure.pronamespace = 'public'::pg_catalog.regnamespace
    LEFT JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
  )
  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM actual
   WHERE oid IS NOT NULL
     AND proowner = table_owner
     AND prokind = 'f'
     AND NOT proleakproof
     AND prosecdef = security_definer
     AND provolatile = volatility
     AND proparallel = parallel_safety
     AND lanname = language_name
     AND proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(prosrc) = source_md5
     AND runtime_can_execute = runtime_execute
     AND pg_catalog.strpos(pg_catalog.upper(prosrc), 'EXECUTE') = 0
     AND pg_catalog.strpos(pg_catalog.upper(prosrc), 'FORMAT(') = 0
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(proacl, pg_catalog.acldefault('f', proowner))
         ) AS acl
        WHERE acl.privilege_type <> 'EXECUTE'
           OR acl.grantee = 0
           OR acl.grantee NOT IN (
             proowner,
             (SELECT role.oid FROM pg_catalog.pg_roles AS role
               WHERE role.rolname = 'grainline_app_runtime')
           )
           OR (
             acl.grantee = (
               SELECT role.oid FROM pg_catalog.pg_roles AS role
                WHERE role.rolname = 'grainline_app_runtime'
             )
             AND (
               NOT runtime_execute
               OR acl.grantor <> proowner
               OR acl.is_grantable
             )
           )
     );
  IF function_count <> 29 THEN
    RAISE EXCEPTION
      'OrderPaymentEvent predecessor function catalog drifted: %',
      function_count;
  END IF;

  WITH expected(function_name) AS (
    VALUES
      ('grainline_blocked_checkout_refund_claim'),
      ('grainline_blocked_checkout_refund_claim_resume'),
      ('grainline_blocked_checkout_refund_reconciliation_record'),
      ('grainline_blocked_checkout_refund_record'),
      ('grainline_blocked_checkout_refund_record_core'),
      ('grainline_blocked_checkout_transfer_bind'),
      ('grainline_case_seller_refund_apply'),
      ('grainline_order_currency_payment_immutable'),
      ('grainline_order_payment_buyer_export_page'),
      ('grainline_order_payment_buyer_refund_outcomes'),
      ('grainline_order_payment_event_immutable'),
      ('grainline_order_payment_event_validate_insert'),
      ('grainline_order_payment_open_dispute_guard'),
      ('grainline_order_payment_open_dispute_refresh'),
      ('grainline_order_payment_open_dispute_state'),
      ('grainline_order_payment_projection_guard'),
      ('grainline_order_payment_projection_refresh'),
      ('grainline_order_payment_projection_state'),
      ('grainline_order_payment_seller_export_page'),
      ('grainline_order_payment_seller_refund_outcomes'),
      ('grainline_order_payment_signed_dispute_apply'),
      ('grainline_order_payment_signed_refund_apply'),
      ('grainline_order_payment_staff_timeline'),
      ('grainline_order_refund_claim_mark_ambiguous'),
      ('grainline_order_refund_reconcile'),
      ('grainline_order_refund_reconciliation_immutable'),
      ('grainline_order_refund_reconciliation_prepare'),
      ('grainline_seller_refund_claim'),
      ('grainline_seller_refund_record')
  )
  SELECT pg_catalog.count(*)::integer
    INTO named_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN expected ON expected.function_name = procedure.proname
   WHERE namespace.nspname = 'public';
  IF named_function_count <> 29 THEN
    RAISE EXCEPTION
      'OrderPaymentEvent predecessor trusted-name overload surface drifted: %',
      named_function_count;
  END IF;

  WITH expected(function_name) AS (
    VALUES
      ('grainline_blocked_checkout_refund_claim'),
      ('grainline_blocked_checkout_refund_claim_resume'),
      ('grainline_blocked_checkout_refund_reconciliation_record'),
      ('grainline_blocked_checkout_refund_record'),
      ('grainline_blocked_checkout_refund_record_core'),
      ('grainline_blocked_checkout_transfer_bind'),
      ('grainline_case_seller_refund_apply'),
      ('grainline_order_currency_payment_immutable'),
      ('grainline_order_payment_buyer_export_page'),
      ('grainline_order_payment_buyer_refund_outcomes'),
      ('grainline_order_payment_event_immutable'),
      ('grainline_order_payment_event_validate_insert'),
      ('grainline_order_payment_open_dispute_guard'),
      ('grainline_order_payment_open_dispute_refresh'),
      ('grainline_order_payment_open_dispute_state'),
      ('grainline_order_payment_projection_guard'),
      ('grainline_order_payment_projection_refresh'),
      ('grainline_order_payment_projection_state'),
      ('grainline_order_payment_seller_export_page'),
      ('grainline_order_payment_seller_refund_outcomes'),
      ('grainline_order_payment_signed_dispute_apply'),
      ('grainline_order_payment_signed_refund_apply'),
      ('grainline_order_payment_staff_timeline'),
      ('grainline_order_refund_claim_mark_ambiguous'),
      ('grainline_order_refund_reconcile'),
      ('grainline_order_refund_reconciliation_immutable'),
      ('grainline_order_refund_reconciliation_prepare'),
      ('grainline_seller_refund_claim'),
      ('grainline_seller_refund_record')
  )
  SELECT pg_catalog.count(*)::integer
    INTO unexpected_direct_function_count
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.pronamespace = 'public'::pg_catalog.regnamespace
     AND pg_catalog.strpos(procedure.prosrc, '"OrderPaymentEvent"') > 0
     AND NOT EXISTS (
       SELECT 1 FROM expected
        WHERE expected.function_name = procedure.proname
     );
  IF unexpected_direct_function_count <> 0 THEN
    RAISE EXCEPTION 'OrderPaymentEvent unknown direct function surface: %',
      unexpected_direct_function_count;
  END IF;
END
$grainline_order_payment_event_activation_preflight$;

REVOKE ALL ON FUNCTION public.grainline_blocked_checkout_refund_claim(text, bigint, text, text, integer) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_case_seller_refund_apply(text, text) FROM PUBLIC, grainline_app_runtime;

ALTER TABLE public."OrderPaymentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderPaymentEvent" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."OrderPaymentEvent"
  FROM PUBLIC, grainline_app_runtime;

DO $grainline_order_payment_event_activation_postflight$
DECLARE
  table_owner oid;
  accepted_table_count integer;
  function_count integer;
  named_function_count integer;
BEGIN
  SELECT class.relowner
    INTO table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderPaymentEvent"'::pg_catalog.regclass;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderPaymentEvent"'::pg_catalog.regclass
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee <> class.relowner
          AND acl.privilege_type IN (
            'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
          )
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION 'OrderPaymentEvent activation posture did not converge';
  END IF;

  WITH expected(
    function_name,
    identity_arguments,
    language_name,
    volatility,
    parallel_safety,
    security_definer,
    runtime_execute,
    source_md5
  ) AS (
    VALUES
      ('grainline_blocked_checkout_refund_claim', 'text, bigint, text, text, integer', 'plpgsql', 'v', 'u', true, false, 'e0c4cb6d34fd59ce2c0b3043c3f5fa63'),
      ('grainline_blocked_checkout_refund_claim_resume', 'text, bigint, text, text, integer', 'plpgsql', 'v', 'u', true, true, '63e3a6533f3e9557033ededa15967f44'),
      ('grainline_blocked_checkout_refund_reconciliation_record', 'text, text, bigint, text, text, text, integer', 'plpgsql', 'v', 'u', true, true, 'fb4e95894e189462ff2a1d8f953c248d'),
      ('grainline_blocked_checkout_refund_record', 'text, bigint, text, bigint, text, text, text, integer', 'plpgsql', 'v', 'u', true, true, 'a83f7efd6fa31df4c60eb98f9c46f569'),
      ('grainline_blocked_checkout_refund_record_core', 'text, bigint, text, bigint, text, text, text, integer', 'plpgsql', 'v', 'u', true, false, '687ec7b3100828bb21748adda74a8848'),
      ('grainline_blocked_checkout_transfer_bind', 'text, bigint, text, text, text, text, text', 'plpgsql', 'v', 'u', true, true, '8ddd88e3aca67753216cdda94eecc9fd'),
      ('grainline_case_seller_refund_apply', 'text, text', 'plpgsql', 'v', 'u', true, false, '4de7d8fb0486f34922b70b9ea6678a23'),
      ('grainline_order_currency_payment_immutable', '', 'plpgsql', 'v', 'u', true, false, 'bf6dcd2db1e9da969e33fd4feeb0daca'),
      ('grainline_order_payment_buyer_export_page', 'text, integer, bigint, text', 'plpgsql', 's', 's', true, true, '48cc262301e4e88007e9d70563a285b5'),
      ('grainline_order_payment_buyer_refund_outcomes', 'text, text[]', 'plpgsql', 's', 's', true, true, 'd27a83508c75e1d7dc85809b256483f3'),
      ('grainline_order_payment_event_immutable', '', 'plpgsql', 'v', 'u', false, false, '631508bb9f5e20b7f92eb0b4bf27778e'),
      ('grainline_order_payment_event_validate_insert', '', 'plpgsql', 'v', 'u', true, false, '9cbc558836ee47be19ffc62681b3cfe3'),
      ('grainline_order_payment_open_dispute_guard', '', 'plpgsql', 'v', 'u', true, false, 'e8cf3cb5071d23b2c960653f06005911'),
      ('grainline_order_payment_open_dispute_refresh', '', 'plpgsql', 'v', 'u', true, false, '61cce30f4c318ad53d768e1ebc35a413'),
      ('grainline_order_payment_open_dispute_state', 'text', 'sql', 'v', 'u', true, false, '4407a1eb7797c25e10f0cf250839305d'),
      ('grainline_order_payment_projection_guard', '', 'plpgsql', 'v', 'u', true, false, '39827a8b89f04501536f1497250d9936'),
      ('grainline_order_payment_projection_refresh', '', 'plpgsql', 'v', 'u', true, false, 'd677bb8fecdff843aacc11ffe7927073'),
      ('grainline_order_payment_projection_state', 'text', 'sql', 'v', 'u', true, false, '3a895f4e0db8a5f407949efddbd09095'),
      ('grainline_order_payment_seller_export_page', 'text, integer, bigint, text', 'plpgsql', 's', 's', true, true, 'fa91e4788267e64be3b30f78e37d29ad'),
      ('grainline_order_payment_seller_refund_outcomes', 'text, text[]', 'plpgsql', 's', 's', true, true, '6029a5c21d72e6b258b9d2d494303995'),
      ('grainline_order_payment_signed_dispute_apply', 'text, bigint, text, text, bigint, integer, text, text, text', 'plpgsql', 'v', 'u', true, true, '09606f3aaae63e1b935365d0e4afe4ff'),
      ('grainline_order_payment_signed_refund_apply', 'text, bigint, text, bigint, integer, text, text, integer, text, bigint, text', 'plpgsql', 'v', 'u', true, true, 'dae53f93b7411a83b1f55bca3e3a5681'),
      ('grainline_order_payment_staff_timeline', 'text, text, integer', 'plpgsql', 's', 's', true, true, '60841899dccd96b103526744f26f3fae'),
      ('grainline_order_refund_claim_mark_ambiguous', 'text, bigint, text', 'plpgsql', 'v', 'u', true, true, '0378491226cccdaa0edb0ccd8d573093'),
      ('grainline_order_refund_reconcile', 'text, text, bigint, text, text, bigint, text, text', 'plpgsql', 'v', 'u', true, true, '8f71265e548591a89822e303f3e38edc'),
      ('grainline_order_refund_reconciliation_immutable', '', 'plpgsql', 'v', 'u', false, false, '38c5f5e128c4068b70f9cf394890618c'),
      ('grainline_order_refund_reconciliation_prepare', 'text, text', 'plpgsql', 's', 'u', true, true, '67a7ae66d14b3034247eb20c7bb54a5d'),
      ('grainline_seller_refund_claim', 'text, text', 'plpgsql', 'v', 'u', true, true, '52201c09cafd79eee28d7c3bb5f3ee38'),
      ('grainline_seller_refund_record', 'text, text, bigint, text, text, text, integer', 'plpgsql', 'v', 'u', true, true, '90696d8074ce8af6b683513b5af153c7')
  ), actual AS (
    SELECT
      expected.*,
      procedure.oid,
      procedure.proowner,
      procedure.prokind,
      procedure.proleakproof,
      procedure.proconfig,
      procedure.proacl,
      procedure.prosrc,
      procedure.prosecdef,
      procedure.provolatile,
      procedure.proparallel,
      language.lanname,
      pg_catalog.has_function_privilege(
        'grainline_app_runtime', procedure.oid, 'EXECUTE'
      ) AS runtime_can_execute
    FROM expected
    LEFT JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.function_name
     AND pg_catalog.oidvectortypes(procedure.proargtypes) =
         expected.identity_arguments
     AND procedure.pronamespace = 'public'::pg_catalog.regnamespace
    LEFT JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
  )
  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM actual
   WHERE oid IS NOT NULL
     AND proowner = table_owner
     AND prokind = 'f'
     AND NOT proleakproof
     AND prosecdef = security_definer
     AND provolatile = volatility
     AND proparallel = parallel_safety
     AND lanname = language_name
     AND proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(prosrc) = source_md5
     AND runtime_can_execute = runtime_execute
     AND pg_catalog.strpos(pg_catalog.upper(prosrc), 'EXECUTE') = 0
     AND pg_catalog.strpos(pg_catalog.upper(prosrc), 'FORMAT(') = 0
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(proacl, pg_catalog.acldefault('f', proowner))
         ) AS acl
        WHERE acl.privilege_type <> 'EXECUTE'
           OR acl.grantee = 0
           OR acl.grantee NOT IN (
             proowner,
             (SELECT role.oid FROM pg_catalog.pg_roles AS role
               WHERE role.rolname = 'grainline_app_runtime')
           )
           OR (
             acl.grantee = (
               SELECT role.oid FROM pg_catalog.pg_roles AS role
                WHERE role.rolname = 'grainline_app_runtime'
             )
             AND (
               NOT runtime_execute
               OR acl.grantor <> proowner
               OR acl.is_grantable
             )
           )
     );
  IF function_count <> 29 THEN
    RAISE EXCEPTION
      'OrderPaymentEvent activated function catalog drifted: %',
      function_count;
  END IF;

  WITH expected(function_name) AS (
    VALUES
      ('grainline_blocked_checkout_refund_claim'),
      ('grainline_blocked_checkout_refund_claim_resume'),
      ('grainline_blocked_checkout_refund_reconciliation_record'),
      ('grainline_blocked_checkout_refund_record'),
      ('grainline_blocked_checkout_refund_record_core'),
      ('grainline_blocked_checkout_transfer_bind'),
      ('grainline_case_seller_refund_apply'),
      ('grainline_order_currency_payment_immutable'),
      ('grainline_order_payment_buyer_export_page'),
      ('grainline_order_payment_buyer_refund_outcomes'),
      ('grainline_order_payment_event_immutable'),
      ('grainline_order_payment_event_validate_insert'),
      ('grainline_order_payment_open_dispute_guard'),
      ('grainline_order_payment_open_dispute_refresh'),
      ('grainline_order_payment_open_dispute_state'),
      ('grainline_order_payment_projection_guard'),
      ('grainline_order_payment_projection_refresh'),
      ('grainline_order_payment_projection_state'),
      ('grainline_order_payment_seller_export_page'),
      ('grainline_order_payment_seller_refund_outcomes'),
      ('grainline_order_payment_signed_dispute_apply'),
      ('grainline_order_payment_signed_refund_apply'),
      ('grainline_order_payment_staff_timeline'),
      ('grainline_order_refund_claim_mark_ambiguous'),
      ('grainline_order_refund_reconcile'),
      ('grainline_order_refund_reconciliation_immutable'),
      ('grainline_order_refund_reconciliation_prepare'),
      ('grainline_seller_refund_claim'),
      ('grainline_seller_refund_record')
  )
  SELECT pg_catalog.count(*)::integer
    INTO named_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN expected ON expected.function_name = procedure.proname
   WHERE namespace.nspname = 'public';
  IF named_function_count <> 29 THEN
    RAISE EXCEPTION
      'OrderPaymentEvent activated trusted-name overload surface drifted: %',
      named_function_count;
  END IF;
END
$grainline_order_payment_event_activation_postflight$;

COMMIT;
