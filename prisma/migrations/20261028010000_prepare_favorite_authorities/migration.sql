BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- Compatible preparation only. Favorite RLS and predecessor table grants stay
-- unchanged until every caller and the full-chain race/rollback proof have
-- passed review.
DO $grainline_favorite_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'public."Listing"'::pg_catalog.regclass
       AND attribute.attname = 'favoriteCount'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Listing.favoriteCount already exists';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid IN (
       pg_catalog.to_regprocedure('public.grainline_favorite_owner_add(text)'),
       pg_catalog.to_regprocedure('public.grainline_favorite_owner_remove(text)'),
       pg_catalog.to_regprocedure('public.grainline_favorite_owner_delete_all(text)'),
       pg_catalog.to_regprocedure('public.grainline_favorite_owner_listing_ids(text[])'),
       pg_catalog.to_regprocedure('public.grainline_favorite_owner_export()'),
       pg_catalog.to_regprocedure('public.grainline_favorite_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)'),
       pg_catalog.to_regprocedure('public.grainline_favorite_seller_listing_cleanup(text)'),
       pg_catalog.to_regprocedure('public.grainline_favorite_admin_listing_cleanup(text)'),
       pg_catalog.to_regprocedure('public.grainline_favorite_count_maintain()'),
       pg_catalog.to_regprocedure('public.grainline_favorite_update_forbidden()'),
       pg_catalog.to_regprocedure('public.grainline_listing_favorite_count_guard()')
     )
  ) THEN
    RAISE EXCEPTION 'Favorite preparation function already exists';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."Favorite"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Favorite RLS must remain off during compatible preparation';
  END IF;
END;
$grainline_favorite_preflight$;

ALTER TABLE public."Listing"
  ADD COLUMN "favoriteCount" integer NOT NULL DEFAULT 0;

ALTER TABLE public."Listing"
  ADD CONSTRAINT "Listing_favoriteCount_nonnegative_chk"
  CHECK ("favoriteCount" >= 0) NOT VALID;

-- Lock in the predecessor listing-delete order before Favorite. The deployed
-- predecessor favorite insert never touches Listing, while listing deletion
-- locks Listing before its Favorite cascade. Holding both closes the
-- insert/delete window through the exact backfill and trigger installation.
LOCK TABLE public."Listing" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public."Favorite" IN SHARE ROW EXCLUSIVE MODE;

UPDATE public."Listing" AS listing
   SET "favoriteCount" = counts.value
  FROM (
    SELECT favorite."listingId", pg_catalog.count(*)::integer AS value
      FROM public."Favorite" AS favorite
     GROUP BY favorite."listingId"
  ) AS counts
 WHERE listing.id = counts."listingId";

CREATE INDEX "Listing_favoriteCount_createdAt_id_idx"
  ON public."Listing" ("favoriteCount" DESC, "createdAt" DESC, id DESC);

CREATE FUNCTION public.grainline_favorite_count_maintain()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_favorite_count_maintain$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public."Listing"
       SET "favoriteCount" = "favoriteCount" + 1
     WHERE id = NEW."listingId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Favorite target listing is unavailable'
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public."Listing"
       SET "favoriteCount" = "favoriteCount" - 1
     WHERE id = OLD."listingId"
       AND "favoriteCount" > 0;
    -- A Listing cascade can remove the parent before this AFTER DELETE fires.
    -- Otherwise a missing/non-positive projection is drift and must fail.
    IF NOT FOUND AND EXISTS (
      SELECT 1 FROM public."Listing" WHERE id = OLD."listingId"
    ) THEN
      RAISE EXCEPTION 'Favorite count projection would become invalid'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Favorite count trigger received unsupported operation'
    USING ERRCODE = '0A000';
END;
$grainline_favorite_count_maintain$;

