-- One-statement successor for the rejected multi-round-trip checkout source
-- transaction. These wrappers retain the compatible creation functions as the
-- reservation authority, then independently rebuild and compare the complete
-- Stripe-bound source while every mutable dependency remains locked.

CREATE FUNCTION public.grainline_checkout_reservation_seller_witness(
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
    'stripeAccountId', seller."stripeAccountId",
    'stripeAccountVersion', seller."stripeAccountVersion",
    'chargesEnabled', seller."chargesEnabled",
    'vacationMode', seller."vacationMode",
    'acceptingNewOrders', seller."acceptingNewOrders",
    'allowLocalPickup', seller."allowLocalPickup",
    'offersGiftWrapping', seller."offersGiftWrapping",
    'giftWrappingPriceCents', seller."giftWrappingPriceCents",
    'defaultPkgWeightGrams', seller."defaultPkgWeightGrams",
    'defaultPkgLengthCm', seller."defaultPkgLengthCm",
    'defaultPkgWidthCm', seller."defaultPkgWidthCm",
    'defaultPkgHeightCm', seller."defaultPkgHeightCm",
    'userBanned', seller_user.banned,
    'userDeleted', seller_user."deletedAt" IS NOT NULL
  )
    FROM public."SellerProfile" AS seller
    JOIN public."User" AS seller_user ON seller_user.id = seller."userId"
   WHERE seller.id = p_seller_profile_id
$grainline_checkout_reservation_seller_witness$;

CREATE FUNCTION public.grainline_checkout_reservation_listing_witness(
  p_listing_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_listing_witness$
  SELECT pg_catalog.jsonb_build_object(
    'id', listing.id,
    'sellerId', listing."sellerId",
    'title', listing.title,
    'priceCents', listing."priceCents",
    'priceVersion', listing."priceVersion",
    'currency', listing.currency,
    'status', listing.status,
    'listingType', listing."listingType",
    'isPrivate', listing."isPrivate",
    'reservedForUserId', listing."reservedForUserId",
    'packagedWeightGrams', listing."packagedWeightGrams",
    'packagedLengthCm', listing."packagedLengthCm",
    'packagedWidthCm', listing."packagedWidthCm",
    'packagedHeightCm', listing."packagedHeightCm",
    'imageUrl', (
      SELECT photo.url
        FROM public."Photo" AS photo
       WHERE photo."listingId" = listing.id
       ORDER BY photo."sortOrder", photo.id
       LIMIT 1
    ),
    'variantGroups', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', variant_group.id,
          'name', variant_group.name,
          'options', COALESCE((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'id', variant_option.id,
                'label', variant_option.label,
                'priceAdjustCents', variant_option."priceAdjustCents",
                'inStock', variant_option."inStock"
              ) ORDER BY variant_option.id COLLATE "C"
            )
              FROM public."ListingVariantOption" AS variant_option
             WHERE variant_option."groupId" = variant_group.id
          ), '[]'::jsonb)
        ) ORDER BY variant_group.id COLLATE "C"
      )
        FROM public."ListingVariantGroup" AS variant_group
       WHERE variant_group."listingId" = listing.id
    ), '[]'::jsonb)
  )
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
$grainline_checkout_reservation_listing_witness$;

