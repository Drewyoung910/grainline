-- Replace the public maker profile and shop-header broad SellerProfile reads
-- with one viewer-aware, bounded projection. Owners retain their disabled-shop
-- preview, public callers receive only public-safe fields, and authenticated
-- non-owners are denied across reciprocal blocks.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_profile(
  p_seller_profile_id text
)
RETURNS TABLE (
  id text,
  "displayName" text,
  bio text,
  city text,
  state text,
  "createdAt" timestamp(3) without time zone,
  "allowLocalPickup" boolean,
  tagline text,
  "bannerImageUrl" text,
  "avatarImageUrl" text,
  "workshopImageUrl" text,
  "storyTitle" text,
  "storyBody" text,
  "instagramUrl" text,
  "facebookUrl" text,
  "pinterestUrl" text,
  "tiktokUrl" text,
  "websiteUrl" text,
  "yearsInBusiness" integer,
  "acceptsCustomOrders" boolean,
  "acceptingNewOrders" boolean,
  "returnPolicy" text,
  "customOrderPolicy" text,
  "shippingPolicy" text,
  "featuredListingIds" text[],
  "galleryImageUrls" text[],
  "galleryAltTexts" text[],
  "guildLevel" text,
  "vacationMode" boolean,
  "vacationReturnDate" timestamp(3) without time zone,
  "vacationMessage" text,
  "isFoundingMaker" boolean,
  "foundingMakerNumber" integer,
  "ownerImageUrl" text,
  "viewerIsOwner" boolean,
  faqs jsonb,
  metro jsonb,
  "cityMetro" jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_profile$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller public profile target is invalid'
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
    RAISE EXCEPTION 'Seller public profile viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id::text,
         seller."displayName"::text,
         seller.bio::text,
         seller.city::text,
         seller.state::text,
         seller."createdAt",
         seller."allowLocalPickup",
         seller.tagline::text,
         seller."bannerImageUrl"::text,
         seller."avatarImageUrl"::text,
         seller."workshopImageUrl"::text,
         seller."storyTitle"::text,
         seller."storyBody"::text,
         seller."instagramUrl"::text,
         seller."facebookUrl"::text,
         seller."pinterestUrl"::text,
         seller."tiktokUrl"::text,
         seller."websiteUrl"::text,
         seller."yearsInBusiness",
         seller."acceptsCustomOrders",
         seller."acceptingNewOrders",
         seller."returnPolicy"::text,
         seller."customOrderPolicy"::text,
         seller."shippingPolicy"::text,
         seller."featuredListingIds",
         seller."galleryImageUrls",
         seller."galleryAltTexts",
         seller."guildLevel"::text,
         seller."vacationMode",
         seller."vacationReturnDate",
         seller."vacationMessage"::text,
         seller."isFoundingMaker",
         seller."foundingMakerNumber",
         seller."ownerImageUrl"::text,
         COALESCE(request_user_id = seller."userId", false) AS "viewerIsOwner",
         COALESCE(
           (
             SELECT pg_catalog.jsonb_agg(
                      pg_catalog.jsonb_build_object(
                        'id', faq.id,
                        'question', faq.question,
                        'answer', faq.answer
                      )
                      ORDER BY faq."sortOrder", faq.id
                    )
               FROM public."SellerFaq" AS faq
              WHERE faq."sellerProfileId" = seller.id
           ),
           '[]'::jsonb
         ) AS faqs,
         CASE
           WHEN metro.id IS NULL THEN NULL
           ELSE pg_catalog.jsonb_build_object(
             'slug', metro.slug,
             'name', metro.name,
             'state', metro.state
           )
         END AS metro,
         CASE
           WHEN city_metro.id IS NULL THEN NULL
           ELSE pg_catalog.jsonb_build_object(
             'slug', city_metro.slug,
             'name', city_metro.name,
             'state', city_metro.state
           )
         END AS "cityMetro"
    FROM public."SellerProfile" AS seller
    LEFT JOIN public."Metro" AS metro
      ON metro.id = seller."metroId"
    LEFT JOIN public."Metro" AS city_metro
      ON city_metro.id = seller."cityMetroId"
   WHERE seller.id = p_seller_profile_id
     AND seller."ownerAccountActive" = true
     AND (
       request_user_id = seller."userId"
       OR (
         seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
       )
     )
     AND (
       request_user_id IS NULL
       OR request_user_id = seller."userId"
       OR NOT EXISTS (
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
     )
   LIMIT 1;
END
$grainline_seller_public_profile$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_profile(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_profile(text)
  TO grainline_app_runtime;

COMMIT;
