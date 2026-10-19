BEGIN;

-- Bind seller readiness and the published-history count used by the existing
-- listing re-publish AI review to one active owner and expected seller target.
CREATE OR REPLACE FUNCTION public.grainline_seller_owner_listing_publish_review(
  p_seller_profile_id text
)
RETURNS TABLE (
  "sellerProfileId" text,
  "displayName" text,
  "chargesEnabled" boolean,
  "vacationMode" boolean,
  "publishReviewListingCount" bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_listing_publish_review$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner listing-publish-review context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner listing-publish-review target is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."displayName"::text,
         seller."chargesEnabled",
         seller."vacationMode",
         pg_catalog.count(listing.id) FILTER (
           WHERE listing.status IN (
             'ACTIVE'::public."ListingStatus",
             'SOLD'::public."ListingStatus",
             'SOLD_OUT'::public."ListingStatus"
           )
         )::bigint
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    LEFT JOIN public."Listing" AS listing
      ON listing."sellerId" = seller.id
   WHERE account_user.id = request_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id
   GROUP BY seller.id,
            seller."displayName",
            seller."chargesEnabled",
            seller."vacationMode";
END
$grainline_seller_owner_listing_publish_review$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_listing_publish_review(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_listing_publish_review(text)
  TO grainline_app_runtime;

COMMIT;
