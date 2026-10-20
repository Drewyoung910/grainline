-- Replace two small owner SellerProfile writes with actor-bound operations.
-- No RLS or direct table grant changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_avatar_clear(
  p_seller_profile_id text
)
RETURNS TABLE ("sellerProfileId" text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_avatar_clear$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner avatar context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner avatar input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public."SellerProfile" AS seller
     SET "avatarImageUrl" = NULL,
         "updatedAt" = source_now
    FROM public."User" AS actor
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = request_user_id
     AND actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
  RETURNING seller.id;
END
$grainline_seller_owner_avatar_clear$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_metro_assignment_update(
  p_seller_profile_id text,
  p_metro_id text,
  p_city_metro_id text
)
RETURNS TABLE ("sellerProfileId" text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_metro_assignment_update$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner metro-assignment context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (
       p_metro_id IS NOT NULL
       AND p_metro_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR (
       p_city_metro_id IS NOT NULL
       AND p_city_metro_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'Seller owner metro-assignment input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public."SellerProfile" AS seller
     SET "metroId" = p_metro_id,
         "cityMetroId" = p_city_metro_id,
         "updatedAt" = source_now
    FROM public."User" AS actor
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = request_user_id
     AND actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
  RETURNING seller.id;
END
$grainline_seller_owner_metro_assignment_update$;

REVOKE ALL ON FUNCTION
  public.grainline_seller_owner_avatar_clear(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_owner_avatar_clear(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_seller_owner_metro_assignment_update(text,text,text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_owner_metro_assignment_update(text,text,text)
  TO grainline_app_runtime;

COMMIT;
