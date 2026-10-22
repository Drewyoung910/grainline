-- Return the bounded, deduplicated seller-author seed used by the base sitemap.
-- The operation preserves the predecessor's first-500-post source window and
-- first-100-author output cap without retaining a BlogPost SellerProfile join.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_blog_author_sitemap(
  p_source_limit integer,
  p_author_limit integer
)
RETURNS TABLE (
  id text,
  "displayName" text,
  "updatedAt" timestamp with time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_blog_author_sitemap$
BEGIN
  IF p_source_limit IS NULL
     OR p_source_limit < 1
     OR p_source_limit > 500
     OR p_author_limit IS NULL
     OR p_author_limit < 1
     OR p_author_limit > 100 THEN
    RAISE EXCEPTION 'Seller blog-author sitemap limit is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH source_posts AS MATERIALIZED (
    SELECT post."sellerProfileId",
           post."updatedAt",
           post.id
      FROM public."BlogPost" AS post
      JOIN public."SellerProfile" AS seller
        ON seller.id = post."sellerProfileId"
     WHERE post."sellerProfileId" IS NOT NULL
       AND post.status::text = 'PUBLISHED'
       AND post."publishedAt" IS NOT NULL
       AND post."publishedAt"
           <= (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')
       AND post."authorAccountActive" = true
       AND seller."ownerAccountActive" = true
       AND seller."chargesEnabled" = true
       AND seller."stripeAccountSupported" = true
       AND seller."vacationMode" = false
     ORDER BY post."updatedAt" DESC, post.id ASC
     LIMIT p_source_limit
  ), latest_by_seller AS (
    SELECT DISTINCT ON (source."sellerProfileId")
           source."sellerProfileId",
           source."updatedAt",
           source.id AS "postId"
      FROM source_posts AS source
     ORDER BY source."sellerProfileId", source."updatedAt" DESC, source.id ASC
  )
  SELECT seller.id::text,
         seller."displayName"::text,
         latest."updatedAt" AT TIME ZONE 'UTC'
    FROM latest_by_seller AS latest
    JOIN public."SellerProfile" AS seller
      ON seller.id = latest."sellerProfileId"
   ORDER BY latest."updatedAt" DESC, latest."postId" ASC
   LIMIT p_author_limit;
END
$grainline_seller_public_blog_author_sitemap$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_blog_author_sitemap(integer,integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_blog_author_sitemap(integer,integer)
  TO grainline_app_runtime;

COMMIT;
