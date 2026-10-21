-- Add bounded public marketplace aggregate authorities.
--
-- The marketing surfaces need only the number of active sellers with a public
-- listing and the historical founding-maker allocation count. The second
-- count intentionally preserves the predecessor query's all-profile scope.
-- Predecessor grants remain unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_marketplace_counts()
RETURNS TABLE (
  "activeSellerCount" bigint,
  "foundingMakerCount" bigint
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_marketplace_counts$
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE seller."ownerAccountActive" = true
        AND seller."chargesEnabled" = true
        AND seller."stripeAccountSupported" = true
        AND seller."vacationMode" = false
        AND EXISTS (
          SELECT 1
            FROM public."Listing" AS listing
           WHERE listing."sellerId" = seller.id
             AND listing.status::text = 'ACTIVE'
             AND listing."isPrivate" = false
             AND listing."archivedAt" IS NULL
        )
    ) AS "activeSellerCount",
    pg_catalog.count(*) FILTER (
      WHERE seller."isFoundingMaker" = true
    ) AS "foundingMakerCount"
  FROM public."SellerProfile" AS seller
$grainline_seller_public_marketplace_counts$;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_marketplace_rating_average()
RETURNS double precision
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_marketplace_rating_average$
  SELECT pg_catalog.avg(review."ratingX2")::double precision / 2.0
    FROM public."Review" AS review
    JOIN public."Listing" AS listing
      ON listing.id = review."listingId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.status::text = 'ACTIVE'
     AND listing."isPrivate" = false
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
$grainline_seller_public_marketplace_rating_average$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_marketplace_counts()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_marketplace_counts()
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_seller_public_marketplace_rating_average()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_marketplace_rating_average()
  TO grainline_app_runtime;

COMMIT;
