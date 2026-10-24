-- Reviewed emergency rollback for 20261023080000_activate_cart_cart_item_rls.
-- It removes FORCE only. ENABLE, policies, narrow grants, constraints and
-- service functions remain in place so the runtime boundary does not widen.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE public."Cart", public."CartItem" IN ACCESS EXCLUSIVE MODE;

DO $grainline_cart_rollback_preflight$
DECLARE
  runtime_oid oid;
  owner_oid oid;
  expected_policies text[] := ARRAY[
    'cart_item_owner_delete','cart_item_owner_insert','cart_item_owner_select',
    'cart_item_owner_update','cart_owner_delete','cart_owner_insert',
    'cart_owner_select','cart_owner_update'
  ];
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT relowner INTO owner_oid
    FROM pg_catalog.pg_class
   WHERE oid = 'public."Cart"'::regclass;
  IF runtime_oid IS NULL OR owner_oid IS NULL
     OR owner_oid IS DISTINCT FROM (
       SELECT relowner FROM pg_catalog.pg_class
        WHERE oid = 'public."CartItem"'::regclass
     ) THEN
    RAISE EXCEPTION 'Cart rollback identity drifted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE oid = owner_oid AND (rolsuper OR rolbypassrls)
  ) OR owner_oid IS DISTINCT FROM (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user
  ) THEN
    RAISE EXCEPTION 'Cart rollback must run as the bypass-capable table owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid IN ('public."Cart"'::regclass, 'public."CartItem"'::regclass)
       AND (NOT relrowsecurity OR NOT relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Cart rollback requires ENABLE plus FORCE';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(policy.polname::text ORDER BY policy.polname)
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid IN (
       'public."Cart"'::regclass,
       'public."CartItem"'::regclass
     )
  ) IS DISTINCT FROM expected_policies
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid IN (
          'public."Cart"'::regclass,
          'public."CartItem"'::regclass
        )
          AND (NOT policy.polpermissive
               OR policy.polroles IS DISTINCT FROM ARRAY[runtime_oid]::oid[])
     ) THEN
    RAISE EXCEPTION 'Cart rollback policy posture drifted';
  END IF;
  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Cart"', 'SELECT,INSERT,DELETE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Cart"', 'UPDATE'
     ) OR NOT pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."Cart"', 'updatedAt', 'UPDATE'
     ) OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'SELECT,INSERT,DELETE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'UPDATE'
     ) OR NOT pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'quantity', 'UPDATE'
     ) OR NOT pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'priceCents', 'UPDATE'
     ) OR NOT pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'priceVersion', 'UPDATE'
     ) OR NOT pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'selectedVariantOptionIds', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'Cart rollback grants drifted';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = 'public'
       AND routine.proname = ANY(ARRAY[
         'grainline_cart_item_admin_listing_cleanup',
         'grainline_cart_item_seller_listing_cleanup'
       ]::text[])
       AND (routine.proowner IS DISTINCT FROM owner_oid
            OR NOT routine.prosecdef
            OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
            OR NOT pg_catalog.has_function_privilege(
              'grainline_app_runtime', routine.oid, 'EXECUTE'
            )
            OR pg_catalog.has_function_privilege(0, routine.oid, 'EXECUTE'))
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = 'public'
       AND routine.proname = ANY(ARRAY[
         'grainline_cart_item_admin_listing_cleanup',
         'grainline_cart_item_seller_listing_cleanup'
       ]::text[])
  ) <> 2 THEN
    RAISE EXCEPTION 'Cart rollback service-function posture drifted';
  END IF;
END
$grainline_cart_rollback_preflight$;

ALTER TABLE public."Cart" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CartItem" NO FORCE ROW LEVEL SECURITY;

DO $grainline_cart_rollback_postflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid IN ('public."Cart"'::regclass, 'public."CartItem"'::regclass)
       AND (NOT relrowsecurity OR relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Cart rollback did not converge to ENABLE without FORCE';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_policy
     WHERE polrelid IN ('public."Cart"'::regclass, 'public."CartItem"'::regclass)
  ) <> 8 THEN
    RAISE EXCEPTION 'Cart rollback changed policies';
  END IF;
END
$grainline_cart_rollback_postflight$;

COMMIT;
