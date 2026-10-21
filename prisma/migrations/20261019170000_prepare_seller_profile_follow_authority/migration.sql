BEGIN;

-- Public read state for a visible seller. Authentication is optional; when
-- present, following is derived only from transaction-local actor context.
CREATE OR REPLACE FUNCTION public.grainline_seller_public_follow_state(
  p_seller_profile_id text
)
RETURNS TABLE (
  "sellerProfileId" text,
  "followerCount" bigint,
  following boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_follow_state$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (
       request_user_id IS NOT NULL
       AND request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'Seller public follow-state input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         (
           SELECT pg_catalog.count(*)::bigint
             FROM public."Follow" AS follower
            WHERE follower."sellerProfileId" = seller.id
         ),
         request_user_id IS NOT NULL
         AND EXISTS (
           SELECT 1
             FROM public."User" AS actor
             JOIN public."Follow" AS relationship
               ON relationship."followerId" = actor.id
              AND relationship."sellerProfileId" = seller.id
            WHERE actor.id = request_user_id
              AND actor.banned = false
              AND actor."deletedAt" IS NULL
         )
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true;
END
$grainline_seller_public_follow_state$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_following_count()
RETURNS TABLE (value bigint)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_following_count$
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
    RAISE EXCEPTION 'Seller owner following actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT pg_catalog.count(*)::bigint
    FROM public."Follow" AS relationship
    JOIN public."SellerProfile" AS seller
      ON seller.id = relationship."sellerProfileId"
   WHERE relationship."followerId" = request_user_id
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true;
END
$grainline_seller_owner_following_count$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_following_page(
  p_limit integer,
  p_offset integer
)
RETURNS TABLE (
  "followId" text,
  "followedAt" timestamp without time zone,
  "sellerProfileId" text,
  "displayName" text,
  tagline text,
  "avatarImageUrl" text,
  city text,
  state text,
  "vacationMode" boolean,
  "vacationReturnDate" timestamp without time zone,
  "guildLevel" text,
  "ownerImageUrl" text,
  "followerCount" bigint,
  "listingCount" bigint,
  "latestListingId" text,
  "latestListingTitle" text,
  "latestListingPriceCents" integer,
  "latestListingCurrency" text,
  "latestListingPhotoUrl" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_following_page$
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
    RAISE EXCEPTION 'Seller owner following actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 20
     OR p_offset IS NULL
     OR p_offset < 0
     OR p_offset > 19980 THEN
    RAISE EXCEPTION 'Seller owner following page input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT relationship.id::text,
         relationship."createdAt"::timestamp without time zone,
         seller.id::text,
         seller."displayName"::text,
         seller.tagline::text,
         seller."avatarImageUrl"::text,
         seller.city::text,
         seller.state::text,
         seller."vacationMode",
         seller."vacationReturnDate"::timestamp without time zone,
         seller."guildLevel"::text,
         seller."ownerImageUrl"::text,
         follower_counts.value,
         listing_counts.value,
         latest_listing.id::text,
         latest_listing.title::text,
         latest_listing."priceCents",
         latest_listing.currency::text,
         latest_photo.url::text
    FROM public."Follow" AS relationship
    JOIN public."SellerProfile" AS seller
      ON seller.id = relationship."sellerProfileId"
    CROSS JOIN LATERAL (
      SELECT pg_catalog.count(*)::bigint AS value
        FROM public."Follow" AS follower
       WHERE follower."sellerProfileId" = seller.id
    ) AS follower_counts
    CROSS JOIN LATERAL (
      SELECT pg_catalog.count(*)::bigint AS value
        FROM public."Listing" AS listing
       WHERE listing."sellerId" = seller.id
         AND listing.status::text = 'ACTIVE'
         AND listing."isPrivate" = false
         AND listing."archivedAt" IS NULL
    ) AS listing_counts
    LEFT JOIN LATERAL (
      SELECT listing.id,
             listing.title,
             listing."priceCents",
             listing.currency
        FROM public."Listing" AS listing
       WHERE listing."sellerId" = seller.id
         AND listing.status::text = 'ACTIVE'
         AND listing."isPrivate" = false
         AND listing."archivedAt" IS NULL
       ORDER BY listing."createdAt" DESC, listing.id DESC
       LIMIT 1
    ) AS latest_listing ON true
    LEFT JOIN LATERAL (
      SELECT photo.url
        FROM public."Photo" AS photo
       WHERE photo."listingId" = latest_listing.id
       ORDER BY photo."sortOrder" ASC, photo.id ASC
       LIMIT 1
    ) AS latest_photo ON true
   WHERE relationship."followerId" = request_user_id
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
   ORDER BY relationship."createdAt" DESC, relationship.id DESC
   LIMIT p_limit
  OFFSET p_offset;
END
$grainline_seller_owner_following_page$;

-- Actor-bound follow creation. The same sorted user-pair lock used by Block
-- creation closes the block/follow race before the relationship is inserted.
CREATE OR REPLACE FUNCTION public.grainline_seller_public_follow_create(
  p_seller_profile_id text,
  p_follow_id text
)
RETURNS TABLE (
  "resultStatus" text,
  "ownerUserId" text,
  created boolean,
  "followerCount" bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_follow_create$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  target_user_id text;
  locked_target_user_id text;
  locked_user_count integer := 0;
  inserted_count integer := 0;
  current_follower_count bigint := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_follow_id IS NULL
     OR p_follow_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller public follow-create context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, false, 0::bigint;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller public follow-create actor is inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller."userId"
    INTO target_user_id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true;

  IF target_user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, false, 0::bigint;
    RETURN;
  END IF;

  IF target_user_id = request_user_id THEN
    RETURN QUERY SELECT 'SELF'::text, NULL::text, false, 0::bigint;
    RETURN;
  END IF;

  locked_target_user_id := target_user_id;

  SELECT pg_catalog.count(*)::integer
    INTO locked_user_count
    FROM public.grainline_user_block_pair_lock(target_user_id) AS locked_user
   WHERE locked_user."deletedAt" IS NULL;

  IF locked_user_count <> 2 THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, false, 0::bigint;
    RETURN;
  END IF;

  -- Revalidate and hold the seller row after taking the user-pair lock.
  target_user_id := NULL;
  SELECT seller."userId"
    INTO target_user_id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
   FOR SHARE OF seller;

  IF target_user_id IS NULL OR target_user_id <> locked_target_user_id THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, false, 0::bigint;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Block" AS relationship
     WHERE (
       relationship."blockerId" = request_user_id
       AND relationship."blockedId" = target_user_id
     ) OR (
       relationship."blockerId" = target_user_id
       AND relationship."blockedId" = request_user_id
     )
  ) THEN
    RETURN QUERY SELECT 'BLOCKED'::text, NULL::text, false, 0::bigint;
    RETURN;
  END IF;

  INSERT INTO public."Follow" (
    id,
    "followerId",
    "sellerProfileId",
    "createdAt"
  ) VALUES (
    p_follow_id,
    request_user_id,
    p_seller_profile_id,
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  )
  ON CONFLICT ("followerId", "sellerProfileId") DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT pg_catalog.count(*)::bigint
    INTO current_follower_count
    FROM public."Follow" AS follower
   WHERE follower."sellerProfileId" = p_seller_profile_id;

  RETURN QUERY
  SELECT 'OK'::text,
         target_user_id,
         inserted_count = 1,
         current_follower_count;
END
$grainline_seller_public_follow_create$;

-- Owner-bound stale-follow cleanup. Visibility is intentionally not required,
-- matching the predecessor DELETE route's ability to unfollow a hidden shop.
CREATE OR REPLACE FUNCTION public.grainline_seller_public_follow_delete(
  p_seller_profile_id text
)
RETURNS TABLE (
  "resultStatus" text,
  "followerCount" bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_follow_delete$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  target_seller_id text;
  current_follower_count bigint := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller public follow-delete context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, 0::bigint;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller public follow-delete actor is inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id
    INTO target_seller_id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
   FOR SHARE OF seller;

  IF target_seller_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, 0::bigint;
    RETURN;
  END IF;

  DELETE FROM public."Follow" AS relationship
   WHERE relationship."followerId" = request_user_id
     AND relationship."sellerProfileId" = target_seller_id;

  SELECT pg_catalog.count(*)::bigint
    INTO current_follower_count
    FROM public."Follow" AS follower
   WHERE follower."sellerProfileId" = target_seller_id;

  RETURN QUERY SELECT 'OK'::text, current_follower_count;
END
$grainline_seller_public_follow_delete$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_follow_state(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_owner_following_count()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_owner_following_page(integer, integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_public_follow_create(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_public_follow_delete(text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_public_follow_state(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_following_count()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_following_page(integer, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_follow_create(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_follow_delete(text)
  TO grainline_app_runtime;

COMMIT;
