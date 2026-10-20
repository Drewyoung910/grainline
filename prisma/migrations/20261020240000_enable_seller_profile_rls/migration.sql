-- Policyless SellerProfile ENABLE after every application caller has moved to
-- a purpose-bound database operation. FORCE remains a separate posture-only
-- release after ENABLE evidence is accepted.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.seller-profile-public.rls.activation',
    0
  )
);

LOCK TABLE public."SellerProfile" IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_profile_activation_preflight$
DECLARE
  table_owner oid;
  migration_role record;
  restricted_role_count integer;
  predecessor_acl_count integer;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
     AND class.relkind = 'r';

  IF table_owner IS DISTINCT FROM (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) OR current_user <> session_user THEN
    RAISE EXCEPTION
      'SellerProfile ENABLE requires a direct table-owner session';
  END IF;

  SELECT role.rolsuper, role.rolbypassrls
    INTO migration_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (migration_role.rolsuper OR migration_role.rolbypassrls) THEN
    RAISE EXCEPTION
      'SellerProfile owner must bypass later FORCE RLS';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO restricted_role_count
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname IN (
     'grainline_app_runtime',
     'grainline_staff_read_runtime'
   )
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND role.rolcanlogin
     AND NOT role.rolcreatedb
     AND NOT role.rolcreaterole
     AND NOT role.rolreplication
     AND NOT role.rolbypassrls;
  IF restricted_role_count <> 2 THEN
    RAISE EXCEPTION 'SellerProfile restricted-role posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM public._prisma_migrations AS migration
     WHERE migration.migration_name =
           '20261020230000_prepare_seller_profile_staff_orderability_transition'
       AND migration.checksum =
           'a6912d3fa0fd6c183cfa246d349b00ae1984d980411831e482b246a8b49226de'
       AND migration.finished_at IS NOT NULL
       AND migration.rolled_back_at IS NULL
       AND migration.applied_steps_count = 1
  ) <> 1 THEN
    RAISE EXCEPTION 'SellerProfile ENABLE preparation prerequisite drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
       AND (class.relrowsecurity OR class.relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."SellerProfile"'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION
      'SellerProfile ENABLE requires the exact policyless pre-RLS posture';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO predecessor_acl_count
    FROM pg_catalog.pg_class AS class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) AS acl
    JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
   WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
     AND acl.grantee <> class.relowner
     AND role.rolname = 'grainline_app_runtime'
     AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
     AND NOT acl.is_grantable;
  IF predecessor_acl_count <> 4 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
      LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
     WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
       AND acl.grantee <> class.relowner
       AND (
         role.rolname IS DISTINCT FROM 'grainline_app_runtime'
         OR acl.privilege_type NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
         OR acl.is_grantable
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid = 'public."SellerProfile"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> table_owner
       AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION 'SellerProfile predecessor direct authority drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND class.relrowsecurity
       AND class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid
       )
  ) THEN
    RAISE EXCEPTION
      'SellerProfile ENABLE requires accepted private-companion FORCE posture';
  END IF;
END
$grainline_seller_profile_activation_preflight$;

ALTER TABLE public."SellerProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SellerProfile" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."SellerProfile"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_seller_profile_activation_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
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
        WHERE acl.grantee <> class.relowner
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
          AND acl.grantee <> class.relowner
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_staff_read_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'SellerProfile ENABLE did not establish exact policyless posture';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND class.relrowsecurity
       AND class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid
       )
  ) THEN
    RAISE EXCEPTION
      'SellerProfile ENABLE crossed the private-companion boundary';
  END IF;
END
$grainline_seller_profile_activation_postflight$;

COMMIT;
