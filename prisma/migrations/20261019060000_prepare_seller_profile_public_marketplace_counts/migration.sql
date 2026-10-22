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

CREATE OR REPLACE FUNCTION public.grainline_seller_public_listing_tags(
  p_limit integer
)
RETURNS TABLE (
  tag text,
  count bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_listing_tags$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Seller public listing-tag limit is invalid';
  END IF;

  RETURN QUERY
  SELECT tags.tag, pg_catalog.count(*)
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    CROSS JOIN LATERAL pg_catalog.unnest(listing.tags) AS tags(tag)
   WHERE listing.status::text = 'ACTIVE'
     AND listing."isPrivate" = false
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
   GROUP BY tags.tag
   ORDER BY pg_catalog.count(*) DESC, tags.tag ASC
   LIMIT p_limit;
END
$grainline_seller_public_listing_tags$;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_seller_tags(
  p_seller_id text,
  p_limit integer
)
RETURNS TABLE (
  tag text,
  count bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_seller_tags$
BEGIN
  IF p_seller_id IS NULL
     OR pg_catalog.length(p_seller_id) < 1
     OR pg_catalog.length(p_seller_id) > 191
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 8 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Seller public seller-tag input is invalid';
  END IF;

  RETURN QUERY
  SELECT tags.tag, pg_catalog.count(*)
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    CROSS JOIN LATERAL pg_catalog.unnest(listing.tags) AS tags(tag)
   WHERE listing."sellerId" = p_seller_id
     AND listing.status::text = 'ACTIVE'
     AND listing."isPrivate" = false
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
   GROUP BY tags.tag
   ORDER BY pg_catalog.count(*) DESC, tags.tag ASC
   LIMIT p_limit;
END
$grainline_seller_public_seller_tags$;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_blog_tags(
  p_limit integer
)
RETURNS TABLE (
  tag text,
  count bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_blog_tags$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Seller public blog-tag limit is invalid';
  END IF;

  RETURN QUERY
  SELECT tags.tag, pg_catalog.count(*)
    FROM public."BlogPost" AS post
    LEFT JOIN public."SellerProfile" AS seller
      ON seller.id = post."sellerProfileId"
    CROSS JOIN LATERAL pg_catalog.unnest(post.tags) AS tags(tag)
   WHERE post.status::text = 'PUBLISHED'
     AND post."publishedAt" IS NOT NULL
     AND post."publishedAt" <= pg_catalog.now()
     AND post."authorAccountActive" = true
     AND (
       post."sellerProfileId" IS NULL
       OR (
         seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
         AND seller."vacationMode" = false
         AND seller."ownerAccountActive" = true
       )
     )
   GROUP BY tags.tag
   ORDER BY pg_catalog.count(*) DESC, tags.tag ASC
   LIMIT p_limit;
END
$grainline_seller_public_blog_tags$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_marketplace_counts()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_marketplace_counts()
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_seller_public_marketplace_rating_average()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_marketplace_rating_average()
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_seller_public_listing_tags(integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_listing_tags(integer)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_seller_public_seller_tags(text, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_seller_tags(text, integer)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_seller_public_blog_tags(integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_blog_tags(integer)
  TO grainline_app_runtime;

COMMIT;
