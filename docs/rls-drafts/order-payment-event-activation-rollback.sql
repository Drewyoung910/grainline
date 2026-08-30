-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Database-first emergency rollback for the initial policyless activation.
-- It restores only the exact compatible predecessor authority surface.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order-payment-event.rls.activation',
    0
  )
);

LOCK TABLE public."Order" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public."OrderPaymentEvent" IN ACCESS EXCLUSIVE MODE;

DO $grainline_order_payment_event_activation_rollback_preflight$
DECLARE
  table_owner oid;
  invalid_table_acl_count integer;
  function_count integer;
  named_function_count integer;
  unexpected_direct_function_count integer;
BEGIN
  SELECT class.relowner
    INTO table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderPaymentEvent"'::pg_catalog.regclass;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."OrderPaymentEvent"'::pg_catalog.regclass
       AND class.relrowsecurity
       AND NOT class.relforcerowsecurity
       AND NOT pg_catalog.has_table_privilege(
         'grainline_app_runtime', class.oid,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid
       )
  ) THEN
    RAISE EXCEPTION 'OrderPaymentEvent rollback predecessor drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invalid_table_acl_count
    FROM pg_catalog.pg_class AS class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) AS acl
   WHERE class.oid = 'public."OrderPaymentEvent"'::pg_catalog.regclass
     AND acl.grantee <> class.relowner;
  IF invalid_table_acl_count <> 0 THEN
    RAISE EXCEPTION 'OrderPaymentEvent rollback table ACLs drifted: %',
      invalid_table_acl_count;
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
      'OrderPaymentEvent rollback predecessor function catalog drifted: %',
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
      'OrderPaymentEvent rollback predecessor trusted-name overload surface drifted: %',
      named_function_count;
  END IF;
END
$grainline_order_payment_event_activation_rollback_preflight$;

ALTER TABLE public."OrderPaymentEvent" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."OrderPaymentEvent" DISABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."OrderPaymentEvent"
  FROM PUBLIC, grainline_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."OrderPaymentEvent"
  TO grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_blocked_checkout_refund_claim(text, bigint, text, text, integer) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_case_seller_refund_apply(text, text) TO grainline_app_runtime;

DO $grainline_order_payment_event_activation_rollback_postflight$
DECLARE
  table_owner oid;
  invalid_table_acl_count integer;
  function_count integer;
  named_function_count integer;
  unexpected_direct_function_count integer;
BEGIN
  SELECT class.relowner
    INTO table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderPaymentEvent"'::pg_catalog.regclass;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."OrderPaymentEvent"'::pg_catalog.regclass
       AND NOT class.relrowsecurity
       AND NOT class.relforcerowsecurity
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
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid
       )
  ) THEN
    RAISE EXCEPTION 'OrderPaymentEvent rollback did not restore predecessor';
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
    RAISE EXCEPTION 'OrderPaymentEvent rollback restored invalid table ACLs: %',
      invalid_table_acl_count;
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
      'OrderPaymentEvent rollback postflight function catalog drifted: %',
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
      'OrderPaymentEvent rollback postflight trusted-name overload surface drifted: %',
      named_function_count;
  END IF;
END
$grainline_order_payment_event_activation_rollback_postflight$;

COMMIT;
