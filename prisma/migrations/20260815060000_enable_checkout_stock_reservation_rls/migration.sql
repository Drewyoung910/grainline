-- Promoted reviewed policyless CheckoutStockReservation ENABLE activation.
-- FORCE RLS remains a separate later posture-only release.
--
-- Policyless CheckoutStockReservation ENABLE activation after the compatible
-- fixed-operation application is deployed and predecessor versions drain.
-- FORCE is a separate later posture-only release.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.checkout-stock-reservation.rls.activation',
    0
  )
);

LOCK TABLE public."CheckoutStockReservation" IN ACCESS EXCLUSIVE MODE;

DO $grainline_checkout_reservation_activation_preflight$
DECLARE
  reservation_owner oid;
  reservation_rls boolean;
  reservation_force boolean;
  runtime_role record;
  runtime_role_oid oid;
  owner_role record;
  owner_session_count integer;
  policy_count integer;
  actual_constraint_count integer;
  accepted_constraint_count integer;
  actual_index_count integer;
  accepted_index_count integer;
  actual_trigger_count integer;
  normalize_trigger_count integer;
  invalid_row_count bigint;
  actual_function_count integer;
  accepted_function_count integer;
BEGIN
  SELECT class.relowner, class.relrowsecurity, class.relforcerowsecurity
    INTO STRICT reservation_owner, reservation_rls, reservation_force
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CheckoutStockReservation'
     AND class.relkind = 'r';

  IF reservation_owner IS DISTINCT FROM (
       SELECT role.oid
         FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     ) OR reservation_rls OR reservation_force THEN
    RAISE EXCEPTION
      'CheckoutStockReservation activation requires the exact owner-held compatible predecessor';
  END IF;

  SELECT role.rolsuper, role.rolbypassrls
    INTO owner_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (
    (
      current_user = 'neondb_owner'
      AND NOT owner_role.rolsuper
      AND owner_role.rolbypassrls
    )
    OR (
      current_user = 'ci'
      AND owner_role.rolsuper
      AND pg_catalog.current_database() = 'grainline_ci'
    )
  ) THEN
    RAISE EXCEPTION 'CheckoutStockReservation activation owner identity drifted';
  END IF;

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
     OR runtime_role.rolbypassrls
     OR reservation_owner = runtime_role.oid THEN
    RAISE EXCEPTION
      'grainline_app_runtime role posture is not reservation-activation safe';
  END IF;
  runtime_role_oid := runtime_role.oid;

  -- Retain only Neon's proven non-effective administrative bootstrap edge.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member
        ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor
        ON grantor.oid = membership.grantor
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
        JOIN pg_catalog.pg_roles AS parent
          ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles AS child
          ON child.oid = membership.member
       WHERE parent.rolname = 'grainline_app_runtime'
      UNION
      SELECT child.oid, child.rolname
        FROM restricted_members AS parent
        JOIN pg_catalog.pg_auth_members AS membership
          ON membership.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS child
          ON child.oid = membership.member
    )
    SELECT 1
      FROM restricted_members
     WHERE rolname <> 'neondb_owner'
  ) THEN
    RAISE EXCEPTION
      'CheckoutStockReservation runtime role retains unreviewed membership';
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
      'CheckoutStockReservation owner-session drain is incomplete: % other owner sessions remain',
      owner_session_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid =
         'public."CheckoutStockReservation"'::pg_catalog.regclass;
  IF policy_count <> 0 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation service-only activation requires zero policies';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CheckoutStockReservation"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CheckoutStockReservation"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CheckoutStockReservation"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CheckoutStockReservation"', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CheckoutStockReservation"',
       'TRUNCATE,REFERENCES,TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'CheckoutStockReservation activation predecessor table grants drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid =
           'public."CheckoutStockReservation"'::pg_catalog.regclass
       AND acl.grantee = 0
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'DELETE',
         'TRUNCATE', 'REFERENCES', 'TRIGGER'
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid =
           'public."CheckoutStockReservation"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee IN (0, runtime_role_oid)
       AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION
      'CheckoutStockReservation activation predecessor retains PUBLIC or column authority';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO actual_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public."CheckoutStockReservation"'::pg_catalog.regclass
     AND constraint_row.contype = 'c';

  WITH expected(name, definition_md5) AS (
    VALUES
      ('CheckoutStockReservation_status_chk', '7891cacaf44cccb4143575bd7f4e2374'),
      ('CheckoutStockReservation_reservedItems_array_chk', '0104a657176a1679dcb22fdcaa396cfe'),
      ('CheckoutStockReservation_repairGeneration_check', '85635bc977ba5147e943913b37a440e4'),
      ('CheckoutStockReservation_payloadHash_check', '319d62cb621dafe7991336d95c98c1ba'),
      ('CheckoutStockReservation_repairClaim_check', '0c6026f0bc7780b1154a6d6f4266f20a')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_constraint_count
    FROM expected
    JOIN pg_catalog.pg_constraint AS constraint_row
      ON constraint_row.conname = expected.name
     AND constraint_row.conrelid =
         'public."CheckoutStockReservation"'::pg_catalog.regclass
   WHERE constraint_row.contype = 'c'
     AND constraint_row.convalidated
     AND NOT constraint_row.connoinherit
     AND pg_catalog.md5(
       pg_catalog.pg_get_constraintdef(constraint_row.oid)
     ) = expected.definition_md5;
  IF actual_constraint_count <> 5 OR accepted_constraint_count <> 5 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation constraint catalog drifted: actual %, accepted %',
      actual_constraint_count,
      accepted_constraint_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO actual_index_count
    FROM pg_catalog.pg_index AS index_row
   WHERE index_row.indrelid =
         'public."CheckoutStockReservation"'::pg_catalog.regclass;

  WITH expected(
    name, column_names, is_unique, is_primary, predicate
  ) AS (
    VALUES
      ('CheckoutStockReservation_pkey', ARRAY['id']::text[], true, true, NULL::text),
      ('CheckoutStockReservation_stripeSessionId_key', ARRAY['stripeSessionId']::text[], true, false, NULL::text),
      ('CheckoutStockReservation_checkoutLockKey_idx', ARRAY['checkoutLockKey']::text[], false, false, NULL::text),
      ('CheckoutStockReservation_status_expiresAt_idx', ARRAY['status', 'expiresAt']::text[], false, false, NULL::text),
      ('CheckoutStockReservation_buyerId_createdAt_idx', ARRAY['buyerId', 'createdAt']::text[], false, false, NULL::text),
      ('CheckoutStockReservation_sellerId_createdAt_idx', ARRAY['sellerId', 'createdAt']::text[], false, false, NULL::text),
      ('CheckoutStockReservation_buyerId_checkoutGroupId_idx', ARRAY['buyerId', 'checkoutGroupId']::text[], false, false, NULL::text),
      (
        'CheckoutStockReservation_active_lock_key',
        ARRAY['checkoutLockKey']::text[],
        true,
        false,
        '((status)::text = ANY ((ARRAY[''RESERVED''::character varying, ''SESSION_CREATED''::character varying])::text[]))'
      ),
      ('CheckoutStockReservation_repair_claim_idx', ARRAY['status', 'expiresAt', 'repairClaimedAt', 'id']::text[], false, false, NULL::text)
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_index_count
    FROM expected
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.relname = expected.name
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
     AND index_namespace.nspname = 'public'
    JOIN pg_catalog.pg_index AS index_row
      ON index_row.indexrelid = index_class.oid
     AND index_row.indrelid =
         'public."CheckoutStockReservation"'::pg_catalog.regclass
   WHERE index_row.indisvalid
     AND index_row.indisready
     AND index_row.indisunique = expected.is_unique
     AND index_row.indisprimary = expected.is_primary
     AND NOT index_row.indisexclusion
     AND index_row.indexprs IS NULL
     AND index_row.indnkeyatts = index_row.indnatts
     AND (
       SELECT pg_catalog.array_agg(
         attribute.attname::text ORDER BY key.ordinality
       )
         FROM unnest(index_row.indkey) WITH ORDINALITY AS key(attnum, ordinality)
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid = index_row.indrelid
          AND attribute.attnum = key.attnum
        WHERE key.ordinality <= index_row.indnkeyatts
     ) = expected.column_names
     AND pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
         IS NOT DISTINCT FROM expected.predicate;
  IF actual_index_count <> 9 OR accepted_index_count <> 9 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation index catalog drifted: actual %, accepted %',
      actual_index_count,
      accepted_index_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO actual_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_row
   WHERE trigger_row.tgrelid =
         'public."CheckoutStockReservation"'::pg_catalog.regclass
     AND NOT trigger_row.tgisinternal;

  SELECT pg_catalog.count(*)::integer
    INTO normalize_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger_row.tgfoid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE trigger_row.tgrelid =
         'public."CheckoutStockReservation"'::pg_catalog.regclass
     AND NOT trigger_row.tgisinternal
     AND trigger_row.tgname = 'CheckoutStockReservation_normalize_write'
     AND trigger_row.tgenabled = 'O'
     AND namespace.nspname = 'public'
     AND procedure.proname = 'grainline_checkout_reservation_normalize_write'
     AND pg_catalog.oidvectortypes(procedure.proargtypes) = '';
  IF actual_trigger_count <> 1 OR normalize_trigger_count <> 1 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation trigger catalog drifted: actual %, accepted %',
      actual_trigger_count,
      normalize_trigger_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO invalid_row_count
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation.status NOT IN (
           'RESERVED', 'SESSION_CREATED', 'COMPLETED', 'RESTORED'
         )
      OR reservation."repairGeneration" < 0
      OR (reservation."repairClaimedAt" IS NULL) <>
         (reservation."repairClaimKind" IS NULL)
      OR (
        reservation."repairClaimKind" IS NOT NULL
        AND reservation."repairClaimKind" NOT IN ('CRON', 'ACCOUNT')
      )
      OR (
        reservation."repairClaimedAt" IS NOT NULL
        AND reservation.status NOT IN ('RESERVED', 'SESSION_CREATED')
      )
      OR (
        reservation.status = 'RESERVED'
        AND reservation."stripeSessionId" IS NOT NULL
      )
      OR (
        reservation.status IN ('SESSION_CREATED', 'COMPLETED')
        AND reservation."stripeSessionId" IS NULL
      )
      OR (
        reservation.status = 'RESTORED'
        AND (
          reservation."restoredAt" IS NULL
          OR reservation."restoreReason" IS NULL
        )
      )
      OR (
        reservation.status <> 'RESTORED'
        AND (
          reservation."restoredAt" IS NOT NULL
          OR reservation."restoreReason" IS NOT NULL
        )
      )
      OR (
        reservation."payloadHash" = 'deleted'
        AND (
          reservation.status NOT IN ('COMPLETED', 'RESTORED')
          OR reservation."checkoutLockKey" IS DISTINCT FROM
             'deleted:' || reservation.id
          OR reservation."buyerId" IS NOT NULL
          OR reservation."sellerId" IS NOT NULL
        )
      )
      OR (
        reservation."payloadHash" <> 'deleted'
        AND (
          reservation."payloadHash" !~ '^[A-Za-z0-9_-]{32}$'
          OR reservation."buyerId" IS NULL
          OR reservation."sellerId" IS NULL
          OR reservation."checkoutLockKey" LIKE 'deleted:%'
        )
      )
      OR NOT public.grainline_checkout_reservation_items_valid(
        reservation."reservedItems",
        reservation."payloadHash",
        reservation."sellerId"
      );
  IF invalid_row_count <> 0 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation activation found % invalid rows',
      invalid_row_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO actual_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND (
       procedure.proname LIKE 'grainline_checkout_reservation_%'
       OR (
         procedure.proname = 'grainline_stripe_webhook_bind_source'
         AND pg_catalog.oidvectortypes(procedure.proargtypes) =
             'text, text, bigint, text'
       )
       OR (
         procedure.proname = 'grainline_stripe_webhook_begin'
         AND pg_catalog.oidvectortypes(procedure.proargtypes) =
             'text, text, text'
       )
     );

  WITH expected(
    name, argument_types, source_md5, runtime_execute, volatility, parallel_safety
  ) AS (
    VALUES
      ('grainline_stripe_webhook_bind_source', 'text, text, bigint, text', '561550b97e0e47e8402707b710748572', false, 'v', 'u'),
      ('grainline_stripe_webhook_begin', 'text, text, text', '4970bc970997f86c1aedbd8768be4ab7', true, 'v', 'u'),
      ('grainline_checkout_reservation_items_valid', 'jsonb, text, text', '0e456901aa16519256ea8c3142006a1f', false, 'i', 's'),
      ('grainline_checkout_reservation_normalize_write', '', '67fdd18fffae2e855fc10604e52ae95d', false, 'v', 'u'),
      ('grainline_checkout_reservation_restore_items', 'jsonb', '9f7bf1e24f072039885e9eb814eb994a', false, 'v', 'u'),
      ('grainline_checkout_reservation_create_cart', 'text, text, text, text, text', 'ddac62a2be4a1ec28f3ec882bf10958e', true, 'v', 'u'),
      ('grainline_checkout_reservation_create_single', 'text, text, integer, text', 'bb16bc54caa71be1b0f545d35eefb690', true, 'v', 'u'),
      ('grainline_checkout_reservation_bind_session', 'text, text, text, text', '9042924d8f9cf8ccaea364e7be676287', true, 'v', 'u'),
      ('grainline_checkout_reservation_complete', 'text, bigint, text, text', 'aa59397f525cf9029f5a594fe1521c57', true, 'v', 'u'),
      ('grainline_checkout_reservation_checkout_abort', 'text, text, text', 'aa131201685304950ff403b4affb9189', true, 'v', 'u'),
      ('grainline_checkout_reservation_webhook_restore', 'text, bigint, text', '3d2d4e363f4ccd9b79e4cd442ae53116', true, 'v', 'u'),
      ('grainline_checkout_reservation_buyer_expired_restore', 'text, text', 'b6925c824ab4afc7c206855ad12b0314', true, 'v', 'u'),
      ('grainline_checkout_reservation_seller_expired_restore', 'text, text', '610bbacc971c33a5730c552d7dd57f44', true, 'v', 'u'),
      ('grainline_checkout_reservation_repair_claim_batch', 'integer', 'e05618f70384c7535864030f87704135', true, 'v', 'u'),
      ('grainline_checkout_reservation_account_claim_batch', 'text, integer', 'e5f565aa1549dcb2c3b74081973d0306', true, 'v', 'u'),
      ('grainline_checkout_reservation_repair_finalize', 'text, bigint, text', '5df36cef68664c30cb985056b87e1254', true, 'v', 'u'),
      ('grainline_checkout_reservation_prune_batch', 'integer', 'f9c2d62ce2a82657928afa6399db53e2', true, 'v', 'u'),
      ('grainline_checkout_reservation_resume', 'text, text', 'f25581ea5cbc7a5390988a8853b21150', true, 's', 's'),
      ('grainline_checkout_reservation_export', 'text', '0b0426052ab9a9a06e4b75de995c632f', true, 's', 's'),
      ('grainline_checkout_reservation_account_scrub', 'text', '204cb76e973d4a392daacbbe371648eb', true, 'v', 'u'),
      ('grainline_checkout_reservation_seller_witness', 'text', '60e43ce6f6dc495d98afbbc4757060d3', false, 's', 'r'),
      ('grainline_checkout_reservation_listing_witness', 'text', 'eba60a39a068b734befca3a200733614', false, 's', 'r'),
      ('grainline_checkout_reservation_variant_source_valid', 'text, text[], integer', 'e0159bfb56a09f6319e8a1e94a934bbf', false, 's', 'r'),
      ('grainline_checkout_reservation_create_cart_consistent', 'text, text, text, text, text, jsonb', '27d3c17ed664dfe961c6f0fd22b53041', true, 'v', 'u'),
      ('grainline_checkout_reservation_create_single_consistent', 'text, text, integer, text[], text, jsonb', '3bf7188f3b5fb160821cd1d11c48f900', true, 'v', 'u')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.name
     AND pg_catalog.oidvectortypes(procedure.proargtypes) =
         expected.argument_types
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE namespace.nspname = 'public'
     AND language.lanname = CASE
       WHEN expected.name IN (
         'grainline_checkout_reservation_seller_witness',
         'grainline_checkout_reservation_listing_witness',
         'grainline_checkout_reservation_variant_source_valid'
       ) THEN 'sql'
       ELSE 'plpgsql'
     END
     AND procedure.prokind = 'f'
     AND procedure.proowner = reservation_owner
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile::text = expected.volatility
     AND procedure.proparallel::text = expected.parallel_safety
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     ) = expected.runtime_execute
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.privilege_type <> 'EXECUTE'
           OR acl.grantee = 0
           OR acl.grantee NOT IN (procedure.proowner, runtime_role_oid)
           OR (
             acl.grantee = runtime_role_oid
             AND (
               NOT expected.runtime_execute
               OR acl.grantor <> procedure.proowner
               OR acl.is_grantable
             )
           )
     );
  IF actual_function_count <> 25 OR accepted_function_count <> 25 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation activation function catalog drifted: actual %, accepted %',
      actual_function_count,
      accepted_function_count;
  END IF;
END
$grainline_checkout_reservation_activation_preflight$;

ALTER TABLE public."CheckoutStockReservation" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."CheckoutStockReservation"
  FROM PUBLIC, grainline_app_runtime;

-- Every current application path uses the source-consistent one-statement
-- successors. Keep the legacy functions installed for database-first rollback,
-- but retire their runtime execution authority after predecessor drain.
REVOKE EXECUTE ON FUNCTION
  public.grainline_checkout_reservation_create_cart(text, text, text, text, text),
  public.grainline_checkout_reservation_create_single(text, text, integer, text)
  FROM PUBLIC, grainline_app_runtime;

DO $grainline_checkout_reservation_activation_postflight$
DECLARE
  accepted_table_count integer;
  retired_creation_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CheckoutStockReservation'
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND class.relowner = (
       SELECT role.oid
         FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'DELETE',
            'TRUNCATE', 'REFERENCES', 'TRIGGER'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.grantee IN (
            0,
            (SELECT role.oid FROM pg_catalog.pg_roles AS role
              WHERE role.rolname = 'grainline_app_runtime')
          )
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation activation postflight did not reach exact policyless state';
  END IF;

  WITH expected(name, argument_types) AS (
    VALUES
      ('grainline_checkout_reservation_create_cart', 'text, text, text, text, text'),
      ('grainline_checkout_reservation_create_single', 'text, text, integer, text')
  )
  SELECT pg_catalog.count(*)::integer
    INTO retired_creation_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.name
     AND pg_catalog.oidvectortypes(procedure.proargtypes) =
         expected.argument_types
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proowner = (
       SELECT role.oid
         FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
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
  IF retired_creation_count <> 2 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation legacy creation authority was not retired';
  END IF;
END
$grainline_checkout_reservation_activation_postflight$;

COMMIT;
