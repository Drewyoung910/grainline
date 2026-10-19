BEGIN;

-- Return one exact coordinate pair only for the active owner and the exact
-- seller profile expected by post-create listing metro assignment. This is a
-- server-side purpose-bound source; it is never a public map projection.
CREATE OR REPLACE FUNCTION public.grainline_seller_owner_listing_metro_source(
  p_seller_profile_id text
)
RETURNS TABLE (
  "sellerProfileId" text,
  lat double precision,
  lng double precision
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_listing_metro_source$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner listing-metro context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner listing-metro target is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller.lat,
         seller.lng
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
   WHERE account_user.id = request_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id;
END
$grainline_seller_owner_listing_metro_source$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_listing_metro_source(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_listing_metro_source(text)
  TO grainline_app_runtime;

COMMIT;
