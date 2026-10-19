-- Add bounded public seller sitemap count and page authorities.
--
-- The sitemap needs only two source counts and id/name/updatedAt pages. These
-- operations own the active-seller, public-listing, public-detail-photo,
-- ordering and pagination rules. They do not expose a reusable seller row.
-- Predecessor grants remain unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_sitemap_counts()
RETURNS TABLE (
  "sellerCount" bigint,
  "customerPhotoSellerCount" bigint
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_sitemap_counts$
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE EXISTS (
        SELECT 1
          FROM public."Listing" AS listing
         WHERE listing."sellerId" = seller.id
           AND listing.status::text = 'ACTIVE'
           AND listing."isPrivate" = false
           AND listing."archivedAt" IS NULL
      )
    ) AS "sellerCount",
    pg_catalog.count(*) FILTER (
      WHERE EXISTS (
        SELECT 1
          FROM public."Listing" AS listing
          JOIN public."Review" AS review
            ON review."listingId" = listing.id
          JOIN public."ReviewPhoto" AS photo
            ON photo."reviewId" = review.id
         WHERE listing."sellerId" = seller.id
           AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
           AND listing."isPrivate" = false
           AND listing."archivedAt" IS NULL
      )
    ) AS "customerPhotoSellerCount"
  FROM public."SellerProfile" AS seller
  WHERE seller."ownerAccountActive" = true
    AND seller."chargesEnabled" = true
    AND seller."stripeAccountSupported" = true
    AND seller."vacationMode" = false
$grainline_seller_public_sitemap_counts$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_sitemap_counts()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_sitemap_counts()
  TO grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_sitemap_page(
  p_kind text,
  p_skip integer,
  p_take integer
)
RETURNS TABLE (
  id text,
  "displayName" text,
  "updatedAt" timestamp without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_sitemap_page$
BEGIN
  IF p_kind IS NULL
     OR p_kind NOT IN ('SELLERS', 'CUSTOMER_PHOTOS')
     OR p_skip IS NULL
     OR p_skip < 0
     OR p_take IS NULL
     OR p_take < 1
     OR p_take > 50000 THEN
    RAISE EXCEPTION 'Seller public sitemap page input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."displayName"::text,
         seller."updatedAt"
    FROM public."SellerProfile" AS seller
   WHERE seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND (
       (
         p_kind = 'SELLERS'
         AND EXISTS (
           SELECT 1
             FROM public."Listing" AS listing
            WHERE listing."sellerId" = seller.id
              AND listing.status::text = 'ACTIVE'
              AND listing."isPrivate" = false
              AND listing."archivedAt" IS NULL
         )
       )
       OR (
         p_kind = 'CUSTOMER_PHOTOS'
         AND EXISTS (
           SELECT 1
             FROM public."Listing" AS listing
             JOIN public."Review" AS review
               ON review."listingId" = listing.id
             JOIN public."ReviewPhoto" AS photo
               ON photo."reviewId" = review.id
            WHERE listing."sellerId" = seller.id
              AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
              AND listing."isPrivate" = false
              AND listing."archivedAt" IS NULL
         )
       )
     )
   ORDER BY seller."updatedAt" DESC, seller.id ASC
   OFFSET p_skip
   LIMIT p_take;
END
$grainline_seller_public_sitemap_page$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_sitemap_page(
  text,
  integer,
  integer
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_sitemap_page(
  text,
  integer,
  integer
) TO grainline_app_runtime;

COMMIT;
