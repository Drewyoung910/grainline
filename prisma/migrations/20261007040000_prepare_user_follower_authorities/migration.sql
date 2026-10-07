CREATE OR REPLACE FUNCTION public.grainline_user_follower_notification_page(
  p_seller_profile_id text,
  p_after_follow_id text,
  p_limit integer
)
RETURNS TABLE (
  "followId" text,
  "followerId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_follower_notification_page$
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_after_follow_id IS NOT NULL
         AND p_after_follow_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 1000 THEN
    RAISE EXCEPTION 'User follower notification page input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT relationship.id,
         relationship."followerId"
    FROM public."SellerProfile" AS seller
    JOIN public."Follow" AS relationship
      ON relationship."sellerProfileId" = seller.id
    JOIN public."User" AS follower
      ON follower.id = relationship."followerId"
     AND follower.banned = false
     AND follower."deletedAt" IS NULL
   WHERE seller.id = p_seller_profile_id
     AND relationship."followerId" <> seller."userId"
     AND (p_after_follow_id IS NULL OR relationship.id > p_after_follow_id)
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS blocked_pair
        WHERE (
                blocked_pair."blockerId" = relationship."followerId"
            AND blocked_pair."blockedId" = seller."userId"
              )
           OR (
                blocked_pair."blockerId" = seller."userId"
            AND blocked_pair."blockedId" = relationship."followerId"
              )
     )
   ORDER BY relationship.id
   LIMIT p_limit;
END
$grainline_user_follower_notification_page$;

CREATE OR REPLACE FUNCTION public.grainline_user_owner_broadcast_follower_page(
  p_seller_profile_id text,
  p_after_follow_id text,
  p_limit integer,
  p_sellers_only boolean
)
RETURNS TABLE (
  "followId" text,
  "followerId" text,
  "notificationPreferences" jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_owner_broadcast_follower_page$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_after_follow_id IS NOT NULL
         AND p_after_follow_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 1000
     OR p_sellers_only IS NULL THEN
    RAISE EXCEPTION 'User owner broadcast follower page input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT relationship.id,
         relationship."followerId",
         follower."notificationPreferences"
    FROM public."SellerProfile" AS seller
    JOIN public."Follow" AS relationship
      ON relationship."sellerProfileId" = seller.id
    JOIN public."User" AS follower
      ON follower.id = relationship."followerId"
     AND follower.banned = false
     AND follower."deletedAt" IS NULL
    LEFT JOIN public."SellerProfile" AS follower_seller
      ON follower_seller."userId" = follower.id
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = request_user_id
     AND relationship."followerId" <> request_user_id
     AND (p_after_follow_id IS NULL OR relationship.id > p_after_follow_id)
     AND (NOT p_sellers_only OR follower_seller.id IS NOT NULL)
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS blocked_pair
        WHERE (
                blocked_pair."blockerId" = relationship."followerId"
            AND blocked_pair."blockedId" = request_user_id
              )
           OR (
                blocked_pair."blockerId" = request_user_id
            AND blocked_pair."blockedId" = relationship."followerId"
              )
     )
   ORDER BY relationship.id
   LIMIT p_limit;
END
$grainline_user_owner_broadcast_follower_page$;

CREATE OR REPLACE FUNCTION public.grainline_user_public_listing_favorite_counts(
  p_listing_ids text[]
)
RETURNS TABLE (
  "listingId" text,
  "favoriteCount" bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_public_listing_favorite_counts$
BEGIN
  IF p_listing_ids IS NULL
     OR pg_catalog.cardinality(p_listing_ids) < 1
     OR pg_catalog.cardinality(p_listing_ids) > 200
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR requested.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR pg_catalog.cardinality(p_listing_ids) <> (
       SELECT pg_catalog.count(DISTINCT requested.id)
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
     ) THEN
    RAISE EXCEPTION 'User public listing favorite count input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT listing.id,
         pg_catalog.count(favoriter.id)::bigint
    FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
    JOIN public."Listing" AS listing
      ON listing.id = requested.id
     AND listing.status = 'ACTIVE'
     AND listing."isPrivate" = false
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
     AND seller."chargesEnabled" = true
     AND (seller."stripeAccountVersion" IS NULL
          OR seller."stripeAccountVersion" = 'v2')
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
    LEFT JOIN public."Favorite" AS favorite
      ON favorite."listingId" = listing.id
    LEFT JOIN public."User" AS favoriter
      ON favoriter.id = favorite."userId"
     AND favoriter.banned = false
     AND favoriter."deletedAt" IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS blocked_pair
        WHERE (
                blocked_pair."blockerId" = favoriter.id
            AND blocked_pair."blockedId" = seller."userId"
              )
           OR (
                blocked_pair."blockerId" = seller."userId"
            AND blocked_pair."blockedId" = favoriter.id
              )
     )
   GROUP BY listing.id
   ORDER BY listing.id;
END
$grainline_user_public_listing_favorite_counts$;

REVOKE ALL ON FUNCTION public.grainline_user_follower_notification_page(text, text, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_follower_notification_page(text, text, integer)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_owner_broadcast_follower_page(text, text, integer, boolean)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_owner_broadcast_follower_page(text, text, integer, boolean)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_public_listing_favorite_counts(text[])
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_public_listing_favorite_counts(text[])
  TO grainline_app_runtime;
