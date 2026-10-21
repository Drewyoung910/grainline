-- Replace the saved-post page's caller-composed SellerProfile relation with
-- actor-bound count and page authorities. The functions own public-post
-- eligibility, seller orderability and reciprocal-block filtering.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_saved_blog_post_count()
RETURNS TABLE (
  value bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_saved_blog_post_count$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = request_user_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Seller saved-blog actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT pg_catalog.count(*)::bigint
    FROM public."SavedBlogPost" AS saved
    JOIN public."BlogPost" AS post
      ON post.id = saved."blogPostId"
    LEFT JOIN public."SellerProfile" AS seller
      ON seller.id = post."sellerProfileId"
   WHERE saved."userId" = request_user_id
     AND post.status::text = 'PUBLISHED'
     AND post."publishedAt" IS NOT NULL
     AND post."publishedAt"
         <= (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')
     AND post."authorAccountActive" = true
     AND (
       post."sellerProfileId" IS NULL
       OR (
         seller.id IS NOT NULL
         AND seller."ownerAccountActive" = true
         AND seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
         AND seller."vacationMode" = false
         AND NOT EXISTS (
           SELECT 1
             FROM public."Block" AS relationship
            WHERE (
              relationship."blockerId" = request_user_id
              AND relationship."blockedId" = seller."userId"
            ) OR (
              relationship."blockerId" = seller."userId"
              AND relationship."blockedId" = request_user_id
            )
         )
       )
     );
END
$grainline_seller_owner_saved_blog_post_count$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_saved_blog_post_page(
  p_limit integer,
  p_offset integer
)
RETURNS TABLE (
  "blogPostId" text,
  slug text,
  title text,
  excerpt text,
  "coverImageUrl" text,
  type text,
  "readingTimeMinutes" integer,
  "publishedAt" timestamp with time zone,
  "authorName" text,
  "authorImageUrl" text,
  "authorSellerName" text,
  "authorSellerAvatarUrl" text,
  "sellerProfileId" text,
  "sellerDisplayName" text,
  "sellerAvatarImageUrl" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_saved_blog_post_page$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = request_user_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Seller saved-blog actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 24
     OR p_offset IS NULL
     OR p_offset < 0
     OR p_offset > 23976 THEN
    RAISE EXCEPTION 'Seller saved-blog page input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT post.id::text,
         post.slug::text,
         post.title::text,
         post.excerpt::text,
         post."coverImageUrl"::text,
         post.type::text,
         post."readingTimeMinutes",
         post."publishedAt" AT TIME ZONE 'UTC',
         post."authorName"::text,
         post."authorImageUrl"::text,
         post."authorSellerName"::text,
         post."authorSellerAvatarUrl"::text,
         post."sellerProfileId"::text,
         seller."displayName"::text,
         seller."avatarImageUrl"::text
    FROM public."SavedBlogPost" AS saved
    JOIN public."BlogPost" AS post
      ON post.id = saved."blogPostId"
    LEFT JOIN public."SellerProfile" AS seller
      ON seller.id = post."sellerProfileId"
   WHERE saved."userId" = request_user_id
     AND post.status::text = 'PUBLISHED'
     AND post."publishedAt" IS NOT NULL
     AND post."publishedAt"
         <= (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')
     AND post."authorAccountActive" = true
     AND (
       post."sellerProfileId" IS NULL
       OR (
         seller.id IS NOT NULL
         AND seller."ownerAccountActive" = true
         AND seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
         AND seller."vacationMode" = false
         AND NOT EXISTS (
           SELECT 1
             FROM public."Block" AS relationship
            WHERE (
              relationship."blockerId" = request_user_id
              AND relationship."blockedId" = seller."userId"
            ) OR (
              relationship."blockerId" = seller."userId"
              AND relationship."blockedId" = request_user_id
            )
         )
       )
     )
   ORDER BY saved."createdAt" DESC, saved.id DESC
   LIMIT p_limit
  OFFSET p_offset;
END
$grainline_seller_owner_saved_blog_post_page$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_saved_blog_post_count()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_owner_saved_blog_post_page(integer, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_saved_blog_post_count()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_saved_blog_post_page(integer, integer)
  TO grainline_app_runtime;

COMMIT;
