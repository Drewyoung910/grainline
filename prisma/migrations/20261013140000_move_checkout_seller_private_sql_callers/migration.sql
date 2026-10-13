-- Move checkout reservation seller provider and package reads to the private
-- companion installed by Phase 0. Public seller state and all reservation,
-- buyer, listing, stock and lock semantics remain unchanged. Existing function
-- signatures, owners and grants are preserved by CREATE OR REPLACE.

BEGIN;

DO $checkout_seller_private_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."SellerProfilePrivate"') IS NULL THEN
    RAISE EXCEPTION 'SellerProfilePrivate table is missing';
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.grainline_checkout_reservation_create_cart(text,text,text,text,text)'
  ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_checkout_reservation_create_single(text,text,integer,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_checkout_reservation_seller_witness(text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'checkout reservation predecessor function is missing';
  END IF;
END
$checkout_seller_private_preflight$;

-- Latest definition copied from 20260810190000_prepare_checkout_stock_reservation_authority; only private seller
-- provider/package sources move to the zero-direct companion.
CREATE OR REPLACE FUNCTION public.grainline_checkout_reservation_create_cart(
  p_buyer_id text,
  p_cart_id text,
  p_seller_profile_id text,
  p_checkout_group_id text,
  p_payload_hash text
)
RETURNS TABLE(reservation_id text, reserved_items jsonb, expires_at timestamp(3) without time zone)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_create_cart$
DECLARE
  source_id text := pg_catalog.gen_random_uuid()::text;
  source_items jsonb := '[]'::jsonb;
  source_seller_user_id text;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_expires timestamp(3) without time zone;
  source_item record;
  source_count bigint;
  updated_count integer;
BEGIN
  IF p_buyer_id IS NULL OR pg_catalog.char_length(p_buyer_id) NOT BETWEEN 1 AND 191
     OR p_cart_id IS NULL OR pg_catalog.char_length(p_cart_id) NOT BETWEEN 1 AND 191
     OR p_seller_profile_id IS NULL OR pg_catalog.char_length(p_seller_profile_id) NOT BETWEEN 1 AND 191
     OR p_payload_hash IS NULL OR p_payload_hash !~ '^[A-Za-z0-9_-]{32}$'
     OR (p_checkout_group_id IS NOT NULL AND pg_catalog.char_length(p_checkout_group_id) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'Cart checkout reservation input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT seller."userId"
    INTO source_seller_user_id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart checkout seller is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Account deletion takes User FOR UPDATE before scrubbing reservations and
  -- hiding listings. Lock buyer and seller in stable order first so creation
  -- either commits before that scrub or waits and observes terminal state.
  PERFORM actor.id
    FROM public."User" AS actor
   WHERE actor.id IN (p_buyer_id, source_seller_user_id)
   ORDER BY actor.id
   FOR KEY SHARE;

  PERFORM 1 FROM public."User" AS buyer
   WHERE buyer.id = p_buyer_id
     AND buyer."deletedAt" IS NULL
     AND buyer.banned = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart checkout buyer is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
    JOIN public."User" AS seller_user ON seller_user.id = seller."userId"
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = source_seller_user_id
     AND seller."userId" <> p_buyer_id
     AND seller_user."deletedAt" IS NULL
     AND seller_user.banned = false
     AND seller_private."stripeAccountId" IS NOT NULL
     AND seller."chargesEnabled" = true
     AND seller."vacationMode" = false
     AND seller."acceptingNewOrders" = true
     AND seller."stripeAccountSupported" = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart checkout seller is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."Cart" AS cart
   WHERE cart.id = p_cart_id
     AND cart."userId" = p_buyer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart checkout source is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."CartItem" AS cart_item
    JOIN public."Listing" AS listing ON listing.id = cart_item."listingId"
   WHERE cart_item."cartId" = p_cart_id
     AND listing."sellerId" = p_seller_profile_id
   ORDER BY listing.id, cart_item.id
   FOR UPDATE OF cart_item, listing;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart checkout has no items for seller'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pg_catalog.count(*)
    INTO STRICT source_count
    FROM public."CartItem" AS cart_item
    JOIN public."Listing" AS listing ON listing.id = cart_item."listingId"
   WHERE cart_item."cartId" = p_cart_id
     AND listing."sellerId" = p_seller_profile_id
     AND (
       cart_item.quantity < 1
       OR cart_item.quantity > 200
       OR listing.status <> 'ACTIVE'
       OR (listing."isPrivate" AND listing."reservedForUserId" IS DISTINCT FROM p_buyer_id)
     );
  IF source_count <> 0 THEN
    RAISE EXCEPTION 'Cart checkout contains an unavailable item'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'listingId', source.listing_id,
        'sellerId', p_seller_profile_id,
        'quantity', source.quantity
      ) ORDER BY source.listing_id
    ),
    '[]'::jsonb
  )
    INTO STRICT source_items
    FROM (
      SELECT listing.id AS listing_id, pg_catalog.sum(cart_item.quantity)::integer AS quantity
        FROM public."CartItem" AS cart_item
        JOIN public."Listing" AS listing ON listing.id = cart_item."listingId"
       WHERE cart_item."cartId" = p_cart_id
         AND listing."sellerId" = p_seller_profile_id
         AND listing."listingType" = 'IN_STOCK'
       GROUP BY listing.id
    ) AS source;

  source_expires := source_now + interval '31 minutes';
  INSERT INTO public."CheckoutStockReservation" (
    id, "checkoutLockKey", "checkoutGroupId", "payloadHash", "buyerId",
    "sellerId", status, "reservedItems", "expiresAt", "createdAt", "updatedAt"
  ) VALUES (
    source_id,
    'checkout:cart:' || p_cart_id || ':seller:' || p_seller_profile_id,
    p_checkout_group_id,
    p_payload_hash,
    p_buyer_id,
    p_seller_profile_id,
    'RESERVED',
    source_items,
    source_expires,
    source_now,
    source_now
  );

  FOR source_item IN
    SELECT item.value->>'listingId' AS listing_id,
           (item.value->>'quantity')::integer AS quantity
      FROM pg_catalog.jsonb_array_elements(source_items) AS item(value)
     ORDER BY item.value->>'listingId'
  LOOP
    UPDATE public."Listing" AS listing
       SET "stockQuantity" = listing."stockQuantity" - source_item.quantity
     WHERE listing.id = source_item.listing_id
       AND listing."sellerId" = p_seller_profile_id
       AND listing.status = 'ACTIVE'
       AND listing."listingType" = 'IN_STOCK'
       AND listing."stockQuantity" >= source_item.quantity;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count <> 1 THEN
      RAISE EXCEPTION 'Checkout stock is unavailable'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN QUERY SELECT source_id, source_items, source_expires;
