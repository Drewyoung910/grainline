-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Separate posture-only FORCE hardening after the accepted policyless
-- CheckoutStockReservation Phase-A activation. This changes no row, policy,
-- grant, function, trigger, constraint, index or application/provider state.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.checkout-stock-reservation.rls.activation',
    0
  )
);

LOCK TABLE public."CheckoutStockReservation" IN ACCESS EXCLUSIVE MODE;

DO $grainline_checkout_reservation_force_preflight$
DECLARE
  reservation_owner oid;
  runtime_role record;
  runtime_role_oid oid;
  owner_role record;
  owner_session_count integer;
  accepted_table_count integer;
  actual_function_count integer;
  accepted_function_count integer;
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
      'grainline_app_runtime role posture is not reservation-FORCE safe';
  END IF;
  runtime_role_oid := runtime_role.oid;

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

  SELECT class.relowner
    INTO STRICT reservation_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CheckoutStockReservation'
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
     OR owner_role.oid IS DISTINCT FROM reservation_owner
     OR owner_role.oid = runtime_role_oid THEN
    RAISE EXCEPTION
      'CheckoutStockReservation FORCE migration owner identity drifted';
  END IF;
  IF current_user = 'neondb_owner' THEN
    IF owner_role.rolsuper OR NOT owner_role.rolbypassrls THEN
      RAISE EXCEPTION
        'neondb_owner role posture is not reservation-FORCE safe';
    END IF;
  ELSIF current_user = 'ci'
        AND pg_catalog.current_database() = 'grainline_ci' THEN
    IF NOT owner_role.rolsuper THEN
      RAISE EXCEPTION
        'disposable CI migration owner posture drifted';
    END IF;
  ELSE
    RAISE EXCEPTION
      'CheckoutStockReservation FORCE must run as a reviewed migration owner';
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
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CheckoutStockReservation'
     AND class.relkind = 'r'
     AND class.relowner = reservation_owner
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
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
          AND acl.grantee IN (0, runtime_role_oid)
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation FORCE predecessor drifted';
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
      ('grainline_checkout_reservation_account_scrub', 'text', '204cb76e973d4a392daacbbe371648eb', true, 'v', 'u')
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
     AND language.lanname = 'plpgsql'
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
  IF actual_function_count <> 20 OR accepted_function_count <> 20 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation FORCE function catalog drifted: actual %, accepted %',
      actual_function_count,
      accepted_function_count;
  END IF;
END
$grainline_checkout_reservation_force_preflight$;

ALTER TABLE public."CheckoutStockReservation" FORCE ROW LEVEL SECURITY;

DO $grainline_checkout_reservation_force_postflight$
DECLARE
  accepted_table_count integer;
  runtime_role_oid oid;
BEGIN
  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';

  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CheckoutStockReservation'
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND class.relforcerowsecurity
     AND class.relowner = (
       SELECT role.oid
         FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = current_user
     )
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
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
          AND acl.grantee IN (0, runtime_role_oid)
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'CheckoutStockReservation FORCE postflight did not reach exact state';
  END IF;
END
$grainline_checkout_reservation_force_postflight$;

COMMIT;
