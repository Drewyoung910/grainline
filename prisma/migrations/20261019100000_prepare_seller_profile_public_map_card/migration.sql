-- Add the bounded public map-card authority.
--
-- The endpoint receives only presentation fields for an active, map-opted-in
-- seller plus the cover of its highest-quality public listing. Raw location,
-- ownership identifiers and control fields never leave this operation.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_map_card(
  p_seller_profile_id text
)
RETURNS TABLE (
  id text,
  "displayName" text,
  tagline text,
  city text,
  state text,
  "guildLevel" text,
  "isFoundingMaker" boolean,
  "foundingMakerNumber" integer,
  "avatarImageUrl" text,
  "bannerImageUrl" text,
  "ownerImageUrl" text,
  "coverImageUrl" text
)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_map_card$
  SELECT seller.id::text,
         seller."displayName"::text,
         seller.tagline::text,
         seller.city::text,
         seller.state::text,
         seller."guildLevel"::text,
         seller."isFoundingMaker",
         seller."foundingMakerNumber",
         seller."avatarImageUrl"::text,
         seller."bannerImageUrl"::text,
         seller."ownerImageUrl"::text,
         (
           SELECT (
             SELECT photo.url::text
               FROM public."Photo" AS photo
              WHERE photo."listingId" = listing.id
              ORDER BY photo."sortOrder" ASC
              LIMIT 1
           )
             FROM public."Listing" AS listing
            WHERE listing."sellerId" = seller.id
              AND listing.status::text = 'ACTIVE'
              AND listing."isPrivate" = false
              AND listing."archivedAt" IS NULL
            ORDER BY listing."qualityScore" DESC, listing.id DESC
            LIMIT 1
         ) AS "coverImageUrl"
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."publicMapOptIn" = true
   LIMIT 1
$grainline_seller_public_map_card$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_map_card(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_map_card(text)
  TO grainline_app_runtime;

COMMIT;
