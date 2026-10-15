-- Restore the two cross-boundary invariants intentionally carried by the
-- temporary SellerProfile mirror before private-column retirement. This is a
-- compatibility hardening release; it does not enable or force RLS.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.seller-profile-private.invariants',
    0
  )
);

LOCK TABLE public."SellerProfile", public."SellerProfilePrivate"
  IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_profile_private_invariants_preflight$
DECLARE
  migration_role record;
  invalid_phone_count bigint;
  missing_private_count bigint;
  snapshot_mismatch_count bigint;
BEGIN
  SELECT role.rolsuper, role.rolbypassrls
    INTO migration_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (migration_role.rolsuper OR migration_role.rolbypassrls) THEN
    RAISE EXCEPTION
      'SellerProfile private invariant repair requires the bypass-capable owner';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM public._prisma_migrations AS migration
     WHERE (
       migration.migration_name =
         '20261015010000_retire_seller_profile_private_predecessor'
       AND migration.checksum =
         'd111e615a40cd0c2936eeb137db23c5fbcc63c7acb81bce27a36d71229963b3a'
       OR migration.migration_name =
         '20261015013000_repair_account_deletion_after_seller_profile_retirement'
       AND migration.checksum =
         'c2884361016a554b28afebe58776938faf695c39c86fb22c9d40c87949e02368'
     )
       AND migration.finished_at IS NOT NULL
       AND migration.rolled_back_at IS NULL
       AND migration.applied_steps_count = 1
  ) <> 2 THEN
    RAISE EXCEPTION
      'SellerProfile private invariant repair prerequisites drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid IN (
       'public."SellerProfile"'::pg_catalog.regclass,
       'public."SellerProfilePrivate"'::pg_catalog.regclass
     )
       AND (class.relrowsecurity OR class.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION
      'SellerProfile private invariant repair requires the pre-RLS posture';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid IN (
       'public."SellerProfile"'::pg_catalog.regclass,
       'public."SellerProfilePrivate"'::pg_catalog.regclass
     )
  ) THEN
    RAISE EXCEPTION
      'SellerProfile private invariant repair found unexpected policies';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND constraint_row.conname =
           'SellerProfilePrivate_shipFromPhone_e164_check'
  )
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_profile_supported_snapshot_guard()'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_profile_private_supported_snapshot_sync()'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'SellerProfile private invariant repair target already exists';
  END IF;

  SELECT pg_catalog.count(*)
    INTO invalid_phone_count
    FROM public."SellerProfilePrivate" AS seller_private
   WHERE seller_private."shipFromPhone" IS NOT NULL
     AND seller_private."shipFromPhone" !~ '^[+][1-9][0-9]{7,14}$';
  IF invalid_phone_count <> 0 THEN
    RAISE EXCEPTION
      'SellerProfile private invariant repair found % invalid phone values',
      invalid_phone_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO missing_private_count
    FROM public."SellerProfile" AS seller
    LEFT JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller_private."sellerProfileId" IS NULL;
  IF missing_private_count <> 0 THEN
    RAISE EXCEPTION
      'SellerProfile private invariant repair found % missing private rows',
      missing_private_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO snapshot_mismatch_count
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."stripeAccountSupported" IS DISTINCT FROM (
     seller_private."stripeAccountVersion" IS NULL
     OR seller_private."stripeAccountVersion" = 'v2'
   );
  IF snapshot_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'SellerProfile private invariant repair found % supported-snapshot mismatches',
      snapshot_mismatch_count;
  END IF;
END
$grainline_seller_profile_private_invariants_preflight$;

ALTER TABLE public."SellerProfilePrivate"
  ADD CONSTRAINT "SellerProfilePrivate_shipFromPhone_e164_check"
  CHECK (
    "shipFromPhone" IS NULL
    OR "shipFromPhone" ~ '^[+][1-9][0-9]{7,14}$'
  );

CREATE FUNCTION public.grainline_seller_profile_supported_snapshot_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_profile_supported_snapshot_guard$
DECLARE
  private_version text;
