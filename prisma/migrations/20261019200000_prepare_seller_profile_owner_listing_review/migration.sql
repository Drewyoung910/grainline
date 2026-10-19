BEGIN;

-- Return only the active seller identity and total listing count consumed by
-- post-create AI review. The count intentionally includes every listing
-- status, matching Prisma's predecessor `_count.listings` relation count.
CREATE OR REPLACE FUNCTION public.grainline_seller_owner_listing_review()
RETURNS TABLE (
  "sellerProfileId" text,
  "displayName" text,
  "totalListingCount" bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_listing_review$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner listing-review context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."displayName"::text,
         pg_catalog.count(listing.id)::bigint
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    LEFT JOIN public."Listing" AS listing
      ON listing."sellerId" = seller.id
   WHERE account_user.id = request_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
   GROUP BY seller.id, seller."displayName";
END
$grainline_seller_owner_listing_review$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_listing_review()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_listing_review()
  TO grainline_app_runtime;

COMMIT;
