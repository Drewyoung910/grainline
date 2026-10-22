-- Resolve the exact public listing and owner fields needed before creating a
-- Favorite. The listing and seller availability predicates remain inside one
-- bounded database authority so SellerProfile can later lose direct runtime
-- table access without changing save behavior.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_favorite_target(
  p_listing_id text
)
RETURNS TABLE (
  "listingId" text,
  title text,
  "ownerUserId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_favorite_target$
BEGIN
  IF p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller public favorite target is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT listing.id::text,
         listing.title::text,
         seller."userId"::text
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
   LIMIT 1;
END
$grainline_seller_public_favorite_target$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_favorite_target(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_favorite_target(text)
  TO grainline_app_runtime;

COMMIT;
