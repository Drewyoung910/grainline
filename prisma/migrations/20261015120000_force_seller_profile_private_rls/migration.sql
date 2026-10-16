-- Policyless SellerProfilePrivate FORCE after the separately accepted ENABLE.
-- This is a posture-only release: no policies, grants, rows, functions, or
-- public SellerProfile behavior change here.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.seller-profile-private.rls.activation',
    0
  )
);

LOCK TABLE public."SellerProfile", public."SellerProfilePrivate"
  IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_profile_private_activation_preflight$
DECLARE
  table_owner oid;
  migration_role record;
  restricted_role_count integer;
  invalid_phone_count bigint;
  missing_private_count bigint;
  snapshot_mismatch_count bigint;
  invariant_object_count integer;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."SellerProfilePrivate"'::pg_catalog.regclass
     AND class.relkind = 'r';

  IF table_owner IS DISTINCT FROM (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) OR current_user <> session_user THEN
    RAISE EXCEPTION
      'SellerProfilePrivate FORCE requires a direct table-owner session';
  END IF;

  SELECT role.rolsuper, role.rolbypassrls
    INTO migration_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (migration_role.rolsuper OR migration_role.rolbypassrls) THEN
    RAISE EXCEPTION
      'SellerProfilePrivate FORCE owner must bypass RLS';
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
    RAISE EXCEPTION
      'SellerProfilePrivate FORCE restricted-role posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM public._prisma_migrations AS migration
     WHERE migration.migration_name =
           '20261015100000_enable_seller_profile_private_rls'
       AND migration.checksum =
           '3a5d128c6a5d5a7bd4bc768fe0d57d674b24a35a07ae776e442722481f26426c'
       AND migration.finished_at IS NOT NULL
       AND migration.rolled_back_at IS NULL
       AND migration.applied_steps_count = 1
  ) <> 1 THEN
    RAISE EXCEPTION
      'SellerProfilePrivate FORCE ENABLE prerequisite drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
       AND NOT class.relrowsecurity
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
       AND NOT class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid
       )
  ) THEN
    RAISE EXCEPTION
      'SellerProfilePrivate FORCE requires exact policyless ENABLE posture';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND acl.grantee <> class.relowner
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'DELETE',
         'TRUNCATE', 'REFERENCES', 'TRIGGER'
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND acl.grantee <> table_owner
       AND acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
       )
  ) THEN
    RAISE EXCEPTION
      'SellerProfilePrivate FORCE found non-owner direct authority';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invariant_object_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public."SellerProfilePrivate"'::pg_catalog.regclass
     AND constraint_row.conname =
         'SellerProfilePrivate_shipFromPhone_e164_check'
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated
     AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) =
         $constraint$CHECK ("shipFromPhone" IS NULL OR "shipFromPhone"::text ~ '^[+][1-9][0-9]{7,14}$'::text)$constraint$;
  IF invariant_object_count <> 1 THEN
    RAISE EXCEPTION
      'SellerProfilePrivate FORCE phone constraint drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invariant_object_count
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger_row.tgfoid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE NOT trigger_row.tgisinternal
     AND trigger_row.tgenabled = 'O'
     AND procedure.proowner = table_owner
     AND procedure.prokind = 'f'
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND namespace.nspname = 'public'
     AND pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') = 0
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner))
         ) AS acl
        WHERE acl.grantee <> procedure.proowner
          AND acl.privilege_type = 'EXECUTE'
     )
     AND (
       (
         trigger_row.tgrelid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
         AND trigger_row.tgname =
           'SellerProfilePrivate_supported_snapshot_sync'
         AND procedure.proname =
           'grainline_seller_profile_private_supported_snapshot_sync'
         AND pg_catalog.strpos(
           pg_catalog.pg_get_triggerdef(trigger_row.oid, true),
           'AFTER INSERT OR UPDATE OF "stripeAccountVersion"'
         ) > 0
         AND pg_catalog.strpos(
           pg_catalog.pg_get_triggerdef(trigger_row.oid, true),
           'grainline_seller_profile_private_supported_snapshot_sync()'
         ) > 0
       ) OR (
         trigger_row.tgrelid =
           'public."SellerProfile"'::pg_catalog.regclass
         AND trigger_row.tgname =
           'SellerProfile_supported_snapshot_guard'
         AND procedure.proname =
           'grainline_seller_profile_supported_snapshot_guard'
         AND pg_catalog.strpos(
           pg_catalog.pg_get_triggerdef(trigger_row.oid, true),
           'BEFORE INSERT OR UPDATE OF "stripeAccountSupported"'
         ) > 0
         AND pg_catalog.strpos(
           pg_catalog.pg_get_triggerdef(trigger_row.oid, true),
           'grainline_seller_profile_supported_snapshot_guard()'
         ) > 0
       )
     );
  IF invariant_object_count <> 2 THEN
    RAISE EXCEPTION
      'SellerProfilePrivate FORCE invariant trigger catalog drifted';
  END IF;

  SELECT pg_catalog.count(*)
    INTO invalid_phone_count
    FROM public."SellerProfilePrivate" AS seller_private
   WHERE seller_private."shipFromPhone" IS NOT NULL
     AND seller_private."shipFromPhone" !~ '^[+][1-9][0-9]{7,14}$';
  SELECT pg_catalog.count(*)
    INTO missing_private_count
    FROM public."SellerProfile" AS seller
    LEFT JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller_private."sellerProfileId" IS NULL;
  SELECT pg_catalog.count(*)
    INTO snapshot_mismatch_count
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."stripeAccountSupported" IS DISTINCT FROM (
     seller_private."stripeAccountVersion" IS NULL
     OR seller_private."stripeAccountVersion" = 'v2'
   );
  IF invalid_phone_count <> 0
     OR missing_private_count <> 0
     OR snapshot_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'SellerProfilePrivate FORCE data preflight failed: phone %, missing %, snapshot %',
      invalid_phone_count, missing_private_count, snapshot_mismatch_count;
  END IF;
END
$grainline_seller_profile_private_activation_preflight$;

ALTER TABLE public."SellerProfilePrivate" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."SellerProfilePrivate"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_seller_profile_private_activation_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
   WHERE class.oid =
         'public."SellerProfilePrivate"'::pg_catalog.regclass
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
      'SellerProfilePrivate FORCE did not establish exact policyless posture';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SellerProfile"'::pg_catalog.regclass
       AND NOT class.relrowsecurity
       AND NOT class.relforcerowsecurity
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = class.oid
       )
  ) THEN
    RAISE EXCEPTION
      'SellerProfilePrivate FORCE crossed the public SellerProfile boundary';
  END IF;
END
$grainline_seller_profile_private_activation_postflight$;

COMMIT;
