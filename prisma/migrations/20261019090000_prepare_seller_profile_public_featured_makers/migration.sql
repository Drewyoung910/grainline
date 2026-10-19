-- Add the bounded homepage featured-maker authority.
--
-- The operation preserves the existing three-tier selection: current admin
-- features, a weekly Guild rotation, then a weekly rotation within the four
-- highest-review public sellers. It returns exactly the fields consumed by
-- the homepage spotlight. userId is purpose-bound to suppress a self-follow
-- control and the operation returns at most two rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_featured_makers()
RETURNS TABLE (
  id text,
  "userId" text,
  "displayName" text,
  bio text,
  "storyBody" text,
  "yearsInBusiness" integer,
  "createdAt" timestamp without time zone,
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
         (selected.profile)."createdAt",
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

COMMIT;
