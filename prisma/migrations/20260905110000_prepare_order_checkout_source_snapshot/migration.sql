-- Compatible durable checkout-time source for the fixed Order webhook writer.
--
-- This migration is additive and coexistence-safe. It deliberately leaves the
-- existing source-consistent functions unchanged for predecessor deployments.
-- It does not activate Order RLS or revoke predecessor table authority.

BEGIN;

ALTER TABLE public."CheckoutStockReservation"
  ADD COLUMN "sourceSnapshot" jsonb;

ALTER TABLE public."CheckoutStockReservation"
  ADD CONSTRAINT "CheckoutStockReservation_sourceSnapshot_check"
  CHECK (
    "sourceSnapshot" IS NULL
    OR (
      pg_catalog.jsonb_typeof("sourceSnapshot") = 'object'
      AND pg_catalog.pg_column_size("sourceSnapshot") <= 4194304
    )
  ) NOT VALID;

ALTER TABLE public."CheckoutStockReservation"
  VALIDATE CONSTRAINT "CheckoutStockReservation_sourceSnapshot_check";

-- This successor intentionally includes every mutable Listing value copied
-- into retained OrderItem history. The predecessor witness remains unchanged
-- for coexistence with already-deployed checkout routes.
CREATE FUNCTION public.grainline_checkout_reservation_listing_snapshot_witness(
  p_listing_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL RESTRICTED
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_listing_snapshot_witness$
  SELECT public.grainline_checkout_reservation_listing_witness(listing.id)
    || pg_catalog.jsonb_build_object(
      'description', listing.description,
      'category', listing.category,
      'tags', pg_catalog.to_jsonb(listing.tags),
      'imageUrls', COALESCE((
        SELECT pg_catalog.jsonb_agg(photo.url ORDER BY photo."sortOrder", photo.id)
          FROM public."Photo" AS photo
         WHERE photo."listingId" = listing.id
      ), '[]'::jsonb),
      'processingTimeMinDays', listing."processingTimeMinDays",
      'processingTimeMaxDays', listing."processingTimeMaxDays",
      'shipsWithinDays', listing."shipsWithinDays"
    )
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
$grainline_checkout_reservation_listing_snapshot_witness$;

CREATE FUNCTION public.grainline_checkout_reservation_create_cart_snapshot(
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
AS $grainline_checkout_reservation_create_cart_snapshot$
DECLARE
  source_reservation_id text;
  source_reserved_items jsonb;
  source_expires_at timestamp(3) without time zone;
  legacy_expected_source jsonb;
  source_mismatch_count bigint;
  updated_count integer;
BEGIN
  -- The predecessor rebuilds the complete database source while holding every
  -- mutable dependency lock and accepts p_expected_source only as an equality
  -- witness. Persisting it is safe only after that exact call succeeds.
  IF p_expected_source IS NULL
     OR pg_catalog.jsonb_typeof(p_expected_source) <> 'object'
     OR pg_catalog.jsonb_typeof(p_expected_source->'items') <> 'array'
     OR pg_catalog.jsonb_array_length(p_expected_source->'items') < 1
     OR pg_catalog.pg_column_size(p_expected_source) > 4194304 THEN
    RAISE EXCEPTION 'Checkout source snapshot is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'seller', p_expected_source->'seller',
    'items', pg_catalog.jsonb_agg(
      source_item || pg_catalog.jsonb_build_object(
        'listing', (source_item->'listing')
          - 'description'
          - 'category'
          - 'tags'
          - 'imageUrls'
          - 'processingTimeMinDays'
          - 'processingTimeMaxDays'
          - 'shipsWithinDays'
      ) ORDER BY source_item->>'cartItemId' COLLATE "C"
    )
  )
    INTO STRICT legacy_expected_source
    FROM pg_catalog.jsonb_array_elements(p_expected_source->'items') AS source(source_item);

  SELECT created.reservation_id, created.reserved_items, created.expires_at
    INTO STRICT source_reservation_id, source_reserved_items, source_expires_at
    FROM public.grainline_checkout_reservation_create_cart_consistent(
      p_buyer_id,
      p_cart_id,
      p_seller_profile_id,
      p_checkout_group_id,
      p_payload_hash,
      legacy_expected_source
    ) AS created;

  SELECT pg_catalog.count(*)
    INTO STRICT source_mismatch_count
    FROM pg_catalog.jsonb_array_elements(p_expected_source->'items') AS source(source_item)
   WHERE source_item->'listing' IS DISTINCT FROM
         public.grainline_checkout_reservation_listing_snapshot_witness(
           source_item->>'listingId'
         );
  IF source_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Checkout source snapshot changed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  UPDATE public."CheckoutStockReservation" AS reservation
     SET "sourceSnapshot" = p_expected_source
   WHERE reservation.id = source_reservation_id
     AND reservation."buyerId" = p_buyer_id
     AND reservation."sellerId" = p_seller_profile_id
     AND reservation."payloadHash" = p_payload_hash
     AND reservation.status = 'RESERVED'
     AND reservation."stripeSessionId" IS NULL
     AND reservation."sourceSnapshot" IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Checkout source snapshot persistence failed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN QUERY SELECT source_reservation_id, source_reserved_items, source_expires_at;
END
$grainline_checkout_reservation_create_cart_snapshot$;

CREATE FUNCTION public.grainline_checkout_reservation_create_single_snapshot(
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
AS $grainline_checkout_reservation_create_single_snapshot$
DECLARE
  source_reservation_id text;
  source_reserved_items jsonb;
  source_expires_at timestamp(3) without time zone;
  source_seller_id text;
  source_listing_type text;
  source_has_reservation boolean := false;
  legacy_expected_source jsonb;
  database_listing_snapshot jsonb;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  updated_count integer;
BEGIN
  IF p_expected_source IS NULL
     OR pg_catalog.jsonb_typeof(p_expected_source) <> 'object'
     OR pg_catalog.jsonb_typeof(p_expected_source->'item') <> 'object'
     OR pg_catalog.jsonb_typeof(p_expected_source#>'{item,listing}') <> 'object'
     OR pg_catalog.pg_column_size(p_expected_source) > 4194304 THEN
    RAISE EXCEPTION 'Checkout source snapshot is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  legacy_expected_source := pg_catalog.jsonb_set(
    p_expected_source,
    '{item,listing}',
    (p_expected_source#>'{item,listing}')
      - 'description'
      - 'category'
      - 'tags'
      - 'imageUrls'
      - 'processingTimeMinDays'
      - 'processingTimeMaxDays'
      - 'shipsWithinDays',
    false
  );

  SELECT created.reservation_id, created.reserved_items, created.expires_at
    INTO source_reservation_id, source_reserved_items, source_expires_at
    FROM public.grainline_checkout_reservation_create_single_consistent(
      p_buyer_id,
      p_listing_id,
      p_quantity,
      p_selected_variant_option_ids,
      p_payload_hash,
      legacy_expected_source
    ) AS created;
  source_has_reservation := FOUND;

  SELECT public.grainline_checkout_reservation_listing_snapshot_witness(p_listing_id)
    INTO STRICT database_listing_snapshot;
  IF p_expected_source#>'{item,listing}' IS DISTINCT FROM database_listing_snapshot THEN
    RAISE EXCEPTION 'Checkout source snapshot changed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF source_has_reservation THEN
    UPDATE public."CheckoutStockReservation" AS reservation
       SET "sourceSnapshot" = p_expected_source
     WHERE reservation.id = source_reservation_id
       AND reservation."buyerId" = p_buyer_id
       AND reservation."payloadHash" = p_payload_hash
       AND reservation.status = 'RESERVED'
       AND reservation."stripeSessionId" IS NULL
       AND reservation."sourceSnapshot" IS NULL;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count <> 1 THEN
      RAISE EXCEPTION 'Checkout source snapshot persistence failed'
        USING ERRCODE = 'serialization_failure';
    END IF;

    RETURN QUERY SELECT source_reservation_id, source_reserved_items, source_expires_at;
    RETURN;
  END IF;

  -- The predecessor returns no row only for a validated made-to-order source.
  -- Its Listing, seller, buyer, photo and variant locks remain held by this
  -- statement. Create a lifecycle row without changing inventory so every new
  -- Checkout Session has one durable, bindable source.
  SELECT listing."sellerId", listing."listingType"::text
    INTO STRICT source_seller_id, source_listing_type
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id;
  IF source_listing_type <> 'MADE_TO_ORDER' THEN
    RAISE EXCEPTION 'Checkout source snapshot reservation state is invalid'
      USING ERRCODE = 'internal_error';
  END IF;

  source_reservation_id := pg_catalog.gen_random_uuid()::text;
  source_reserved_items := '[]'::jsonb;
  source_expires_at := source_now + interval '31 minutes';

  INSERT INTO public."CheckoutStockReservation" (
    id,
    "checkoutLockKey",
    "payloadHash",
    "buyerId",
    "sellerId",
    status,
    "reservedItems",
    "sourceSnapshot",
    "expiresAt",
    "createdAt",
    "updatedAt"
  ) VALUES (
    source_reservation_id,
    'checkout:single:' || p_buyer_id || ':listing:' || p_listing_id,
    p_payload_hash,
    p_buyer_id,
    source_seller_id,
    'RESERVED',
    source_reserved_items,
    p_expected_source,
    source_expires_at,
    source_now,
    source_now
  );

  RETURN QUERY SELECT source_reservation_id, source_reserved_items, source_expires_at;
EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION 'Checkout source snapshot reservation state is invalid'
      USING ERRCODE = 'serialization_failure';
END
$grainline_checkout_reservation_create_single_snapshot$;

REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_create_cart_snapshot(
  text, text, text, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_listing_snapshot_witness(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_create_single_snapshot(
  text, text, integer, text[], text, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_create_cart_snapshot(
  text, text, text, text, text, jsonb
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_create_single_snapshot(
  text, text, integer, text[], text, jsonb
) TO grainline_app_runtime;

COMMIT;