-- Listing remains directly writable during this compatible preparation. Keep
-- its public aggregate database-managed even before Favorite activation. The
-- guard must be SECURITY INVOKER: direct runtime writes execute as the runtime
-- role and fail, while the nested UPDATE issued by the owner-held Favorite
-- maintenance trigger executes as its BYPASSRLS definer and succeeds.
CREATE FUNCTION public.grainline_listing_favorite_count_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_listing_favorite_count_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles AS role_state
     WHERE role_state.rolname = CURRENT_USER
       AND (role_state.rolsuper OR role_state.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Listing favorite-count projection is database-managed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$grainline_listing_favorite_count_guard$;

CREATE TRIGGER "Listing_favoriteCount_guard"
BEFORE UPDATE OF "favoriteCount" ON public."Listing"
FOR EACH ROW EXECUTE FUNCTION public.grainline_listing_favorite_count_guard();

CREATE TRIGGER "Favorite_count_after_insert"
AFTER INSERT ON public."Favorite"
FOR EACH ROW EXECUTE FUNCTION public.grainline_favorite_count_maintain();

CREATE TRIGGER "Favorite_count_after_delete"
AFTER DELETE ON public."Favorite"
FOR EACH ROW EXECUTE FUNCTION public.grainline_favorite_count_maintain();

CREATE FUNCTION public.grainline_favorite_update_forbidden()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_favorite_update_forbidden$
BEGIN
  RAISE EXCEPTION 'Favorite rows are immutable; remove and save again instead'
    USING ERRCODE = '42501';
END;
$grainline_favorite_update_forbidden$;

CREATE TRIGGER "Favorite_update_forbidden"
BEFORE UPDATE ON public."Favorite"
FOR EACH ROW EXECUTE FUNCTION public.grainline_favorite_update_forbidden();

CREATE FUNCTION public.grainline_favorite_owner_listing_ids(
  p_listing_ids text[]
)
RETURNS TABLE ("listingId" text)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_favorite_owner_listing_ids$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_ids IS NULL
     OR pg_catalog.cardinality(p_listing_ids) < 1
     OR pg_catalog.cardinality(p_listing_ids) > 100
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_listing_ids) AS candidate(id)
        WHERE candidate.id IS NULL
           OR candidate.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'Favorite owner listing-id input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Favorite owner context is inactive'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT favorite."listingId"::text
    FROM public."Favorite" AS favorite
   WHERE favorite."userId" = request_user_id
     AND favorite."listingId" = ANY (p_listing_ids)
   ORDER BY favorite."listingId";
END;
$grainline_favorite_owner_listing_ids$;

CREATE FUNCTION public.grainline_favorite_owner_add(
  p_listing_id text
)
RETURNS TABLE (
  "resultStatus" text,
  title text,
  "ownerUserId" text,
  created boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_favorite_owner_add$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  target_user_id text;
  locked_target_user_id text;
  target_title text;
  locked_user_count integer := 0;
  inserted_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Favorite owner context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Favorite listing id is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Favorite add requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Favorite owner context is inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller."userId"
    INTO target_user_id
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
     AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
     AND listing."isPrivate" = false
     AND listing."archivedAt" IS NULL
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false;

  IF target_user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::text, false;
    RETURN;
  END IF;
  IF target_user_id = request_user_id THEN
    RETURN QUERY SELECT 'SELF'::text, NULL::text, NULL::text, false;
    RETURN;
  END IF;
  locked_target_user_id := target_user_id;

  SELECT pg_catalog.count(*)::integer
    INTO locked_user_count
    FROM public.grainline_user_block_pair_lock(target_user_id) AS locked_user
   WHERE locked_user."deletedAt" IS NULL;
  IF locked_user_count <> 2 THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::text, false;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Favorite owner context became inactive'
      USING ERRCODE = '42501';
  END IF;

  target_user_id := NULL;
  SELECT seller."userId", listing.title
    INTO target_user_id, target_title
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
     AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
     AND listing."isPrivate" = false
     AND listing."archivedAt" IS NULL
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
   FOR SHARE OF listing, seller;

  IF target_user_id IS NULL OR target_user_id <> locked_target_user_id THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::text, false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Block" AS relationship
     WHERE (relationship."blockerId" = request_user_id
            AND relationship."blockedId" = target_user_id)
        OR (relationship."blockerId" = target_user_id
            AND relationship."blockedId" = request_user_id)
  ) THEN
    RETURN QUERY SELECT 'BLOCKED'::text, NULL::text, NULL::text, false;
    RETURN;
  END IF;

  INSERT INTO public."Favorite" ("userId", "listingId", "createdAt")
  VALUES (
    request_user_id,
    p_listing_id,
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  )
  ON CONFLICT ("userId", "listingId") DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  RETURN QUERY
  SELECT 'OK'::text,
         target_title,
         target_user_id,
         inserted_count = 1;
