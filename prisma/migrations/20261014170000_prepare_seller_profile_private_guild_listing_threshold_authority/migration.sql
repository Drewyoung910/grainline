-- Fixed derived-state synchronization for the Guild listing threshold.
-- The caller supplies only the seller identity. The database derives the
-- threshold state from canonical active public listings and keeps both seller
-- representations synchronized during deployment skew.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_listing_threshold_sync(
  p_seller_profile_id text
)
RETURNS timestamp(3) without time zone
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_listing_threshold_sync$
DECLARE
  current_private_threshold timestamp(3) without time zone;
  active_public_listing_count bigint;
  next_threshold timestamp(3) without time zone;
  changed_at timestamp(3) without time zone;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller Guild listing-threshold input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller_private."listingsBelowThresholdSince"
    INTO current_private_threshold
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT pg_catalog.count(*)
    INTO active_public_listing_count
    FROM public."Listing" AS listing
   WHERE listing."sellerId" = p_seller_profile_id
     AND listing.status = 'ACTIVE'
     AND listing."isPrivate" = false;

  next_threshold := CASE
    WHEN active_public_listing_count < 5
      THEN COALESCE(
        current_private_threshold,
        pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      )
    ELSE NULL
  END;
  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';

  UPDATE public."SellerProfilePrivate"
     SET "listingsBelowThresholdSince" = next_threshold,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;

  UPDATE public."SellerProfile"
     SET "listingsBelowThresholdSince" = next_threshold,
         "updatedAt" = changed_at
   WHERE id = p_seller_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller Guild listing-threshold target changed'
      USING ERRCODE = '40001';
  END IF;

  RETURN next_threshold;
END
$grainline_seller_guild_listing_threshold_sync$;

REVOKE ALL ON FUNCTION public.grainline_seller_guild_listing_threshold_sync(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_guild_listing_threshold_sync(text)
  TO grainline_app_runtime;

COMMIT;
