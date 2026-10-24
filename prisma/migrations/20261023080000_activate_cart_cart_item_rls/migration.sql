BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE public."Cart", public."CartItem" IN ACCESS EXCLUSIVE MODE;

DO $grainline_cart_rls_preflight$
DECLARE
  runtime_oid oid;
  cart_oid oid;
  item_oid oid;
  table_owner oid;
  item_owner oid;
  current_role_oid oid;
  owner_super boolean;
  owner_bypass boolean;
  expected_functions regprocedure[];
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  IF runtime_oid IS NULL THEN
    RAISE EXCEPTION 'grainline_app_runtime is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE oid = runtime_oid
       AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
            OR rolreplication OR rolbypassrls)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = runtime_oid
  ) THEN
    RAISE EXCEPTION 'grainline_app_runtime posture is unsafe';
  END IF;

  SELECT class.oid, class.relowner
    INTO cart_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Cart'
     AND class.relkind = 'r';
  SELECT class.oid, class.relowner
    INTO item_oid, item_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CartItem'
     AND class.relkind = 'r';
  IF cart_oid IS NULL OR item_oid IS NULL THEN
    RAISE EXCEPTION 'Cart or CartItem is missing';
  END IF;
  IF item_owner IS DISTINCT FROM table_owner THEN
    RAISE EXCEPTION 'Cart and CartItem owners differ';
  END IF;
  SELECT oid INTO current_role_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = current_user;
  IF table_owner IS DISTINCT FROM current_role_oid
     OR table_owner = runtime_oid THEN
    RAISE EXCEPTION 'Cart activation must run as the non-runtime table owner';
  END IF;
  SELECT rolsuper, rolbypassrls
    INTO owner_super, owner_bypass
    FROM pg_catalog.pg_roles
   WHERE oid = table_owner;
  IF NOT COALESCE(owner_super, false) AND NOT COALESCE(owner_bypass, false) THEN
    RAISE EXCEPTION 'Cart owner must be SUPERUSER or BYPASSRLS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid IN (cart_oid, item_oid)
       AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
     WHERE polrelid IN (cart_oid, item_oid)
  ) THEN
    RAISE EXCEPTION 'Cart tables must begin without RLS or policies';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
     WHERE tgrelid IN (cart_oid, item_oid)
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Cart tables have unreviewed triggers';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY attribute.attnum)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = cart_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) IS DISTINCT FROM ARRAY['id','userId','createdAt','updatedAt']::text[]
     OR (
    SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY attribute.attnum)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = item_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) IS DISTINCT FROM ARRAY[
    'id','cartId','listingId','quantity','priceCents','createdAt',
    'selectedVariantOptionIds','variantKey','priceVersion'
  ]::text[] THEN
    RAISE EXCEPTION 'Cart table columns drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Cart" AS cart
      LEFT JOIN public."User" AS account ON account.id = cart."userId"
     WHERE account.id IS NULL
  ) OR EXISTS (
    SELECT 1
      FROM public."CartItem" AS item
      LEFT JOIN public."Cart" AS cart ON cart.id = item."cartId"
      LEFT JOIN public."Listing" AS listing ON listing.id = item."listingId"
     WHERE cart.id IS NULL OR listing.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cart tables contain orphaned rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."CartItem" AS item
     WHERE item.quantity < 1 OR item.quantity > 99
        OR item."priceCents" < 1 OR item."priceCents" > 10000000
        OR item."priceVersion" < 1
        OR pg_catalog.cardinality(item."selectedVariantOptionIds") > 30
        OR pg_catalog.array_position(item."selectedVariantOptionIds", NULL) IS NOT NULL
        OR pg_catalog.char_length(item."variantKey") > 255
  ) THEN
    RAISE EXCEPTION 'CartItem contains rows outside reviewed bounds';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Cart"', 'SELECT,INSERT,UPDATE,DELETE'
     ) OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'Cart runtime predecessor grants drifted';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
      ) AS acl
     WHERE class.oid IN (cart_oid, item_oid)
       AND acl.grantee NOT IN (table_owner, runtime_oid)
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
     WHERE attribute.attrelid IN (cart_oid, item_oid)
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Cart predecessor ACLs drifted';
  END IF;

  expected_functions := ARRAY[
    'public.grainline_checkout_reservation_create_cart(text,text,text,text,text)'::regprocedure,
    'public.grainline_checkout_reservation_create_cart_consistent(text,text,text,text,text,jsonb)'::regprocedure,
    'public.grainline_order_seller_analytics_summary(text,bigint,bigint,boolean)'::regprocedure,
    'public.grainline_seller_actor_cart_transaction_states(text)'::regprocedure,
    'public.grainline_seller_checkout_private_state(text,text,text,text)'::regprocedure,
    'public.grainline_seller_shipping_quote_state(text,text,text,text)'::regprocedure,
    'public.grainline_stripe_checkout_order_create(text,bigint,text,text,timestamp without time zone,jsonb)'::regprocedure
  ];
  IF (
    SELECT pg_catalog.array_agg(routine.oid::regprocedure ORDER BY routine.oid::regprocedure::text)
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
     WHERE namespace.nspname = 'public'
       AND (routine.prosrc LIKE '%public."Cart"%'
            OR routine.prosrc LIKE '%public."CartItem"%')
  ) IS DISTINCT FROM (
    SELECT pg_catalog.array_agg(value ORDER BY value::text)
      FROM pg_catalog.unnest(expected_functions) AS value
  ) THEN
    RAISE EXCEPTION 'Cart function inventory drifted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = ANY(expected_functions)
       AND (routine.proowner IS DISTINCT FROM table_owner
            OR NOT routine.prosecdef
            OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[])
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) AS acl
     WHERE routine.oid = ANY(expected_functions)
       AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'Cart function owner/security posture drifted';
  END IF;
