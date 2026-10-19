-- Add one bounded public marketplace-count authority.
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

REVOKE ALL ON FUNCTION public.grainline_seller_public_marketplace_counts()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_marketplace_counts()
  TO grainline_app_runtime;

COMMIT;