END
$grainline_checkout_reservation_create_cart$;

-- Latest definition copied from 20260810190000_prepare_checkout_stock_reservation_authority; only private seller
-- provider/package sources move to the zero-direct companion.
CREATE OR REPLACE FUNCTION public.grainline_checkout_reservation_create_single(
  p_buyer_id text,
  p_listing_id text,
  p_quantity integer,
  p_payload_hash text
)
RETURNS TABLE(reservation_id text, reserved_items jsonb, expires_at timestamp(3) without time zone)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_create_single$
DECLARE
  source_listing public."Listing"%ROWTYPE;
  source_seller_id text;
  source_seller_user_id text;
  source_id text := pg_catalog.gen_random_uuid()::text;
  source_items jsonb;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_expires timestamp(3) without time zone;
  updated_count integer;
BEGIN
  IF p_buyer_id IS NULL OR pg_catalog.char_length(p_buyer_id) NOT BETWEEN 1 AND 191
     OR p_listing_id IS NULL OR pg_catalog.char_length(p_listing_id) NOT BETWEEN 1 AND 191
     OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 99
     OR p_payload_hash IS NULL OR p_payload_hash !~ '^[A-Za-z0-9_-]{32}$' THEN
    RAISE EXCEPTION 'Single checkout reservation input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT listing."sellerId"
    INTO source_seller_id
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Single checkout listing is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT seller."userId"
    INTO source_seller_user_id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = source_seller_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Single checkout seller is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM actor.id
    FROM public."User" AS actor
   WHERE actor.id IN (p_buyer_id, source_seller_user_id)
   ORDER BY actor.id
   FOR KEY SHARE;

  PERFORM 1 FROM public."User" AS buyer
   WHERE buyer.id = p_buyer_id AND buyer."deletedAt" IS NULL AND buyer.banned = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Single checkout buyer is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
    JOIN public."User" AS seller_user ON seller_user.id = seller."userId"
   WHERE seller.id = source_seller_id
     AND seller."userId" = source_seller_user_id
     AND seller."userId" <> p_buyer_id
     AND seller_user."deletedAt" IS NULL
     AND seller_user.banned = false
     AND seller_private."stripeAccountId" IS NOT NULL
     AND seller."chargesEnabled" = true
     AND seller."vacationMode" = false
     AND seller."acceptingNewOrders" = true
     AND seller."stripeAccountSupported" = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Single checkout seller is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT listing.*
    INTO STRICT source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
   FOR UPDATE;

  IF source_listing."sellerId" IS DISTINCT FROM source_seller_id
     OR source_listing.status <> 'ACTIVE'
     OR (source_listing."isPrivate" AND source_listing."reservedForUserId" IS DISTINCT FROM p_buyer_id) THEN
    RAISE EXCEPTION 'Single checkout listing is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF source_listing."listingType" <> 'IN_STOCK' THEN
    RETURN;
  END IF;

  source_items := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'listingId', source_listing.id,
    'sellerId', source_listing."sellerId",
    'quantity', p_quantity
  ));
  source_expires := source_now + interval '31 minutes';

  INSERT INTO public."CheckoutStockReservation" (
    id, "checkoutLockKey", "payloadHash", "buyerId", "sellerId", status,
    "reservedItems", "expiresAt", "createdAt", "updatedAt"
  ) VALUES (
    source_id,
    'checkout:single:' || p_buyer_id || ':listing:' || p_listing_id,
    p_payload_hash,
    p_buyer_id,
    source_listing."sellerId",
    'RESERVED',
    source_items,
    source_expires,
    source_now,
    source_now
  );

  UPDATE public."Listing" AS listing
     SET "stockQuantity" = listing."stockQuantity" - p_quantity
   WHERE listing.id = p_listing_id
     AND listing.status = 'ACTIVE'
     AND listing."listingType" = 'IN_STOCK'
     AND listing."stockQuantity" >= p_quantity;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Checkout stock is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY SELECT source_id, source_items, source_expires;
EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION 'Single checkout listing is unavailable'
      USING ERRCODE = 'check_violation';
END
$grainline_checkout_reservation_create_single$;

-- Latest definition copied from 20260814053000_prepare_checkout_stock_reservation_source_consistency; only private seller
-- provider/package sources move to the zero-direct companion.
CREATE OR REPLACE FUNCTION public.grainline_checkout_reservation_seller_witness(
  p_seller_profile_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_seller_witness$
  SELECT pg_catalog.jsonb_build_object(
    'id', seller.id,
    'userId', seller."userId",
    'displayName', seller."displayName",
    'stripeAccountId', seller_private."stripeAccountId",
    'stripeAccountVersion', seller_private."stripeAccountVersion",
    'chargesEnabled', seller."chargesEnabled",
    'vacationMode', seller."vacationMode",
    'acceptingNewOrders', seller."acceptingNewOrders",
    'allowLocalPickup', seller."allowLocalPickup",
    'offersGiftWrapping', seller."offersGiftWrapping",
    'giftWrappingPriceCents', seller."giftWrappingPriceCents",
    'defaultPkgWeightGrams', seller_private."defaultPkgWeightGrams",
    'defaultPkgLengthCm', seller_private."defaultPkgLengthCm",
    'defaultPkgWidthCm', seller_private."defaultPkgWidthCm",
    'defaultPkgHeightCm', seller_private."defaultPkgHeightCm",
    'userBanned', seller_user.banned,
    'userDeleted', seller_user."deletedAt" IS NOT NULL
  )
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
    JOIN public."User" AS seller_user ON seller_user.id = seller."userId"
   WHERE seller.id = p_seller_profile_id
$grainline_checkout_reservation_seller_witness$;

COMMIT;
