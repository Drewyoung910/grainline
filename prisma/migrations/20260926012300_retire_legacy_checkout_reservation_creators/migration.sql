-- End the predecessor checkout write window without disabling snapshot-bound
-- checkout. The new snapshot SECURITY DEFINER functions retain owner-internal
-- access to these helpers; ordinary runtime callers lose direct legacy entry.
-- Applying this migration begins the checkout-only drain before alias cutover.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order.checkout-source-cutover',
    0
  )
);

DO $grainline_legacy_checkout_creator_preflight$
DECLARE
  expected record;
  source_function pg_catalog.pg_proc%ROWTYPE;
  runtime_role oid := (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'
  );
BEGIN
  IF current_user = 'grainline_app_runtime'
     OR session_user = 'grainline_app_runtime'
     OR runtime_role IS NULL THEN
    RAISE EXCEPTION 'Legacy checkout retirement requires migration authority';
  END IF;

  FOR expected IN
    SELECT * FROM (VALUES
      ('public.grainline_checkout_reservation_create_cart(text,text,text,text,text)', false),
      ('public.grainline_checkout_reservation_create_single(text,text,integer,text)', false),
      ('public.grainline_checkout_reservation_create_cart_consistent(text,text,text,text,text,jsonb)', true),
      ('public.grainline_checkout_reservation_create_single_consistent(text,text,integer,text[],text,jsonb)', true),
      ('public.grainline_checkout_reservation_create_cart_snapshot(text,text,text,text,text,jsonb)', true),
      ('public.grainline_checkout_reservation_create_single_snapshot(text,text,integer,text[],text,jsonb)', true)
    ) AS required(signature, runtime_execute)
  LOOP
    SELECT * INTO source_function
      FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure(expected.signature);

    IF source_function.oid IS NULL
       OR source_function.proowner <> (
         SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user
       )
       OR source_function.prokind <> 'f'
       OR source_function.prosecdef IS DISTINCT FROM true
       OR source_function.proleakproof IS DISTINCT FROM false
       OR source_function.provolatile <> 'v'
       OR source_function.proparallel <> 'u'
       OR source_function.proconfig IS DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
       OR pg_catalog.has_function_privilege(
         'grainline_app_runtime', source_function.oid, 'EXECUTE'
       ) IS DISTINCT FROM expected.runtime_execute
       OR pg_catalog.has_function_privilege(
         'public', source_function.oid, 'EXECUTE'
       )
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(COALESCE(
             source_function.proacl,
             pg_catalog.acldefault('f', source_function.proowner)
           )) AS acl
          WHERE acl.privilege_type = 'EXECUTE'
            AND (
              acl.grantee NOT IN (source_function.proowner, runtime_role)
              OR (
                acl.grantee = runtime_role
                AND (
                  NOT expected.runtime_execute
                  OR acl.is_grantable
                )
              )
            )
       ) THEN
      RAISE EXCEPTION 'Legacy checkout retirement predecessor drifted: %',
        expected.signature;
    END IF;
  END LOOP;
END
$grainline_legacy_checkout_creator_preflight$;

REVOKE EXECUTE ON FUNCTION
  public.grainline_checkout_reservation_create_cart(text, text, text, text, text),
  public.grainline_checkout_reservation_create_single(text, text, integer, text),
  public.grainline_checkout_reservation_create_cart_consistent(
    text, text, text, text, text, jsonb
  ),
  public.grainline_checkout_reservation_create_single_consistent(
    text, text, integer, text[], text, jsonb
  )
FROM grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_checkout_reservation_create_cart(
  text, text, text, text, text
) IS 'Retired from runtime after Order snapshot checkout cutover; callable only inside reviewed owner functions.';
COMMENT ON FUNCTION public.grainline_checkout_reservation_create_single(
  text, text, integer, text
) IS 'Retired from runtime after Order snapshot checkout cutover; callable only inside reviewed owner functions.';
COMMENT ON FUNCTION public.grainline_checkout_reservation_create_cart_consistent(
  text, text, text, text, text, jsonb
) IS 'Retired from runtime after Order snapshot checkout cutover; retained as a private snapshot-function helper.';
COMMENT ON FUNCTION public.grainline_checkout_reservation_create_single_consistent(
  text, text, integer, text[], text, jsonb
) IS 'Retired from runtime after Order snapshot checkout cutover; retained as a private snapshot-function helper.';

DO $grainline_legacy_checkout_creator_postflight$
DECLARE
  expected record;
  source_function pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('public.grainline_checkout_reservation_create_cart(text,text,text,text,text)', false),
      ('public.grainline_checkout_reservation_create_single(text,text,integer,text)', false),
      ('public.grainline_checkout_reservation_create_cart_consistent(text,text,text,text,text,jsonb)', false),
      ('public.grainline_checkout_reservation_create_single_consistent(text,text,integer,text[],text,jsonb)', false),
      ('public.grainline_checkout_reservation_create_cart_snapshot(text,text,text,text,text,jsonb)', true),
      ('public.grainline_checkout_reservation_create_single_snapshot(text,text,integer,text[],text,jsonb)', true)
    ) AS required(signature, runtime_execute)
  LOOP
    SELECT * INTO source_function
      FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure(expected.signature);

    IF source_function.oid IS NULL
       OR pg_catalog.has_function_privilege(
         'grainline_app_runtime', source_function.oid, 'EXECUTE'
       ) IS DISTINCT FROM expected.runtime_execute
       OR pg_catalog.has_function_privilege(
         'public', source_function.oid, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Legacy checkout retirement postflight drifted: %',
        expected.signature;
    END IF;
  END LOOP;
END
$grainline_legacy_checkout_creator_postflight$;

COMMIT;
