-- Add bounded authorities for the public metro maker directory.
--
-- Static paths, rendered maker cards and nearby-area discovery intentionally
-- have different eligibility contracts. Keep those predicates separate while
-- removing SellerProfile access from Metro relation filters and the page row.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_metro_static_slugs()
RETURNS TABLE (slug text)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_metro_static_slugs$
  SELECT metro.slug::text
    FROM public."Metro" AS metro
   WHERE metro."isActive" = true
     AND EXISTS (
       SELECT 1
         FROM public."SellerProfile" AS seller
        WHERE (
          seller."metroId" = metro.id
          OR seller."cityMetroId" = metro.id
        )
          AND seller."ownerAccountActive" = true
          AND seller."chargesEnabled" = true
          AND seller."stripeAccountSupported" = true
          AND seller."vacationMode" = false
     )
   ORDER BY metro.slug ASC
$grainline_seller_public_metro_static_slugs$;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_metro_makers(
  p_metro_id text,
  p_is_major boolean,
  p_limit integer DEFAULT 24
)
RETURNS TABLE (
  id text,
  "displayName" text,
  tagline text,
  city text,
  state text,
  "avatarImageUrl" text,
  "bannerImageUrl" text,
  "guildLevel" text,
  "ownerImageUrl" text,
  "coverImageUrl" text,
  "activeListingCount" bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_metro_makers$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_metro_id IS NULL
     OR p_metro_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_is_major IS NULL
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 24 THEN
    RAISE EXCEPTION 'Seller public metro-maker input is invalid'
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
    RAISE EXCEPTION 'Seller public metro-maker viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id::text,
         seller."displayName"::text,
         seller.tagline::text,
         seller.city::text,
         seller.state::text,
         seller."avatarImageUrl"::text,
         seller."bannerImageUrl"::text,
         seller."guildLevel"::text,
         seller."ownerImageUrl"::text,
         cover.url::text AS "coverImageUrl",
         counts.active_listing_count AS "activeListingCount"
    FROM public."SellerProfile" AS seller
    JOIN LATERAL (
      SELECT pg_catalog.count(*) AS active_listing_count
        FROM public."Listing" AS listing
       WHERE listing."sellerId" = seller.id
         AND listing.status::text = 'ACTIVE'
         AND listing."isPrivate" = false
         AND listing."archivedAt" IS NULL
    ) AS counts ON counts.active_listing_count > 0
    LEFT JOIN LATERAL (
      SELECT listing.id
        FROM public."Listing" AS listing
       WHERE listing."sellerId" = seller.id
         AND listing.status::text = 'ACTIVE'
         AND listing."isPrivate" = false
         AND listing."archivedAt" IS NULL
       ORDER BY listing."createdAt" DESC, listing.id DESC
       LIMIT 1
    ) AS newest_listing ON true
    LEFT JOIN LATERAL (
      SELECT photo.url
        FROM public."Photo" AS photo
       WHERE photo."listingId" = newest_listing.id
       ORDER BY photo."sortOrder" ASC
       LIMIT 1
    ) AS cover ON true
   WHERE seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND (
       (p_is_major = true AND seller."metroId" = p_metro_id)
       OR (p_is_major = false AND seller."cityMetroId" = p_metro_id)
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
   ORDER BY (
     SELECT pg_catalog.count(*)
       FROM public."Follow" AS follower
      WHERE follower."sellerProfileId" = seller.id
   ) DESC,
   seller.id ASC
   LIMIT p_limit;
END
$grainline_seller_public_metro_makers$;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_nearby_metros(
  p_metro_id text
)
RETURNS TABLE (
  id text,
  slug text,
  name text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_nearby_metros$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_metro_id IS NULL
     OR p_metro_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller public nearby-metro input is invalid'
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
    RAISE EXCEPTION 'Seller public nearby-metro viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH current_metro AS (
    SELECT current.id,
           current."parentMetroId"
      FROM public."Metro" AS current
     WHERE current.id = p_metro_id
  ),
  candidates AS (
    SELECT nearby.id,
           nearby.slug,
           nearby.name
      FROM current_metro
      JOIN public."Metro" AS nearby
        ON (
          (
            current_metro."parentMetroId" IS NULL
            AND nearby."parentMetroId" = current_metro.id
          )
          OR (
            current_metro."parentMetroId" IS NOT NULL
            AND (
              nearby.id = current_metro."parentMetroId"
              OR nearby."parentMetroId" = current_metro.id
            )
          )
        )
     WHERE nearby."isActive" = true
  )
  SELECT candidates.id::text,
         candidates.slug::text,
         candidates.name::text
    FROM candidates
   WHERE EXISTS (
     SELECT 1
       FROM public."SellerProfile" AS seller
      WHERE (
        seller."metroId" = candidates.id
        OR seller."cityMetroId" = candidates.id
      )
        AND seller."ownerAccountActive" = true
        AND seller."chargesEnabled" = true
        AND seller."stripeAccountSupported" = true
        AND seller."vacationMode" = false
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
   ORDER BY candidates.name ASC, candidates.slug ASC;
END
$grainline_seller_public_nearby_metros$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_metro_static_slugs()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_public_metro_makers(text, boolean, integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_public_nearby_metros(text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_public_metro_static_slugs()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_metro_makers(text, boolean, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_nearby_metros(text)
  TO grainline_app_runtime;

COMMIT;
