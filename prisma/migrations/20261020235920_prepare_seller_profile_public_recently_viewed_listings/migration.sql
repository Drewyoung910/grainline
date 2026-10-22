-- Return the bounded listing and maker presentation fields used by the
-- recently-viewed tray. Authenticated callers are filtered through reciprocal
-- blocks inside the same authority; signed-out callers see only public,
-- orderable listings.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_recently_viewed_listings(
  p_listing_ids text[]
)
RETURNS TABLE (
  id text,
  title text,
  "priceCents" integer,
  currency text,
  "photoUrl" text,
  "sellerDisplayName" text,
  "sellerAvatarImageUrl" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_recently_viewed_listings$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_listing_ids IS NULL
     OR pg_catalog.cardinality(p_listing_ids) < 1
     OR pg_catalog.cardinality(p_listing_ids) > 10
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR requested.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'Seller public recently-viewed listing input is invalid'
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
    RAISE EXCEPTION 'Seller public recently-viewed viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT listing.id::text,
         listing.title::text,
         listing."priceCents",
         listing.currency::text,
         (
           SELECT photo.url::text
             FROM public."Photo" AS photo
            WHERE photo."listingId" = listing.id
            ORDER BY photo."sortOrder" ASC
            LIMIT 1
         ) AS "photoUrl",
         seller."displayName"::text,
         COALESCE(
           seller."avatarImageUrl"::text,
           seller."ownerImageUrl"::text
         ) AS "sellerAvatarImageUrl"
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = ANY(p_listing_ids)
     AND listing.status::text = 'ACTIVE'
     AND listing."isPrivate" = false
     AND listing."archivedAt" IS NULL
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
   ORDER BY pg_catalog.array_position(p_listing_ids, listing.id::text), listing.id;
END
$grainline_seller_public_recently_viewed_listings$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_recently_viewed_listings(text[])
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_recently_viewed_listings(text[])
  TO grainline_app_runtime;

COMMIT;