END;
$grainline_favorite_owner_add$;

CREATE FUNCTION public.grainline_favorite_owner_remove(
  p_listing_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_favorite_owner_remove$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  deleted_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Favorite owner context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Favorite listing id is invalid'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public."Favorite"
   WHERE "userId" = request_user_id
     AND "listingId" = p_listing_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_favorite_owner_remove$;

CREATE FUNCTION public.grainline_favorite_owner_delete_all(
  p_owner_user_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_favorite_owner_delete_all$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  deleted_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_owner_user_id IS NULL
     OR p_owner_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR request_user_id <> p_owner_user_id THEN
    RAISE EXCEPTION 'Favorite owner delete-all context is invalid'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."Favorite" WHERE "userId" = request_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_favorite_owner_delete_all$;

CREATE FUNCTION public.grainline_favorite_owner_export()
RETURNS TABLE (
  "listingId" text,
  "createdAt" timestamp without time zone,
  title text,
  status text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_favorite_owner_export$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Favorite owner export context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT favorite."listingId"::text,
         favorite."createdAt"::timestamp without time zone,
         listing.title::text,
         listing.status::text
    FROM public."Favorite" AS favorite
    JOIN public."Listing" AS listing
      ON listing.id = favorite."listingId"
   WHERE favorite."userId" = request_user_id
   ORDER BY favorite."createdAt" DESC, favorite."listingId" DESC;
END;
$grainline_favorite_owner_export$;

CREATE FUNCTION public.grainline_favorite_seller_range_count(
  p_start_at timestamp without time zone,
  p_end_at timestamp without time zone,
  p_end_exclusive boolean
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_favorite_seller_range_count$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  result_count bigint := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_start_at IS NULL
     OR p_end_at IS NULL
     OR p_end_at < p_start_at
     OR p_end_exclusive IS NULL THEN
    RAISE EXCEPTION 'Favorite seller range input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Favorite seller context is inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*)::bigint
    INTO result_count
    FROM public."Favorite" AS favorite
    JOIN public."Listing" AS listing
      ON listing.id = favorite."listingId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE seller."userId" = request_user_id
     AND favorite."createdAt" >= p_start_at
     AND CASE WHEN p_end_exclusive
              THEN favorite."createdAt" < p_end_at
              ELSE favorite."createdAt" <= p_end_at
         END;

  RETURN result_count;
END;
$grainline_favorite_seller_range_count$;

CREATE FUNCTION public.grainline_favorite_seller_listing_cleanup(
  p_listing_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_favorite_seller_listing_cleanup$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  deleted_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Favorite seller cleanup input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
     WHERE listing.id = p_listing_id
       AND seller."userId" = request_user_id
  ) THEN
    RAISE EXCEPTION 'Favorite seller cleanup is forbidden'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."Favorite" WHERE "listingId" = p_listing_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_favorite_seller_listing_cleanup$;

CREATE FUNCTION public.grainline_favorite_admin_listing_cleanup(
  p_listing_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_favorite_admin_listing_cleanup$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  deleted_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Favorite admin cleanup input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.role::text = 'ADMIN'
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Favorite admin cleanup is forbidden'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."Favorite" WHERE "listingId" = p_listing_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_favorite_admin_listing_cleanup$;

REVOKE ALL ON FUNCTION public.grainline_favorite_count_maintain()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_favorite_update_forbidden()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_listing_favorite_count_guard()
  FROM PUBLIC, grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_favorite_owner_listing_ids(text[])
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_favorite_owner_add(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_favorite_owner_remove(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_favorite_owner_delete_all(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_favorite_owner_export()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_favorite_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_favorite_seller_listing_cleanup(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_favorite_admin_listing_cleanup(text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_favorite_owner_listing_ids(text[])
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_favorite_owner_add(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_favorite_owner_remove(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_favorite_owner_delete_all(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_favorite_owner_export()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_favorite_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_favorite_seller_listing_cleanup(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_favorite_admin_listing_cleanup(text)
  TO grainline_app_runtime;

ALTER TABLE public."Listing"
  VALIDATE CONSTRAINT "Listing_favoriteCount_nonnegative_chk";

DO $grainline_favorite_postflight$
DECLARE
  drift_count bigint;
  missing_functions text[];
BEGIN
  SELECT pg_catalog.count(*)::bigint
    INTO drift_count
    FROM public."Listing" AS listing
    LEFT JOIN LATERAL (
      SELECT pg_catalog.count(*)::integer AS value
        FROM public."Favorite" AS favorite
       WHERE favorite."listingId" = listing.id
    ) AS actual ON true
   WHERE listing."favoriteCount" <> actual.value;
  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'Favorite count projection drifted for % listings', drift_count;
  END IF;

  SELECT pg_catalog.array_agg(expected.signature ORDER BY expected.signature)
    INTO missing_functions
    FROM (
      VALUES
        ('public.grainline_favorite_owner_listing_ids(text[])'),
        ('public.grainline_favorite_owner_add(text)'),
        ('public.grainline_favorite_owner_remove(text)'),
        ('public.grainline_favorite_owner_delete_all(text)'),
        ('public.grainline_favorite_owner_export()'),
        ('public.grainline_favorite_seller_range_count(timestamp without time zone,timestamp without time zone,boolean)'),
        ('public.grainline_favorite_seller_listing_cleanup(text)'),
        ('public.grainline_favorite_admin_listing_cleanup(text)'),
        ('public.grainline_favorite_count_maintain()'),
        ('public.grainline_favorite_update_forbidden()'),
        ('public.grainline_listing_favorite_count_guard()')
    ) AS expected(signature)
   WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL;
  IF missing_functions IS NOT NULL THEN
    RAISE EXCEPTION 'Favorite preparation functions are missing: %', missing_functions;
  END IF;

  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public."Favorite"'::pg_catalog.regclass
         AND NOT tgisinternal
         AND tgname IN (
           'Favorite_count_after_insert',
           'Favorite_count_after_delete',
           'Favorite_update_forbidden'
         )) <> 3 THEN
    RAISE EXCEPTION 'Favorite preparation triggers are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = 'public."Listing"'::pg_catalog.regclass
       AND trigger_state.tgname = 'Listing_favoriteCount_guard'
       AND trigger_state.tgtype = 19
       AND trigger_state.tgenabled = 'O'
       AND NOT trigger_state.tgisinternal
       AND trigger_state.tgfoid = pg_catalog.to_regprocedure(
         'public.grainline_listing_favorite_count_guard()'
       )
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_roles AS owner
        ON owner.oid = procedure.proowner
     WHERE procedure.oid = pg_catalog.to_regprocedure(
             'public.grainline_listing_favorite_count_guard()'
           )
       AND NOT procedure.prosecdef
       AND procedure.provolatile = 'v'
       AND procedure.proparallel = 'u'
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND (owner.rolsuper OR owner.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Listing favorite-count guard is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."Favorite"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Favorite RLS changed during compatible preparation';
  END IF;
END;
$grainline_favorite_postflight$;

COMMIT;
