-- Add the bounded public similar-maker card authority.
--
-- The visible source listing binds its seller and location scope. Metro
-- matches sort before the same-state fallback, and the result exposes only the
-- fields rendered by the public card plus one public-listing cover image.
-- Predecessor grants remain unchanged during compatible preparation.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_similar_makers(
  p_source_listing_id text,
  p_limit integer DEFAULT 4
)
RETURNS TABLE (
  id text,
  "displayName" text,
  tagline text,
  city text,
  state text,
  "guildLevel" text,
  "avatarImageUrl" text,
  "bannerImageUrl" text,
  "ownerImageUrl" text,
  "coverImageUrl" text,
  "scopeKind" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_similar_makers$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_source_listing_id IS NULL
     OR p_source_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 4 THEN
    RAISE EXCEPTION 'Seller public similar-maker input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF request_user_id IS NOT NULL
     AND (
       request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1
           FROM public."User" AS request_user
          WHERE request_user.id = request_user_id
            AND request_user.banned = false
            AND request_user."deletedAt" IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Seller public similar-maker viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH source_seller AS (
    SELECT source.id,
           source."metroId",
           source."cityMetroId",
           source.state::text
      FROM public."Listing" AS source_listing
      JOIN public."SellerProfile" AS source
        ON source.id = source_listing."sellerId"
     WHERE source_listing.id = p_source_listing_id
       AND source_listing."archivedAt" IS NULL
       AND (
         request_user_id = source."userId"
         OR (
           source_listing.status::text IN ('ACTIVE', 'SOLD_OUT')
           AND source_listing."isPrivate" = false
           AND source."ownerAccountActive" = true
           AND source."chargesEnabled" = true
           AND source."stripeAccountSupported" = true
           AND source."vacationMode" = false
         )
         OR (
           request_user_id IS NOT NULL
           AND source_listing.status::text IN ('ACTIVE', 'SOLD')
           AND source_listing."isPrivate" = true
           AND source_listing."reservedForUserId" = request_user_id
           AND source."ownerAccountActive" = true
           AND source."chargesEnabled" = true
           AND source."stripeAccountSupported" = true
           AND source."vacationMode" = false
         )
       )
       AND (
         request_user_id IS NULL
         OR request_user_id = source."userId"
         OR NOT EXISTS (
           SELECT 1
             FROM public."Block" AS source_relationship
            WHERE (
              source_relationship."blockerId" = request_user_id
              AND source_relationship."blockedId" = source."userId"
            )
               OR (
                 source_relationship."blockerId" = source."userId"
                 AND source_relationship."blockedId" = request_user_id
               )
         )
       )
  ),
  candidates AS (
    SELECT seller.id,
           seller."displayName"::text AS "displayName",
           seller.tagline::text,
           seller.city::text,
           seller.state::text,
           seller."guildLevel"::text AS "guildLevel",
           seller."avatarImageUrl"::text AS "avatarImageUrl",
           seller."bannerImageUrl"::text AS "bannerImageUrl",
           seller."ownerImageUrl"::text AS "ownerImageUrl",
           cover.url::text AS "coverImageUrl",
           CASE
             WHEN (
               source_seller."metroId" IS NOT NULL
               AND (
                 seller."metroId" = source_seller."metroId"
                 OR seller."cityMetroId" = source_seller."metroId"
               )
             ) OR (
               source_seller."cityMetroId" IS NOT NULL
               AND (
                 seller."metroId" = source_seller."cityMetroId"
                 OR seller."cityMetroId" = source_seller."cityMetroId"
               )
             ) THEN 0
             ELSE 1
           END AS scope_priority,
           (
             SELECT pg_catalog.count(*)
               FROM public."Follow" AS follower
              WHERE follower."sellerProfileId" = seller.id
           ) AS follower_count
      FROM source_seller
      JOIN public."SellerProfile" AS seller
        ON seller.id <> source_seller.id
      LEFT JOIN LATERAL (
        SELECT listing.id
          FROM public."Listing" AS listing
         WHERE listing."sellerId" = seller.id
           AND listing.status::text = 'ACTIVE'
           AND listing."isPrivate" = false
           AND listing."archivedAt" IS NULL
         ORDER BY listing."qualityScore" DESC, listing.id DESC
         LIMIT 1
      ) AS top_listing ON true
      LEFT JOIN LATERAL (
        SELECT photo.url
          FROM public."Photo" AS photo
         WHERE photo."listingId" = top_listing.id
         ORDER BY photo."sortOrder" ASC
         LIMIT 1
      ) AS cover ON true
     WHERE seller."ownerAccountActive" = true
       AND seller."chargesEnabled" = true
       AND seller."stripeAccountSupported" = true
       AND seller."vacationMode" = false
       AND EXISTS (
         SELECT 1
           FROM public."Listing" AS public_listing
          WHERE public_listing."sellerId" = seller.id
            AND public_listing.status::text = 'ACTIVE'
            AND public_listing."isPrivate" = false
            AND public_listing."archivedAt" IS NULL
       )
       AND (
         (
           source_seller."metroId" IS NOT NULL
           AND (
             seller."metroId" = source_seller."metroId"
             OR seller."cityMetroId" = source_seller."metroId"
           )
         )
         OR (
           source_seller."cityMetroId" IS NOT NULL
           AND (
             seller."metroId" = source_seller."cityMetroId"
             OR seller."cityMetroId" = source_seller."cityMetroId"
           )
         )
         OR (
           source_seller.state IS NOT NULL
           AND seller.state IS NOT NULL
           AND pg_catalog.lower(seller.state::text) = pg_catalog.lower(source_seller.state)
         )
       )
       AND (
         request_user_id IS NULL
         OR NOT EXISTS (
           SELECT 1
             FROM public."Block" AS relationship
            WHERE (
              relationship."blockerId" = request_user_id
              AND relationship."blockedId" = seller."userId"
            )
               OR (
                 relationship."blockerId" = seller."userId"
                 AND relationship."blockedId" = request_user_id
               )
         )
       )
  )
  SELECT candidates.id,
         candidates."displayName",
         candidates.tagline,
         candidates.city,
         candidates.state,
         candidates."guildLevel",
         candidates."avatarImageUrl",
         candidates."bannerImageUrl",
         candidates."ownerImageUrl",
         candidates."coverImageUrl",
         CASE candidates.scope_priority
           WHEN 0 THEN 'METRO'
           ELSE 'STATE'
         END AS "scopeKind"
    FROM candidates
   ORDER BY candidates.scope_priority ASC,
            candidates."guildLevel"::public."GuildLevel" DESC,
            candidates.follower_count DESC,
            candidates.id ASC
   LIMIT p_limit;
END
$grainline_seller_public_similar_makers$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_similar_makers(text, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_similar_makers(text, integer)
  TO grainline_app_runtime;

COMMIT;
