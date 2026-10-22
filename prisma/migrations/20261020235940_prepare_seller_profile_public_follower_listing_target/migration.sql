-- Return the fresh public listing and maker fields needed before a followed-
-- maker listing fanout starts. The expected seller id binds the caller's
-- source event to the listing without retaining direct SellerProfile access.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_follower_listing_target(
  p_listing_id text,
  p_expected_seller_profile_id text
)
RETURNS TABLE (
  "listingId" text,
  title text,
  "priceCents" integer,
  currency text,
  "sellerProfileId" text,
  "sellerUserId" text,
  "sellerDisplayName" text
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_follower_listing_target$
BEGIN
  IF p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_expected_seller_profile_id IS NULL
     OR p_expected_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller public follower-listing input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT listing.id::text,
         listing.title::text,
         listing."priceCents",
         listing.currency::text,
         seller.id::text,
         seller."userId"::text,
         seller."displayName"::text
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = p_expected_seller_profile_id
     AND listing.status::text = 'ACTIVE'
     AND listing."isPrivate" = false
     AND listing."archivedAt" IS NULL
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false;
END
$grainline_seller_public_follower_listing_target$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_follower_listing_target(text,text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_follower_listing_target(text,text)
  TO grainline_app_runtime;

COMMIT;
