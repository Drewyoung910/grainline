-- Resolve the seller presentation for one listing-detail page without giving
-- either runtime role direct SellerProfile table access. Ordinary callers use
-- transaction-local actor context; staff previews use the isolated staff
-- session only after the application verifies the staff PIN.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_actor_listing_detail_profile(
  p_listing_id text
)
RETURNS TABLE (
  "listingId" text,
  "sellerProfileId" text,
  "sellerUserId" text,
  "displayName" text,
  city text,
  state text,
  "allowLocalPickup" boolean,
  "chargesEnabled" boolean,
  "stripeAccountSupported" boolean,
  "vacationMode" boolean,
  "acceptingNewOrders" boolean,
  "acceptsCustomOrders" boolean,
  "offersGiftWrapping" boolean,
  "giftWrappingPriceCents" integer,
  "returnPolicy" text,
  "shippingPolicy" text,
  "customOrderPolicy" text,
  tagline text,
  "avatarImageUrl" text,
  "guildLevel" text,
  "isFoundingMaker" boolean,
  "foundingMakerNumber" integer,
  "ownerAccountActive" boolean,
  "ownerImageUrl" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_actor_listing_detail_profile$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller listing-detail input is invalid'
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
    RAISE EXCEPTION 'Seller listing-detail viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT listing.id::text,
         seller.id::text,
         seller."userId"::text,
         seller."displayName"::text,
         seller.city::text,
         seller.state::text,
         seller."allowLocalPickup",
         seller."chargesEnabled",
         seller."stripeAccountSupported",
         seller."vacationMode",
         seller."acceptingNewOrders",
         seller."acceptsCustomOrders",
         seller."offersGiftWrapping",
         seller."giftWrappingPriceCents",
         seller."returnPolicy"::text,
         seller."shippingPolicy"::text,
         seller."customOrderPolicy"::text,
         seller.tagline::text,
         seller."avatarImageUrl"::text,
         seller."guildLevel"::text,
         seller."isFoundingMaker",
         seller."foundingMakerNumber",
         seller."ownerAccountActive",
         seller."ownerImageUrl"::text
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
     AND listing."archivedAt" IS NULL
     AND (
       (
         listing.status::text IN ('ACTIVE', 'SOLD_OUT')
         AND listing."isPrivate" = false
         AND seller."ownerAccountActive" = true
         AND seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
         AND seller."vacationMode" = false
       )
       OR (
         request_user_id IS NOT NULL
         AND seller."userId" = request_user_id
       )
       OR (
         request_user_id IS NOT NULL
         AND listing.status::text IN ('ACTIVE', 'SOLD')
         AND listing."isPrivate" = true
         AND listing."reservedForUserId" = request_user_id
         AND seller."ownerAccountActive" = true
         AND seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
         AND seller."vacationMode" = false
       )
     )
     AND (
       request_user_id IS NULL
       OR seller."userId" = request_user_id
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
     );
END
$grainline_seller_actor_listing_detail_profile$;

CREATE OR REPLACE FUNCTION public.grainline_seller_staff_listing_detail_profile(
  p_actor_id text,
  p_listing_id text
)
RETURNS TABLE (
  "listingId" text,
  "sellerProfileId" text,
  "sellerUserId" text,
  "displayName" text,
  city text,
  state text,
  "allowLocalPickup" boolean,
  "chargesEnabled" boolean,
  "stripeAccountSupported" boolean,
  "vacationMode" boolean,
  "acceptingNewOrders" boolean,
  "acceptsCustomOrders" boolean,
  "offersGiftWrapping" boolean,
  "giftWrappingPriceCents" integer,
  "returnPolicy" text,
  "shippingPolicy" text,
  "customOrderPolicy" text,
  tagline text,
  "avatarImageUrl" text,
  "guildLevel" text,
  "isFoundingMaker" boolean,
  "foundingMakerNumber" integer,
  "ownerAccountActive" boolean,
  "ownerImageUrl" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_listing_detail_profile$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller listing-detail staff preview requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller listing-detail staff input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = p_actor_id
       AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller listing-detail staff actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT listing.id::text,
         seller.id::text,
         seller."userId"::text,
         seller."displayName"::text,
         seller.city::text,
         seller.state::text,
         seller."allowLocalPickup",
         seller."chargesEnabled",
         seller."stripeAccountSupported",
         seller."vacationMode",
         seller."acceptingNewOrders",
         seller."acceptsCustomOrders",
         seller."offersGiftWrapping",
         seller."giftWrappingPriceCents",
         seller."returnPolicy"::text,
         seller."shippingPolicy"::text,
         seller."customOrderPolicy"::text,
         seller.tagline::text,
         seller."avatarImageUrl"::text,
         seller."guildLevel"::text,
         seller."isFoundingMaker",
         seller."foundingMakerNumber",
         seller."ownerAccountActive",
         seller."ownerImageUrl"::text
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
     AND listing."archivedAt" IS NULL;
END
$grainline_seller_staff_listing_detail_profile$;

REVOKE ALL ON FUNCTION public.grainline_seller_actor_listing_detail_profile(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_actor_listing_detail_profile(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_seller_staff_listing_detail_profile(text,text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_listing_detail_profile(text,text)
  TO grainline_staff_read_runtime;

COMMIT;