END
$grainline_cart_rls_preflight$;

ALTER TABLE public."CartItem"
  ADD CONSTRAINT "CartItem_quantity_bounds_check"
    CHECK (quantity BETWEEN 1 AND 99) NOT VALID,
  ADD CONSTRAINT "CartItem_priceCents_bounds_check"
    CHECK ("priceCents" BETWEEN 1 AND 10000000) NOT VALID,
  ADD CONSTRAINT "CartItem_priceVersion_positive_check"
    CHECK ("priceVersion" >= 1) NOT VALID,
  ADD CONSTRAINT "CartItem_selectedVariantOptionIds_bounds_check"
    CHECK (
      pg_catalog.cardinality("selectedVariantOptionIds") <= 30
      AND pg_catalog.array_position("selectedVariantOptionIds", NULL) IS NULL
    ) NOT VALID;

ALTER TABLE public."CartItem"
  VALIDATE CONSTRAINT "CartItem_quantity_bounds_check";
ALTER TABLE public."CartItem"
  VALIDATE CONSTRAINT "CartItem_priceCents_bounds_check";
ALTER TABLE public."CartItem"
  VALIDATE CONSTRAINT "CartItem_priceVersion_positive_check";
ALTER TABLE public."CartItem"
  VALIDATE CONSTRAINT "CartItem_selectedVariantOptionIds_bounds_check";

CREATE FUNCTION public.grainline_cart_item_admin_listing_cleanup(
  p_listing_id text
)
RETURNS TABLE(deleted_count integer)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_cart_item_admin_listing_cleanup$
DECLARE
  actor_id text;
  removed integer;
BEGIN
  actor_id := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Cart admin listing cleanup input is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."User" AS account
     WHERE account.id = actor_id
       AND account.role = 'ADMIN'
       AND NOT account.banned
       AND account."deletedAt" IS NULL
     FOR SHARE
  ) THEN
    RAISE EXCEPTION 'Cart admin listing cleanup actor is unauthorized'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."Listing" AS listing
     WHERE listing.id = p_listing_id
     FOR SHARE
  ) THEN
    RAISE EXCEPTION 'Cart admin listing cleanup target is missing'
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public."CartItem" AS item
   WHERE item."listingId" = p_listing_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN QUERY SELECT removed;
