-- Resolve the bounded similar-listing candidate set without giving the
-- ordinary runtime direct SellerProfile access. The function owns source and
-- candidate visibility, reciprocal blocks, photo selection and the reviewed
-- 24-row pre-score ordering used by the route.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_actor_similar_listing_candidates(
  p_listing_id text
)
RETURNS TABLE (
  "sourceTitle" text,
  "sourcePriceCents" integer,
  "listingId" text,
  title text,
  "priceCents" integer,
  currency text,
  status text,
  "listingType" text,
  "stockQuantity" integer,
  "photoUrl" text,
  "photoAltText" text,
  "secondPhotoUrl" text,
  "secondPhotoAltText" text,
  "sellerDisplayName" text,
  "sellerAvatarImageUrl" text,
  "sellerGuildLevel" text,
  "sellerProfileId" text,
  "sellerCity" text,
  "sellerState" text,
  "sellerAcceptingNewOrders" boolean,
  "createdAt" timestamp without time zone,
  "tagOverlap" bigint,
  "categoryMatch" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_actor_similar_listing_candidates$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller similar-listing input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF request_user_id IS NOT NULL
     AND (
       request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1
           FROM public."User" AS viewer
          WHERE viewer.id = request_user_id
            AND viewer.banned = false
            AND viewer."deletedAt" IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Seller similar-listing viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH source_listing AS MATERIALIZED (
    SELECT source.id,
           source.title,
           source."priceCents",
           source.category::text AS category,
           source.tags,
           source."sellerId"
      FROM public."Listing" AS source
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source."sellerId"
     WHERE source.id = p_listing_id
       AND source.status::text = 'ACTIVE'
       AND source."isPrivate" = false
       AND source."archivedAt" IS NULL
       AND source_seller."ownerAccountActive" = true
       AND source_seller."chargesEnabled" = true
       AND source_seller."stripeAccountSupported" = true
       AND source_seller."vacationMode" = false
  )
  SELECT source.title::text,
         source."priceCents",
         listing.id::text,
         listing.title::text,
         listing."priceCents",
         listing.currency::text,
         listing.status::text,
         listing."listingType"::text,
         listing."stockQuantity",
         listing_photos."photoUrl"::text,
         listing_photos."photoAltText"::text,
         listing_photos."secondPhotoUrl"::text,
         listing_photos."secondPhotoAltText"::text,
         seller."displayName"::text,
         seller."avatarImageUrl"::text,
         seller."guildLevel"::text,
         seller.id::text,
         seller.city::text,
         seller.state::text,
         seller."acceptingNewOrders",
         listing."createdAt",
         COALESCE((
           SELECT pg_catalog.count(*)
             FROM pg_catalog.unnest(listing.tags) AS candidate_tag(tag)
            WHERE candidate_tag.tag = ANY(source.tags)
         ), 0)::bigint,
         listing.category::text = COALESCE(source.category, 'OTHER')
    FROM source_listing AS source
    JOIN public."Listing" AS listing
      ON listing.id <> source.id
     AND listing."sellerId" <> source."sellerId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    LEFT JOIN LATERAL (
      SELECT MAX(photo_rows.url) FILTER (WHERE photo_rows.row_number = 1) AS "photoUrl",
             MAX(photo_rows."altText") FILTER (WHERE photo_rows.row_number = 1) AS "photoAltText",
             MAX(photo_rows.url) FILTER (WHERE photo_rows.row_number = 2) AS "secondPhotoUrl",
             MAX(photo_rows."altText") FILTER (WHERE photo_rows.row_number = 2) AS "secondPhotoAltText"
        FROM (
          SELECT photo.url,
                 photo."altText",
                 pg_catalog.row_number() OVER (
                   ORDER BY photo."sortOrder" ASC, photo.id ASC
                 ) AS row_number
            FROM public."Photo" AS photo
           WHERE photo."listingId" = listing.id
           ORDER BY photo."sortOrder" ASC, photo.id ASC
           LIMIT 2
        ) AS photo_rows
    ) AS listing_photos ON true
   WHERE listing.status::text = 'ACTIVE'
     AND listing."isPrivate" = false
     AND listing."archivedAt" IS NULL
     AND listing."priceCents" BETWEEN
         pg_catalog.floor(source."priceCents" * 0.1)::integer
         AND pg_catalog.ceil(source."priceCents" * 10.0)::integer
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
   ORDER BY
     (listing.category::text = COALESCE(source.category, 'OTHER')) DESC,
     COALESCE((
       SELECT pg_catalog.count(*)
         FROM pg_catalog.unnest(listing.tags) AS candidate_tag(tag)
        WHERE candidate_tag.tag = ANY(source.tags)
     ), 0) DESC,
     pg_catalog.abs(listing."priceCents" - source."priceCents") ASC,
     listing."createdAt" DESC,
     listing.id DESC
   LIMIT 24;
END
$grainline_seller_actor_similar_listing_candidates$;

REVOKE ALL ON FUNCTION public.grainline_seller_actor_similar_listing_candidates(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_actor_similar_listing_candidates(text)
  TO grainline_app_runtime;

COMMIT;
