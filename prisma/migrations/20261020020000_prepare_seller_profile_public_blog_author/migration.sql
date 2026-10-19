-- Add the bounded public blog-author projection.
--
-- The operation exposes only the presentation and owner identifier already
-- consumed by the author landing page, and only while the seller has at least
-- one currently public post. The owner identifier remains purpose-bound to the
-- page's reciprocal-block check.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_blog_author(
  p_seller_profile_id text
)
RETURNS TABLE (
  id text,
  "userId" text,
  "displayName" text,
  tagline text,
  "avatarImageUrl" text,
  "bannerImageUrl" text,
  "ownerImageUrl" text
)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_blog_author$
  SELECT seller.id::text,
         seller."userId"::text,
         seller."displayName"::text,
         seller.tagline::text,
         seller."avatarImageUrl"::text,
         seller."bannerImageUrl"::text,
         seller."ownerImageUrl"::text
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND EXISTS (
       SELECT 1
         FROM public."BlogPost" AS post
        WHERE post."sellerProfileId" = seller.id
          AND post.status::text = 'PUBLISHED'
          AND post."publishedAt" IS NOT NULL
          AND post."publishedAt"
              <= (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')
          AND post."authorAccountActive" = true
     )
   LIMIT 1
$grainline_seller_public_blog_author$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_blog_author(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_blog_author(text)
  TO grainline_app_runtime;

COMMIT;
