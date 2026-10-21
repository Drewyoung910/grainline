-- Normalize every SellerProfile authority timestamp that crosses the SQL/Node boundary.
-- Prisma stores these UTC values as timestamp without time zone; returning them
-- unchanged makes the JavaScript instant depend on the database host timezone.
-- No row predicate, write path, table grant, policy, or RLS state changes.

BEGIN;
DROP FUNCTION public.grainline_seller_public_sitemap_page(text, integer, integer);

CREATE OR REPLACE FUNCTION public.grainline_seller_public_sitemap_page(
  p_kind text,
  p_skip integer,
  p_take integer
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
         seller."updatedAt" AT TIME ZONE 'UTC'
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

REVOKE ALL ON FUNCTION public.grainline_seller_public_sitemap_page(text, integer, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_sitemap_page(text, integer, integer)
  TO grainline_app_runtime;

DROP FUNCTION public.grainline_seller_public_featured_makers();

CREATE OR REPLACE FUNCTION public.grainline_seller_public_featured_makers()
RETURNS TABLE (
  id text,
  "userId" text,
  "displayName" text,
  bio text,
  "storyBody" text,
  "yearsInBusiness" integer,
  "createdAt" timestamp with time zone,
  city text,
  state text,
  tagline text,
  "bannerImageUrl" text,
  "avatarImageUrl" text,
  "workshopImageUrl" text,
  "featuredListingIds" text[],
  "guildLevel" text,
  "isFoundingMaker" boolean,
  "foundingMakerNumber" integer,
  "ownerImageUrl" text
)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_featured_makers$
  WITH parameters AS (
    SELECT (pg_catalog.statement_timestamp() AT TIME ZONE 'UTC') AS current_utc,
           pg_catalog.floor(
             EXTRACT(
               epoch FROM pg_catalog.date_trunc(
                 'week',
                 pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
               )
             ) / 604800.0
           )::bigint AS week_number
  ),
  active_sellers AS (
    SELECT seller AS profile
      FROM public."SellerProfile" AS seller
     WHERE seller."ownerAccountActive" = true
       AND seller."chargesEnabled" = true
       AND seller."stripeAccountSupported" = true
       AND seller."vacationMode" = false
  ),
  curated_ranked AS (
    SELECT active.profile,
           pg_catalog.row_number() OVER (
             ORDER BY (active.profile)."featuredUntil" DESC,
                      (active.profile).id ASC
           ) AS candidate_index
      FROM active_sellers AS active
      CROSS JOIN parameters
     WHERE (active.profile)."featuredUntil" > parameters.current_utc
  ),
  curated AS (
    SELECT curated_ranked.profile,
           curated_ranked.candidate_index - 1 AS selection_rank
      FROM curated_ranked
     WHERE curated_ranked.candidate_index <= 2
  ),
  curated_count AS (
    SELECT pg_catalog.count(*)::bigint AS value
      FROM curated
  ),
  guild_ranked AS (
    SELECT active.profile,
           pg_catalog.row_number() OVER (
             ORDER BY (active.profile).id ASC
           ) AS candidate_index,
           pg_catalog.count(*) OVER () AS candidate_count
      FROM active_sellers AS active
     WHERE (active.profile)."guildLevel"::text IN ('GUILD_MEMBER', 'GUILD_MASTER')
       AND NOT EXISTS (
         SELECT 1
           FROM curated
          WHERE (curated.profile).id = (active.profile).id
       )
  ),
  guild_rotated AS (
    SELECT guild_ranked.profile,
           (
             guild_ranked.candidate_index - 1
             - (parameters.week_number % guild_ranked.candidate_count)
             + guild_ranked.candidate_count
           ) % guild_ranked.candidate_count AS rotation_rank
      FROM guild_ranked
      CROSS JOIN parameters
  ),
  guild_selected AS (
    SELECT guild_rotated.profile,
           curated_count.value + guild_rotated.rotation_rank AS selection_rank
      FROM guild_rotated
      CROSS JOIN curated_count
     WHERE guild_rotated.rotation_rank
           < GREATEST(0::bigint, 2::bigint - curated_count.value)
  ),
  selected_before_fallback AS (
    SELECT curated.profile, curated.selection_rank
      FROM curated
    UNION ALL
    SELECT guild_selected.profile, guild_selected.selection_rank
      FROM guild_selected
  ),
  selected_before_fallback_count AS (
    SELECT pg_catalog.count(*)::bigint AS value
      FROM selected_before_fallback
  ),
  top_review_pool AS (
    SELECT active.profile,
           COALESCE(summary."reviewCount", 0) AS review_count
      FROM active_sellers AS active
      LEFT JOIN public."SellerRatingSummary" AS summary
        ON summary."sellerProfileId" = (active.profile).id
     WHERE EXISTS (
       SELECT 1
         FROM public."Listing" AS listing
        WHERE listing."sellerId" = (active.profile).id
          AND listing.status::text = 'ACTIVE'
          AND listing."isPrivate" = false
     )
     ORDER BY COALESCE(summary."reviewCount", 0) DESC,
              (active.profile).id ASC
     LIMIT 4
  ),
  fallback_ranked AS (
    SELECT pool.profile,
           pool.review_count,
           pg_catalog.row_number() OVER (
             ORDER BY pool.review_count DESC, (pool.profile).id ASC
           ) AS candidate_index,
           pg_catalog.count(*) OVER () AS candidate_count
      FROM top_review_pool AS pool
     WHERE NOT EXISTS (
       SELECT 1
         FROM selected_before_fallback AS selected
        WHERE (selected.profile).id = (pool.profile).id
     )
  ),
  fallback_rotated AS (
    SELECT fallback_ranked.profile,
           (
             fallback_ranked.candidate_index - 1
             - (parameters.week_number % fallback_ranked.candidate_count)
             + fallback_ranked.candidate_count
           ) % fallback_ranked.candidate_count AS rotation_rank
      FROM fallback_ranked
      CROSS JOIN parameters
  ),
  fallback_selected AS (
    SELECT fallback_rotated.profile,
           selected_count.value + fallback_rotated.rotation_rank AS selection_rank
      FROM fallback_rotated
      CROSS JOIN selected_before_fallback_count AS selected_count
     WHERE fallback_rotated.rotation_rank
           < GREATEST(0::bigint, 2::bigint - selected_count.value)
  ),
  selected AS (
    SELECT selected_before_fallback.profile,
           selected_before_fallback.selection_rank
      FROM selected_before_fallback
    UNION ALL
    SELECT fallback_selected.profile,
           fallback_selected.selection_rank
      FROM fallback_selected
  )
  SELECT (selected.profile).id::text,
         (selected.profile)."userId"::text,
         (selected.profile)."displayName"::text,
         (selected.profile).bio::text,
         (selected.profile)."storyBody"::text,
         (selected.profile)."yearsInBusiness",
         (selected.profile)."createdAt" AT TIME ZONE 'UTC',
         (selected.profile).city::text,
         (selected.profile).state::text,
         (selected.profile).tagline::text,
         (selected.profile)."bannerImageUrl"::text,
         (selected.profile)."avatarImageUrl"::text,
         (selected.profile)."workshopImageUrl"::text,
         (selected.profile)."featuredListingIds"::text[],
         (selected.profile)."guildLevel"::text,
         (selected.profile)."isFoundingMaker",
         (selected.profile)."foundingMakerNumber",
         (selected.profile)."ownerImageUrl"::text
    FROM selected
   ORDER BY selected.selection_rank ASC
   LIMIT 2
$grainline_seller_public_featured_makers$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_featured_makers()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_featured_makers()
  TO grainline_app_runtime;

DROP FUNCTION public.grainline_seller_owner_following_page(integer, integer);

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_following_page(
  p_limit integer,
  p_offset integer
)
RETURNS TABLE (
  "followId" text,
  "followedAt" timestamp with time zone,
  "sellerProfileId" text,
  "displayName" text,
  tagline text,
  "avatarImageUrl" text,
  city text,
  state text,
  "vacationMode" boolean,
  "vacationReturnDate" timestamp with time zone,
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
         relationship."createdAt" AT TIME ZONE 'UTC',
         seller.id::text,
         seller."displayName"::text,
         seller.tagline::text,
         seller."avatarImageUrl"::text,
         seller.city::text,
         seller.state::text,
         seller."vacationMode",
         seller."vacationReturnDate" AT TIME ZONE 'UTC',
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

REVOKE ALL ON FUNCTION public.grainline_seller_owner_following_page(integer, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_following_page(integer, integer)
  TO grainline_app_runtime;

DROP FUNCTION public.grainline_seller_owner_saved_listing_page(integer, integer);

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_saved_listing_page(
  p_limit integer,
  p_offset integer
)
RETURNS TABLE (
  "savedAt" timestamp with time zone,
  "listingId" text,
  title text,
  "priceCents" integer,
  currency text,
  status text,
  "listingType" text,
  "stockQuantity" integer,
  "sellerProfileId" text,
  "displayName" text,
  "avatarImageUrl" text,
  "ownerImageUrl" text,
  "guildLevel" text,
  city text,
  state text,
  "acceptingNewOrders" boolean,
  "photoUrl" text,
  "photoAltText" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_saved_listing_page$
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
    RAISE EXCEPTION 'Seller saved-listing actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 24
     OR p_offset IS NULL
     OR p_offset < 0
     OR p_offset > 23976 THEN
    RAISE EXCEPTION 'Seller saved-listing page input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT favorite."createdAt" AT TIME ZONE 'UTC',
         listing.id::text,
         listing.title::text,
         listing."priceCents",
         listing.currency::text,
         listing.status::text,
         listing."listingType"::text,
         listing."stockQuantity",
         seller.id::text,
         seller."displayName"::text,
         seller."avatarImageUrl"::text,
         seller."ownerImageUrl"::text,
         seller."guildLevel"::text,
         seller.city::text,
         seller.state::text,
         seller."acceptingNewOrders",
         first_photo.url::text,
         first_photo."altText"::text
    FROM public."Favorite" AS favorite
    JOIN public."Listing" AS listing
      ON listing.id = favorite."listingId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    LEFT JOIN LATERAL (
      SELECT photo.url,
             photo."altText"
        FROM public."Photo" AS photo
       WHERE photo."listingId" = listing.id
       ORDER BY photo."sortOrder" ASC, photo.id ASC
       LIMIT 1
    ) AS first_photo ON true
   WHERE favorite."userId" = request_user_id
     AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
     AND listing."isPrivate" = false
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
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
   ORDER BY favorite."createdAt" DESC, favorite."listingId" DESC
   LIMIT p_limit
  OFFSET p_offset;
END
$grainline_seller_owner_saved_listing_page$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_saved_listing_page(integer, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_saved_listing_page(integer, integer)
  TO grainline_app_runtime;

DROP FUNCTION public.grainline_seller_owner_guild_dashboard_state(text);

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_guild_dashboard_state(
  p_seller_profile_id text
)
RETURNS TABLE (
  "sellerProfileId" text,
  "userId" text,
  bio text,
  "avatarImageUrl" text,
  "returnPolicy" text,
  "customOrderPolicy" text,
  "shippingPolicy" text,
  "guildLevel" text,
  "verificationStatus" text,
  "verificationReviewedAt" timestamp with time zone,
  "verificationReviewNotes" text,
  "verificationCraftDescription" text,
  "verificationYearsExperience" integer,
  "verificationPortfolioUrl" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_guild_dashboard_state$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner Guild dashboard context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner Guild dashboard input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."userId",
         seller.bio::text,
         seller."avatarImageUrl"::text,
         seller."returnPolicy"::text,
         seller."customOrderPolicy"::text,
         seller."shippingPolicy"::text,
         seller."guildLevel"::text,
         verification.status::text,
         verification."reviewedAt" AT TIME ZONE 'UTC',
         verification."reviewNotes"::text,
         verification."craftDescription"::text,
         verification."yearsExperience",
         verification."portfolioUrl"::text
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
    LEFT JOIN public."MakerVerification" AS verification
      ON verification."sellerProfileId" = seller.id
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id;
END
$grainline_seller_owner_guild_dashboard_state$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_guild_dashboard_state(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_guild_dashboard_state(text)
  TO grainline_app_runtime;

DROP FUNCTION public.grainline_seller_owner_shop_settings_state(text);

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_shop_settings_state(
  p_seller_profile_id text
)
RETURNS TABLE (
  "sellerProfileId" text,
  "chargesEnabled" boolean,
  "vacationMode" boolean,
  "vacationReturnDate" timestamp with time zone,
  "vacationMessage" text,
  city text,
  state text,
  lat double precision,
  lng double precision,
  "radiusMeters" integer,
  "publicMapOptIn" boolean,
  "shippingFlatRateCents" integer,
  "freeShippingOverCents" integer,
  "allowLocalPickup" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_shop_settings_state$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner Shop Settings context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner Shop Settings input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."chargesEnabled",
         seller."vacationMode",
         seller."vacationReturnDate" AT TIME ZONE 'UTC',
         seller."vacationMessage"::text,
         seller.city::text,
         seller.state::text,
         seller.lat,
         seller.lng,
         seller."radiusMeters",
         seller."publicMapOptIn",
         seller."shippingFlatRateCents",
         seller."freeShippingOverCents",
         seller."allowLocalPickup"
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id;
END
$grainline_seller_owner_shop_settings_state$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_shop_settings_state(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_shop_settings_state(text)
  TO grainline_app_runtime;

DROP FUNCTION public.grainline_seller_public_commission_interest_cards(text, integer);

CREATE OR REPLACE FUNCTION public.grainline_seller_public_commission_interest_cards(
  p_commission_request_id text,
  p_limit integer
)
RETURNS TABLE (
  "interestId" text,
  "createdAt" timestamp with time zone,
  "sellerProfileId" text,
  "displayName" text,
  "avatarImageUrl" text,
  "ownerImageUrl" text,
  "guildLevel" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_commission_interest_cards$
DECLARE
  viewer_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_commission_request_id IS NULL
     OR p_commission_request_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 100 THEN
    RAISE EXCEPTION 'Seller public commission-interest input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF viewer_user_id IS NOT NULL
     AND (
       viewer_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1
           FROM public."User" AS viewer
          WHERE viewer.id = viewer_user_id
            AND viewer.banned = false
            AND viewer."deletedAt" IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Seller public commission-interest viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT interest.id::text,
         interest."createdAt" AT TIME ZONE 'UTC',
         seller.id::text,
         seller."displayName"::text,
         seller."avatarImageUrl"::text,
         seller."ownerImageUrl"::text,
         seller."guildLevel"::text
    FROM public."CommissionRequest" AS commission
    JOIN public."CommissionInterest" AS interest
      ON interest."commissionRequestId" = commission.id
    JOIN public."SellerProfile" AS seller
      ON seller.id = interest."sellerProfileId"
   WHERE commission.id = p_commission_request_id
     AND commission.status::text = 'OPEN'
     AND commission."buyerAccountActive" = true
     AND (
       commission."expiresAt" IS NULL
       OR commission."expiresAt" > CURRENT_TIMESTAMP
     )
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
     AND (
       viewer_user_id IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM public."Block" AS relationship
          WHERE (
            relationship."blockerId" = viewer_user_id
            AND relationship."blockedId" = seller."userId"
          ) OR (
            relationship."blockerId" = seller."userId"
            AND relationship."blockedId" = viewer_user_id
          )
       )
     )
   ORDER BY interest."createdAt" ASC, interest.id ASC
   LIMIT p_limit;
END
$grainline_seller_public_commission_interest_cards$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_commission_interest_cards(text, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_commission_interest_cards(text, integer)
  TO grainline_app_runtime;

COMMIT;
