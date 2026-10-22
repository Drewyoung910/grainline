-- Purpose-bound seller state for authenticated cart, checkout, and shipping
-- flows. The listing projection is bound to one exact listing; the cart
-- projection is bound to the authenticated actor's exact cart and returns at
-- most one state row per seller represented by that cart.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_actor_listing_transaction_state(
  p_listing_id text
)
RETURNS TABLE (
  id text,
  "userId" text,
  "displayName" text,
  "chargesEnabled" boolean,
  "stripeAccountSupported" boolean,
  "ownerAccountActive" boolean,
  "vacationMode" boolean,
  "acceptingNewOrders" boolean,
  "freeShippingOverCents" integer,
  "shippingFlatRateCents" integer,
  "allowLocalPickup" boolean,
  "offersGiftWrapping" boolean,
  "giftWrappingPriceCents" integer
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_actor_listing_transaction_state$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller listing transaction-state input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id::text,
         seller."userId"::text,
         seller."displayName"::text,
         seller."chargesEnabled",
         seller."stripeAccountSupported",
         seller."ownerAccountActive",
         seller."vacationMode",
         seller."acceptingNewOrders",
         seller."freeShippingOverCents",
         seller."shippingFlatRateCents",
         seller."allowLocalPickup",
         seller."offersGiftWrapping",
         seller."giftWrappingPriceCents"
    FROM public."User" AS actor
    JOIN public."Listing" AS listing
      ON listing.id = p_listing_id
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   LIMIT 1;
END
$grainline_seller_actor_listing_transaction_state$;

CREATE OR REPLACE FUNCTION public.grainline_seller_actor_cart_transaction_states(
  p_cart_id text
)
RETURNS TABLE (
  id text,
  "userId" text,
  "displayName" text,
  "chargesEnabled" boolean,
  "stripeAccountSupported" boolean,
  "ownerAccountActive" boolean,
  "vacationMode" boolean,
  "acceptingNewOrders" boolean,
  "freeShippingOverCents" integer,
  "shippingFlatRateCents" integer,
  "allowLocalPickup" boolean,
  "offersGiftWrapping" boolean,
  "giftWrappingPriceCents" integer
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_actor_cart_transaction_states$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_cart_id IS NULL
     OR p_cart_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller cart transaction-state input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT DISTINCT
         seller.id::text,
         seller."userId"::text,
         seller."displayName"::text,
         seller."chargesEnabled",
         seller."stripeAccountSupported",
         seller."ownerAccountActive",
         seller."vacationMode",
         seller."acceptingNewOrders",
         seller."freeShippingOverCents",
         seller."shippingFlatRateCents",
         seller."allowLocalPickup",
         seller."offersGiftWrapping",
         seller."giftWrappingPriceCents"
    FROM public."User" AS actor
    JOIN public."Cart" AS cart
      ON cart.id = p_cart_id
     AND cart."userId" = actor_id
    JOIN public."CartItem" AS cart_item
      ON cart_item."cartId" = cart.id
    JOIN public."Listing" AS listing
      ON listing.id = cart_item."listingId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   ORDER BY seller.id;
END
$grainline_seller_actor_cart_transaction_states$;

REVOKE ALL ON FUNCTION public.grainline_seller_actor_listing_transaction_state(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_actor_cart_transaction_states(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_actor_listing_transaction_state(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_actor_cart_transaction_states(text)
  TO grainline_app_runtime;

COMMIT;