BEGIN
  SELECT seller_private."stripeAccountVersion"
    INTO private_version
    FROM public."SellerProfilePrivate" AS seller_private
   WHERE seller_private."sellerProfileId" = NEW.id;

  IF FOUND THEN
    NEW."stripeAccountSupported" := (
      private_version IS NULL OR private_version = 'v2'
    );
  ELSIF TG_OP = 'INSERT' THEN
    -- The AFTER INSERT initializer creates the companion row. Its own sync
    -- trigger immediately reasserts this snapshot from the private source.
    NEW."stripeAccountSupported" := true;
  ELSE
    RAISE EXCEPTION 'SellerProfile private row is missing during public snapshot update'
      USING ERRCODE = '40001';
  END IF;

  RETURN NEW;
END
$grainline_seller_profile_supported_snapshot_guard$;

CREATE TRIGGER "SellerProfile_supported_snapshot_guard"
BEFORE INSERT OR UPDATE OF "stripeAccountSupported"
ON public."SellerProfile"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_seller_profile_supported_snapshot_guard();

CREATE FUNCTION public.grainline_seller_profile_private_supported_snapshot_sync()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_profile_private_supported_snapshot_sync$
BEGIN
  UPDATE public."SellerProfile" AS seller
     SET "stripeAccountSupported" = (
           NEW."stripeAccountVersion" IS NULL
           OR NEW."stripeAccountVersion" = 'v2'
         ),
         "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
   WHERE seller.id = NEW."sellerProfileId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SellerProfile public row is missing during private snapshot sync'
      USING ERRCODE = '40001';
  END IF;

  RETURN NEW;
END
$grainline_seller_profile_private_supported_snapshot_sync$;

CREATE TRIGGER "SellerProfilePrivate_supported_snapshot_sync"
AFTER INSERT OR UPDATE OF "stripeAccountVersion"
ON public."SellerProfilePrivate"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_seller_profile_private_supported_snapshot_sync();

REVOKE ALL ON FUNCTION
  public.grainline_seller_profile_supported_snapshot_guard()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_seller_profile_private_supported_snapshot_sync()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DO $grainline_seller_profile_private_invariants_postflight$
DECLARE
  accepted_constraint_count integer;
  accepted_function_count integer;
  accepted_trigger_count integer;
  snapshot_mismatch_count bigint;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public."SellerProfilePrivate"'::pg_catalog.regclass
     AND constraint_row.conname =
         'SellerProfilePrivate_shipFromPhone_e164_check'
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;
  IF accepted_constraint_count <> 1 THEN
    RAISE EXCEPTION 'SellerProfile private phone constraint postflight failed';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.oid = procedure.proowner
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_seller_profile_supported_snapshot_guard',
       'grainline_seller_profile_private_supported_snapshot_sync'
     )
     AND procedure.pronargs = 0
     AND procedure.prokind = 'f'
     AND procedure.prolang = (
       SELECT language.oid
         FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'plpgsql'
     )
     AND owner_role.rolname = current_user
     AND procedure.prosecdef
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND NOT procedure.proleakproof
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE');
  IF accepted_function_count <> 2 THEN
    RAISE EXCEPTION
      'SellerProfile private invariant function postflight failed: %',
      accepted_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_row
   WHERE trigger_row.tgrelid IN (
       'public."SellerProfile"'::pg_catalog.regclass,
       'public."SellerProfilePrivate"'::pg_catalog.regclass
     )
     AND trigger_row.tgname IN (
       'SellerProfile_supported_snapshot_guard',
       'SellerProfilePrivate_supported_snapshot_sync'
     )
     AND NOT trigger_row.tgisinternal
     AND trigger_row.tgenabled = 'O';
  IF accepted_trigger_count <> 2 THEN
    RAISE EXCEPTION
      'SellerProfile private invariant trigger postflight failed: %',
      accepted_trigger_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO snapshot_mismatch_count
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."stripeAccountSupported" IS DISTINCT FROM (
     seller_private."stripeAccountVersion" IS NULL
     OR seller_private."stripeAccountVersion" = 'v2'
   );
  IF snapshot_mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'SellerProfile private invariant postflight found % snapshot mismatches',
      snapshot_mismatch_count;
  END IF;
END
$grainline_seller_profile_private_invariants_postflight$;

COMMIT;
