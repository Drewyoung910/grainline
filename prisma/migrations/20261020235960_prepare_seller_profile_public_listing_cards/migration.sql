-- Return the bounded seller presentation attached to an exact set of public
-- listing cards. The listing and seller visibility checks stay inside one
-- authority, and authenticated calls apply reciprocal blocks in the same
-- database snapshot.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_listing_cards(
  p_listing_ids text[]
)
RETURNS TABLE (
  "listingId" text,
  "sellerProfileId" text,
  "displayName" text,
  "avatarImageUrl" text,
  "guildLevel" text,
  city text,
  state text,
  "acceptingNewOrders" boolean,
  "ownerImageUrl" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_listing_cards$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_listing_ids IS NULL
     OR pg_catalog.cardinality(p_listing_ids) < 1
     OR pg_catalog.cardinality(p_listing_ids) > 100
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
    RAISE EXCEPTION 'Seller public listing-card input is invalid'
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
    RAISE EXCEPTION 'Seller public listing-card viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT listing.id::text,
         seller.id::text,
         seller."displayName"::text,
         seller."avatarImageUrl"::text,
         seller."guildLevel"::text,
         seller.city::text,
         seller.state::text,
         seller."acceptingNewOrders",
         seller."ownerImageUrl"::text
    FROM pg_catalog.unnest(p_listing_ids)
         WITH ORDINALITY AS requested(id, position)
    JOIN public."Listing" AS listing
      ON listing.id = requested.id
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.status::text = 'ACTIVE'
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
   ORDER BY requested.position;
END
$grainline_seller_public_listing_cards$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_listing_cards(text[])
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_listing_cards(text[])
  TO grainline_app_runtime;

COMMIT;
