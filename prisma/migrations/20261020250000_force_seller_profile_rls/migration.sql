-- Policyless SellerProfile FORCE after the separately accepted ENABLE.
-- This is a posture-only release: no policies, grants, rows, functions, or
-- application behavior change here.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.seller-profile-public.rls.activation',
    0
  )
);

LOCK TABLE public."SellerProfile", public."SellerProfilePrivate"
  IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_profile_force_preflight$
DECLARE
  table_owner oid;
  migration_role record;
  restricted_role_count integer;
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
    RAISE EXCEPTION 'SellerProfile FORCE requires a direct table-owner session';
  END IF;

  SELECT role.rolsuper, role.rolbypassrls
    INTO migration_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (migration_role.rolsuper OR migration_role.rolbypassrls) THEN
    RAISE EXCEPTION 'SellerProfile FORCE owner must bypass RLS';
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
    RAISE EXCEPTION 'SellerProfile FORCE restricted-role posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM public._prisma_migrations AS migration
     WHERE migration.migration_name =
           '20261020240000_enable_seller_profile_rls'
       AND migration.checksum =
           'f5b4676735d005748b597220584ceecfb8af5539aa72a95a83ac56cd4151e9b5'
       AND migration.finished_at IS NOT NULL
       AND migration.rolled_back_at IS NULL
       AND migration.applied_steps_count = 1
  ) <> 1 THEN
    RAISE EXCEPTION 'SellerProfile FORCE ENABLE prerequisite drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
       AND class.relrowsecurity
       AND NOT class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid
       )
  ) OR NOT EXISTS (
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
      'SellerProfile FORCE requires exact public ENABLE and private FORCE posture';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid IN (
       'public."SellerProfile"'::pg_catalog.regclass,
       'public."SellerProfilePrivate"'::pg_catalog.regclass
     )
       AND acl.grantee <> class.relowner
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'DELETE',
         'TRUNCATE', 'REFERENCES', 'TRIGGER'
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS class
        ON class.oid = attribute.attrelid
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid IN (
       'public."SellerProfile"'::pg_catalog.regclass,
       'public."SellerProfilePrivate"'::pg_catalog.regclass
     )
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> class.relowner
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
       )
  ) THEN
    RAISE EXCEPTION 'SellerProfile FORCE found non-owner direct authority';
  END IF;

  IF pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', 'public."SellerProfile"'::pg_catalog.regclass,
       'SELECT,INSERT,UPDATE,REFERENCES'
     ) OR pg_catalog.has_any_column_privilege(
       'grainline_staff_read_runtime', 'public."SellerProfile"'::pg_catalog.regclass,
       'SELECT,INSERT,UPDATE,REFERENCES'
     ) THEN
    RAISE EXCEPTION 'SellerProfile FORCE found restricted-role column authority';
  END IF;
END
$grainline_seller_profile_force_preflight$;

ALTER TABLE public."SellerProfile" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."SellerProfile"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_seller_profile_force_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid IN (
     'public."SellerProfile"'::pg_catalog.regclass,
     'public."SellerProfilePrivate"'::pg_catalog.regclass
   )
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND class.relforcerowsecurity
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
     );
  IF accepted_table_count <> 2 THEN
    RAISE EXCEPTION 'SellerProfile FORCE did not establish exact policyless posture';
  END IF;

  IF pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', 'public."SellerProfile"'::pg_catalog.regclass,
       'SELECT,INSERT,UPDATE,REFERENCES'
     ) OR pg_catalog.has_any_column_privilege(
       'grainline_staff_read_runtime', 'public."SellerProfile"'::pg_catalog.regclass,
       'SELECT,INSERT,UPDATE,REFERENCES'
     ) THEN
    RAISE EXCEPTION 'SellerProfile FORCE retained restricted-role column authority';
  END IF;
END
$grainline_seller_profile_force_postflight$;

COMMIT;
