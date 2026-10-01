-- DRAFT ONLY. Do not apply to any persistent database.
-- Policyless OrderShippingRateQuote ENABLE follows accepted OrderItem FORCE.
-- Core Order and OrderItem stay policyless FORCE as separate accepted releases.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order-shipping-rate-quote.rls.activation', 0)
);
LOCK TABLE public."OrderShippingRateQuote" IN ACCESS EXCLUSIVE MODE;

DO $grainline_order_quote_activation_preflight$
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
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'OrderShippingRateQuote ENABLE requires a direct owner session';
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
    RAISE EXCEPTION 'grainline_app_runtime role posture is not OrderShippingRateQuote ENABLE-safe';
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
    RAISE EXCEPTION 'Order quote runtime role retains unreviewed role membership';
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
      'grainline_staff_read_runtime role posture is not OrderShippingRateQuote ENABLE-safe';
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
    RAISE EXCEPTION 'Order quote staff role retains unreviewed role membership';
  END IF;

  SELECT class.relowner INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderShippingRateQuote"'::pg_catalog.regclass
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
    RAISE EXCEPTION 'OrderShippingRateQuote ENABLE owner identity drifted';
  END IF;
  IF current_user = 'neondb_owner' THEN
    IF owner_role.rolsuper OR NOT owner_role.rolbypassrls
       OR pg_catalog.current_database() <> 'neondb' THEN
      RAISE EXCEPTION 'neondb_owner role posture is not OrderShippingRateQuote ENABLE-safe';
    END IF;
  ELSIF current_user = 'ci'
        AND pg_catalog.current_database() = 'grainline_ci' THEN
    IF NOT owner_role.rolsuper THEN
      RAISE EXCEPTION 'disposable CI migration owner posture drifted';
    END IF;
  ELSE
    RAISE EXCEPTION 'OrderShippingRateQuote ENABLE requires a reviewed migration owner';
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
      'OrderShippingRateQuote owner-session drain is incomplete: % other owner sessions remain',
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
        AND class.relrowsecurity AND class.relforcerowsecurity)
       OR
       (class.relname = 'OrderShippingRateQuote'
        AND NOT class.relrowsecurity AND NOT class.relforcerowsecurity)
     );
  IF accepted_tables <> 3 THEN
    RAISE EXCEPTION 'OrderShippingRateQuote ENABLE predecessor table posture drifted';
  END IF;

  WITH expected(function_identity, source_md5) AS (
    VALUES
      ('grainline_order_account_deletion_scrub(text,text[])', '95b5fdf923f85bcc96e8e25ac8905295'),
      ('grainline_order_buyer_pii_prune_batch(integer)', '885f070bf1f4934fb8786b820672cfbe'),
      ('grainline_order_seller_label_claim(text,text,text)', 'c1bc1cfe61a5bfd910df308300c80b03'),
      ('grainline_order_seller_label_quote_replace(text,text,text,jsonb)', '5487c98b0c8a574946d2ac997d31e79a')
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
       AND pg_catalog.strpos(procedure.prosrc, '"OrderShippingRateQuote"') > 0
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
        AND (
          SELECT pg_catalog.count(*)
            FROM pg_catalog.aclexplode(
              COALESCE((SELECT procedure.proacl FROM pg_catalog.pg_proc AS procedure
                         WHERE procedure.oid = actual.oid),
                       pg_catalog.acldefault('f', actual.proowner))
            ) AS acl
           WHERE acl.grantee <> actual.proowner
        ) = 1
        AND EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE((SELECT procedure.proacl FROM pg_catalog.pg_proc AS procedure
                         WHERE procedure.oid = actual.oid),
                       pg_catalog.acldefault('f', actual.proowner))
            ) AS acl
           WHERE acl.grantee = runtime_role_oid
             AND acl.privilege_type = 'EXECUTE'
             AND NOT acl.is_grantable
        )
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
  IF accepted_functions <> 4
     OR actual_function_count <> 4
     OR expected_function_count <> 4 THEN
    RAISE EXCEPTION 'OrderShippingRateQuote ENABLE exact function catalog drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid =
       'public."OrderShippingRateQuote"'::pg_catalog.regclass
       AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'OrderShippingRateQuote ENABLE trigger catalog drifted';
  END IF;
END
$grainline_order_quote_activation_preflight$;

ALTER TABLE public."OrderShippingRateQuote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderShippingRateQuote" NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."OrderShippingRateQuote"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_order_quote_activation_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."OrderShippingRateQuote"'::pg_catalog.regclass
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
    RAISE EXCEPTION 'OrderShippingRateQuote ENABLE posture did not converge';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."OrderItem"'::pg_catalog.regclass
       AND class.relrowsecurity AND class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy AS policy WHERE policy.polrelid = class.oid
       )
  ) THEN
    RAISE EXCEPTION 'OrderShippingRateQuote ENABLE crossed the OrderItem boundary';
  END IF;
END
$grainline_order_quote_activation_postflight$;

COMMIT;