CREATE FUNCTION public.grainline_checkout_reservation_variant_source_valid(
  p_listing_id text,
  p_selected_option_ids text[],
  p_expected_unit_price integer
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_variant_source_valid$
  SELECT COALESCE((
    SELECT
      p_selected_option_ids IS NOT NULL
      AND pg_catalog.cardinality(p_selected_option_ids) BETWEEN 0 AND 3
      AND input_ids.input_count = pg_catalog.cardinality(p_selected_option_ids)
      AND group_stats.group_count = pg_catalog.cardinality(p_selected_option_ids)
      AND selected_stats.selected_count = pg_catalog.cardinality(p_selected_option_ids)
      AND selected_stats.selected_group_count = group_stats.group_count
      AND selected_stats.all_in_stock
      AND listing."priceCents" + selected_stats.price_adjustment BETWEEN 1 AND 10000000
      AND (
        p_expected_unit_price IS NULL
        OR p_expected_unit_price = listing."priceCents" + selected_stats.price_adjustment
      )
    FROM public."Listing" AS listing
    CROSS JOIN LATERAL (
      SELECT pg_catalog.count(DISTINCT source.option_id)::integer AS input_count
        FROM pg_catalog.unnest(p_selected_option_ids) AS source(option_id)
       WHERE source.option_id IS NOT NULL
         AND pg_catalog.char_length(source.option_id) BETWEEN 1 AND 191
    ) AS input_ids
    CROSS JOIN LATERAL (
      SELECT pg_catalog.count(*)::integer AS group_count
        FROM public."ListingVariantGroup" AS variant_group
       WHERE variant_group."listingId" = listing.id
    ) AS group_stats
    CROSS JOIN LATERAL (
      SELECT
        pg_catalog.count(*)::integer AS selected_count,
        pg_catalog.count(DISTINCT variant_option."groupId")::integer AS selected_group_count,
        COALESCE(pg_catalog.bool_and(variant_option."inStock"), true) AS all_in_stock,
        COALESCE(pg_catalog.sum(variant_option."priceAdjustCents"), 0)::integer AS price_adjustment
      FROM public."ListingVariantOption" AS variant_option
      JOIN public."ListingVariantGroup" AS variant_group
        ON variant_group.id = variant_option."groupId"
       AND variant_group."listingId" = listing.id
      WHERE variant_option.id = ANY(p_selected_option_ids)
    ) AS selected_stats
    WHERE listing.id = p_listing_id
  ), false)
$grainline_checkout_reservation_variant_source_valid$;

REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_seller_witness(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_listing_witness(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_variant_source_valid(text, text[], integer)
  FROM PUBLIC, grainline_app_runtime;

CREATE FUNCTION public.grainline_checkout_reservation_create_cart_consistent(
  p_buyer_id text,
  p_cart_id text,
  p_seller_profile_id text,
  p_checkout_group_id text,
  p_payload_hash text,
  p_expected_source jsonb
)
RETURNS TABLE(reservation_id text, reserved_items jsonb, expires_at timestamp(3) without time zone)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_create_cart_consistent$
DECLARE
  source_seller_user_id text;
  source_reservation_id text;
  source_reserved_items jsonb;
  source_expires_at timestamp(3) without time zone;
  source_witness jsonb;
  source_expected_inventory jsonb;
  source_invalid_count bigint;
BEGIN
  IF p_expected_source IS NULL
     OR pg_catalog.jsonb_typeof(p_expected_source) <> 'object'
     OR pg_catalog.pg_column_size(p_expected_source) > 1048576 THEN
    RAISE EXCEPTION 'Checkout source witness is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT seller."userId"
    INTO STRICT source_seller_user_id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id;

  -- Acquire the stronger user locks before the compatible function touches a
  -- Cart or Listing. This preserves the account-deletion User-first order and
  -- avoids a queued FOR UPDATE deadlock during a later lock upgrade.
  PERFORM actor.id
    FROM public."User" AS actor
   WHERE actor.id IN (p_buyer_id, source_seller_user_id)
   ORDER BY actor.id
   FOR SHARE;

  PERFORM seller.id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = source_seller_user_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout source witness changed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT created.reservation_id, created.reserved_items, created.expires_at
    INTO STRICT source_reservation_id, source_reserved_items, source_expires_at
    FROM public.grainline_checkout_reservation_create_cart(
      p_buyer_id,
      p_cart_id,
      p_seller_profile_id,
      p_checkout_group_id,
      p_payload_hash
    ) AS created;

  -- Listing edits take the parent Listing lock before changing photos or the
  -- variant graph. The compatible function already holds every target Listing
  -- FOR UPDATE; these child locks cover any narrower maintenance writer too.
  PERFORM photo.id
    FROM public."Photo" AS photo
    JOIN public."Listing" AS listing ON listing.id = photo."listingId"
    JOIN public."CartItem" AS cart_item ON cart_item."listingId" = listing.id
   WHERE cart_item."cartId" = p_cart_id
     AND listing."sellerId" = p_seller_profile_id
   ORDER BY listing.id, photo.id
   FOR SHARE OF photo;

  PERFORM variant_group.id
    FROM public."ListingVariantGroup" AS variant_group
    JOIN public."Listing" AS listing ON listing.id = variant_group."listingId"
    JOIN public."CartItem" AS cart_item ON cart_item."listingId" = listing.id
   WHERE cart_item."cartId" = p_cart_id
     AND listing."sellerId" = p_seller_profile_id
   ORDER BY listing.id, variant_group.id
   FOR SHARE OF variant_group;

  PERFORM variant_option.id
    FROM public."ListingVariantOption" AS variant_option
    JOIN public."ListingVariantGroup" AS variant_group ON variant_group.id = variant_option."groupId"
    JOIN public."Listing" AS listing ON listing.id = variant_group."listingId"
    JOIN public."CartItem" AS cart_item ON cart_item."listingId" = listing.id
   WHERE cart_item."cartId" = p_cart_id
     AND listing."sellerId" = p_seller_profile_id
   ORDER BY listing.id, variant_group.id, variant_option.id
   FOR SHARE OF variant_option;

  PERFORM 1
    FROM public."User" AS buyer
   WHERE buyer.id = p_buyer_id
     AND buyer."deletedAt" IS NULL
     AND buyer.banned = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout source witness changed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT pg_catalog.count(*)
    INTO STRICT source_invalid_count
    FROM public."CartItem" AS cart_item
    JOIN public."Listing" AS listing ON listing.id = cart_item."listingId"
   WHERE cart_item."cartId" = p_cart_id
     AND listing."sellerId" = p_seller_profile_id
     AND (
       (listing."listingType" = 'MADE_TO_ORDER' AND cart_item.quantity <> 1)
       OR NOT public.grainline_checkout_reservation_variant_source_valid(
         listing.id,
         cart_item."selectedVariantOptionIds",
         cart_item."priceCents"
       )
       OR cart_item."priceVersion" IS DISTINCT FROM listing."priceVersion"
     );
  IF source_invalid_count <> 0 THEN
    RAISE EXCEPTION 'Checkout source witness changed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'listingId', inventory.listing_id,
      'sellerId', p_seller_profile_id,
      'quantity', inventory.quantity
    ) ORDER BY inventory.listing_id COLLATE "C"
  ), '[]'::jsonb)
    INTO STRICT source_expected_inventory
    FROM (
      SELECT listing.id AS listing_id, pg_catalog.sum(cart_item.quantity)::integer AS quantity
        FROM public."CartItem" AS cart_item
        JOIN public."Listing" AS listing ON listing.id = cart_item."listingId"
       WHERE cart_item."cartId" = p_cart_id
         AND listing."sellerId" = p_seller_profile_id
         AND listing."listingType" = 'IN_STOCK'
       GROUP BY listing.id
    ) AS inventory;
  IF source_reserved_items IS DISTINCT FROM source_expected_inventory THEN
    RAISE EXCEPTION 'Checkout reservation inventory derivation mismatch'
      USING ERRCODE = 'internal_error';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'seller', public.grainline_checkout_reservation_seller_witness(p_seller_profile_id),
    'items', COALESCE(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'cartItemId', cart_item.id,
        'listingId', cart_item."listingId",
        'quantity', cart_item.quantity,
        'storedPriceCents', cart_item."priceCents",
        'storedPriceVersion', cart_item."priceVersion",
        'selectedVariantOptionIds', pg_catalog.to_jsonb(cart_item."selectedVariantOptionIds"),
        'listing', public.grainline_checkout_reservation_listing_witness(cart_item."listingId")
      ) ORDER BY cart_item.id COLLATE "C"
    ), '[]'::jsonb)
  )
    INTO STRICT source_witness
    FROM public."CartItem" AS cart_item
    JOIN public."Listing" AS listing ON listing.id = cart_item."listingId"
   WHERE cart_item."cartId" = p_cart_id
     AND listing."sellerId" = p_seller_profile_id;

  IF source_witness IS DISTINCT FROM p_expected_source THEN
    RAISE EXCEPTION 'Checkout source witness changed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN QUERY SELECT source_reservation_id, source_reserved_items, source_expires_at;
EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION 'Checkout source witness changed'
      USING ERRCODE = 'serialization_failure';
END
$grainline_checkout_reservation_create_cart_consistent$;

CREATE FUNCTION public.grainline_checkout_reservation_create_single_consistent(
  p_buyer_id text,
  p_listing_id text,
  p_quantity integer,
  p_selected_variant_option_ids text[],
  p_payload_hash text,
  p_expected_source jsonb
)
RETURNS TABLE(reservation_id text, reserved_items jsonb, expires_at timestamp(3) without time zone)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_create_single_consistent$
DECLARE
  source_seller_id text;
  source_seller_user_id text;
  source_reservation_id text;
  source_reserved_items jsonb;
  source_expires_at timestamp(3) without time zone;
  source_witness jsonb;
  source_has_reservation boolean := false;
  source_listing_type text;
BEGIN
  IF p_expected_source IS NULL
     OR pg_catalog.jsonb_typeof(p_expected_source) <> 'object'
     OR pg_catalog.pg_column_size(p_expected_source) > 131072
     OR p_selected_variant_option_ids IS NULL
     OR pg_catalog.cardinality(p_selected_variant_option_ids) NOT BETWEEN 0 AND 3 THEN
    RAISE EXCEPTION 'Checkout source witness is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT listing."sellerId", seller."userId"
    INTO STRICT source_seller_id, source_seller_user_id
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id;

  PERFORM actor.id
    FROM public."User" AS actor
   WHERE actor.id IN (p_buyer_id, source_seller_user_id)
   ORDER BY actor.id
   FOR SHARE;

  PERFORM seller.id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = source_seller_id
     AND seller."userId" = source_seller_user_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout source witness changed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT created.reservation_id, created.reserved_items, created.expires_at
    INTO source_reservation_id, source_reserved_items, source_expires_at
    FROM public.grainline_checkout_reservation_create_single(
      p_buyer_id,
      p_listing_id,
      p_quantity,
      p_payload_hash
    ) AS created;
  source_has_reservation := FOUND;

  PERFORM photo.id
    FROM public."Photo" AS photo
   WHERE photo."listingId" = p_listing_id
   ORDER BY photo.id
   FOR SHARE;

  PERFORM variant_group.id
    FROM public."ListingVariantGroup" AS variant_group
   WHERE variant_group."listingId" = p_listing_id
   ORDER BY variant_group.id
   FOR SHARE;

  PERFORM variant_option.id
    FROM public."ListingVariantOption" AS variant_option
    JOIN public."ListingVariantGroup" AS variant_group ON variant_group.id = variant_option."groupId"
   WHERE variant_group."listingId" = p_listing_id
   ORDER BY variant_group.id, variant_option.id
   FOR SHARE OF variant_option;

  PERFORM 1
    FROM public."User" AS buyer
   WHERE buyer.id = p_buyer_id
     AND buyer."deletedAt" IS NULL
     AND buyer.banned = false;
  IF NOT FOUND OR NOT public.grainline_checkout_reservation_variant_source_valid(
    p_listing_id,
    p_selected_variant_option_ids,
    NULL
  ) THEN
    RAISE EXCEPTION 'Checkout source witness changed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT listing."listingType"::text
    INTO STRICT source_listing_type
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id;
  IF source_listing_type = 'MADE_TO_ORDER' AND p_quantity <> 1 THEN
    RAISE EXCEPTION 'Checkout source witness changed'
      USING ERRCODE = 'serialization_failure';
  END IF;
  IF source_has_reservation IS DISTINCT FROM (source_listing_type = 'IN_STOCK')
     OR (
       source_has_reservation
       AND source_reserved_items IS DISTINCT FROM pg_catalog.jsonb_build_array(
         pg_catalog.jsonb_build_object(
           'listingId', p_listing_id,
           'sellerId', source_seller_id,
           'quantity', p_quantity
         )
       )
     ) THEN
    RAISE EXCEPTION 'Checkout reservation inventory derivation mismatch'
      USING ERRCODE = 'internal_error';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'seller', public.grainline_checkout_reservation_seller_witness(source_seller_id),
    'item', pg_catalog.jsonb_build_object(
      'quantity', p_quantity,
      'selectedVariantOptionIds', pg_catalog.to_jsonb(p_selected_variant_option_ids),
      'listing', public.grainline_checkout_reservation_listing_witness(p_listing_id)
    )
  )
    INTO STRICT source_witness;

  IF source_witness IS DISTINCT FROM p_expected_source THEN
    RAISE EXCEPTION 'Checkout source witness changed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF source_has_reservation THEN
    RETURN QUERY SELECT source_reservation_id, source_reserved_items, source_expires_at;
  END IF;
EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION 'Checkout source witness changed'
      USING ERRCODE = 'serialization_failure';
END
$grainline_checkout_reservation_create_single_consistent$;

REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_create_cart_consistent(
  text, text, text, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_create_single_consistent(
  text, text, integer, text[], text, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_create_cart_consistent(
  text, text, text, text, text, jsonb
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_create_single_consistent(
  text, text, integer, text[], text, jsonb
) TO grainline_app_runtime;