END
$grainline_cart_item_admin_listing_cleanup$;

CREATE FUNCTION public.grainline_cart_item_seller_listing_cleanup(
  p_listing_id text
)
RETURNS TABLE(deleted_count integer)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_cart_item_seller_listing_cleanup$
DECLARE
  actor_id text;
  removed integer;
BEGIN
  actor_id := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Cart seller listing cleanup input is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
      JOIN public."User" AS account
        ON account.id = seller."userId"
     WHERE listing.id = p_listing_id
       AND seller."userId" = actor_id
       AND NOT account.banned
       AND account."deletedAt" IS NULL
     FOR SHARE OF listing, seller, account
  ) THEN
    RAISE EXCEPTION 'Cart seller listing cleanup actor is unauthorized'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."CartItem" AS item
   WHERE item."listingId" = p_listing_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN QUERY SELECT removed;
END
$grainline_cart_item_seller_listing_cleanup$;

REVOKE ALL ON FUNCTION public.grainline_cart_item_admin_listing_cleanup(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_cart_item_seller_listing_cleanup(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grainline_cart_item_admin_listing_cleanup(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_cart_item_seller_listing_cleanup(text)
  TO grainline_app_runtime;

CREATE POLICY cart_owner_select ON public."Cart"
  AS PERMISSIVE FOR SELECT TO grainline_app_runtime
  USING ("userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), ''));
CREATE POLICY cart_owner_insert ON public."Cart"
  AS PERMISSIVE FOR INSERT TO grainline_app_runtime
  WITH CHECK ("userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), ''));
CREATE POLICY cart_owner_update ON public."Cart"
  AS PERMISSIVE FOR UPDATE TO grainline_app_runtime
  USING ("userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), ''))
  WITH CHECK ("userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), ''));
CREATE POLICY cart_owner_delete ON public."Cart"
  AS PERMISSIVE FOR DELETE TO grainline_app_runtime
  USING ("userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), ''));

CREATE POLICY cart_item_owner_select ON public."CartItem"
  AS PERMISSIVE FOR SELECT TO grainline_app_runtime
  USING (EXISTS (
    SELECT 1 FROM public."Cart" AS cart
     WHERE cart.id = "CartItem"."cartId"
       AND cart."userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  ));
CREATE POLICY cart_item_owner_insert ON public."CartItem"
  AS PERMISSIVE FOR INSERT TO grainline_app_runtime
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Cart" AS cart
     WHERE cart.id = "CartItem"."cartId"
       AND cart."userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  ));
CREATE POLICY cart_item_owner_update ON public."CartItem"
  AS PERMISSIVE FOR UPDATE TO grainline_app_runtime
  USING (EXISTS (
    SELECT 1 FROM public."Cart" AS cart
     WHERE cart.id = "CartItem"."cartId"
       AND cart."userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Cart" AS cart
     WHERE cart.id = "CartItem"."cartId"
       AND cart."userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  ));
CREATE POLICY cart_item_owner_delete ON public."CartItem"
  AS PERMISSIVE FOR DELETE TO grainline_app_runtime
  USING (EXISTS (
    SELECT 1 FROM public."Cart" AS cart
     WHERE cart.id = "CartItem"."cartId"
       AND cart."userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  ));

REVOKE ALL ON TABLE public."Cart", public."CartItem"
  FROM PUBLIC, grainline_app_runtime;
GRANT SELECT, INSERT, DELETE ON TABLE public."Cart"
  TO grainline_app_runtime;
GRANT UPDATE ("updatedAt") ON TABLE public."Cart"
  TO grainline_app_runtime;
GRANT SELECT, INSERT, DELETE ON TABLE public."CartItem"
  TO grainline_app_runtime;
GRANT UPDATE (quantity, "priceCents", "priceVersion", "selectedVariantOptionIds")
  ON TABLE public."CartItem" TO grainline_app_runtime;

ALTER TABLE public."Cart" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Cart" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."CartItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CartItem" FORCE ROW LEVEL SECURITY;

DO $grainline_cart_rls_postflight$
DECLARE
  runtime_oid oid;
  cart_oid oid := 'public."Cart"'::regclass;
  item_oid oid := 'public."CartItem"'::regclass;
  table_owner oid;
  expected_policy_names text[] := ARRAY[
    'cart_item_owner_delete','cart_item_owner_insert','cart_item_owner_select',
    'cart_item_owner_update','cart_owner_delete','cart_owner_insert',
    'cart_owner_select','cart_owner_update'
  ];
  function_oid oid;
BEGIN
  SELECT oid INTO runtime_oid FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT relowner INTO table_owner FROM pg_catalog.pg_class WHERE oid = cart_oid;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid IN (cart_oid, item_oid)
       AND (NOT relrowsecurity OR NOT relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Cart ENABLE/FORCE did not persist';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(polname::text ORDER BY polname)
      FROM pg_catalog.pg_policy
     WHERE polrelid IN (cart_oid, item_oid)
  ) IS DISTINCT FROM expected_policy_names THEN
    RAISE EXCEPTION 'Cart policy names drifted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
     WHERE polrelid IN (cart_oid, item_oid)
       AND (NOT polpermissive OR polroles IS DISTINCT FROM ARRAY[runtime_oid]::oid[])
  ) THEN
    RAISE EXCEPTION 'Cart policy posture drifted';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Cart"', 'SELECT,INSERT,DELETE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Cart"', 'UPDATE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Cart"', 'TRUNCATE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Cart"', 'REFERENCES'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Cart"', 'TRIGGER'
     ) OR NOT pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."Cart"', 'updatedAt', 'UPDATE'
     ) OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = cart_oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND attribute.attname <> 'updatedAt'
          AND pg_catalog.has_column_privilege(
            'grainline_app_runtime', cart_oid, attribute.attnum, 'UPDATE'
          )
     ) THEN
    RAISE EXCEPTION 'Cart runtime grants drifted';
  END IF;
  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'SELECT,INSERT,DELETE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'UPDATE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'TRUNCATE'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'REFERENCES'
     ) OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."CartItem"', 'TRIGGER'
     ) OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = item_oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND (
            (attribute.attname = ANY(ARRAY[
              'quantity','priceCents','priceVersion','selectedVariantOptionIds'
            ]) AND NOT pg_catalog.has_column_privilege(
              'grainline_app_runtime', item_oid, attribute.attnum, 'UPDATE'
            ))
            OR
            (attribute.attname <> ALL(ARRAY[
              'quantity','priceCents','priceVersion','selectedVariantOptionIds'
            ]) AND pg_catalog.has_column_privilege(
              'grainline_app_runtime', item_oid, attribute.attnum, 'UPDATE'
            ))
          )
     ) THEN
    RAISE EXCEPTION 'CartItem runtime grants drifted';
  END IF;

  FOREACH function_oid IN ARRAY ARRAY[
    'public.grainline_cart_item_admin_listing_cleanup(text)'::regprocedure::oid,
    'public.grainline_cart_item_seller_listing_cleanup(text)'::regprocedure::oid
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS routine
       WHERE routine.oid = function_oid
         AND routine.proowner = table_owner
         AND routine.prosecdef
         AND routine.provolatile = 'v'
         AND routine.proparallel = 'u'
         AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
    ) OR NOT pg_catalog.has_function_privilege(
      'grainline_app_runtime', function_oid, 'EXECUTE'
    ) OR pg_catalog.has_function_privilege('public', function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Cart cleanup function posture drifted';
    END IF;
  END LOOP;
END
$grainline_cart_rls_postflight$;

COMMIT;
