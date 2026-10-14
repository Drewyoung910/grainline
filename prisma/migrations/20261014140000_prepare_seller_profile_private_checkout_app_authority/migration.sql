-- Purpose-bound checkout access to private seller provider/package state.
-- Runtime must present an active buyer, the exact seller, and exactly one
-- eligible listing or buyer-owned cart context.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_checkout_private_state(
  p_buyer_user_id text,
  p_seller_profile_id text,
  p_cart_id text,
  p_listing_id text
)
RETURNS TABLE (
  id text,
  "stripeAccountId" text,
  "stripeAccountVersion" text,
  "defaultPkgWeightGrams" integer,
  "defaultPkgLengthCm" double precision,
  "defaultPkgWidthCm" double precision,
  "defaultPkgHeightCm" double precision
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_checkout_private_state$
BEGIN
  IF p_buyer_user_id IS NULL
     OR p_buyer_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_cart_id IS NULL) = (p_listing_id IS NULL)
     OR (p_cart_id IS NOT NULL AND p_cart_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR (p_listing_id IS NOT NULL AND p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$') THEN
    RAISE EXCEPTION 'Seller checkout private-state input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller_private."stripeAccountId"::text,
         seller_private."stripeAccountVersion"::text,
         seller_private."defaultPkgWeightGrams",
         seller_private."defaultPkgLengthCm",
         seller_private."defaultPkgWidthCm",
         seller_private."defaultPkgHeightCm"
    FROM public."User" AS buyer
    JOIN public."SellerProfile" AS seller
      ON seller.id = p_seller_profile_id
    JOIN public."User" AS seller_user
      ON seller_user.id = seller."userId"
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE buyer.id = p_buyer_user_id
     AND buyer.banned = false
     AND buyer."deletedAt" IS NULL
     AND seller_user.id <> buyer.id
     AND seller_user.banned = false
     AND seller_user."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."acceptingNewOrders" = true
     AND seller_private."stripeAccountId" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS user_block
        WHERE (user_block."blockerId" = buyer.id
               AND user_block."blockedId" = seller_user.id)
           OR (user_block."blockerId" = seller_user.id
               AND user_block."blockedId" = buyer.id)
     )
     AND (
       (
         p_listing_id IS NOT NULL
         AND EXISTS (
           SELECT 1
             FROM public."Listing" AS listing
            WHERE listing.id = p_listing_id
              AND listing."sellerId" = seller.id
              AND listing.status::text = 'ACTIVE'
              AND listing."archivedAt" IS NULL
              AND (listing."isPrivate" = false
                   OR listing."reservedForUserId" = buyer.id)
         )
       )
       OR
       (
         p_cart_id IS NOT NULL
         AND EXISTS (
           SELECT 1
             FROM public."Cart" AS cart
             JOIN public."CartItem" AS cart_item
               ON cart_item."cartId" = cart.id
             JOIN public."Listing" AS listing
               ON listing.id = cart_item."listingId"
            WHERE cart.id = p_cart_id
              AND cart."userId" = buyer.id
              AND listing."sellerId" = seller.id
         )
         AND NOT EXISTS (
           SELECT 1
             FROM public."Cart" AS cart
             JOIN public."CartItem" AS cart_item
               ON cart_item."cartId" = cart.id
             JOIN public."Listing" AS listing
               ON listing.id = cart_item."listingId"
            WHERE cart.id = p_cart_id
              AND cart."userId" = buyer.id
              AND listing."sellerId" = seller.id
              AND (
                listing.status::text <> 'ACTIVE'
                OR listing."archivedAt" IS NOT NULL
                OR (listing."isPrivate" = true
                    AND listing."reservedForUserId" IS DISTINCT FROM buyer.id)
                OR (listing."listingType"::text = 'MADE_TO_ORDER'
                    AND cart_item.quantity <> 1)
                OR (listing."listingType"::text = 'IN_STOCK'
                    AND (listing."stockQuantity" IS NULL
                         OR listing."stockQuantity" <= 0
                         OR cart_item.quantity > listing."stockQuantity"))
              )
         )
       )
     );
END
$grainline_seller_checkout_private_state$;

REVOKE ALL ON FUNCTION public.grainline_seller_checkout_private_state(text, text, text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_checkout_private_state(text, text, text, text)
  TO grainline_app_runtime;

COMMIT;
