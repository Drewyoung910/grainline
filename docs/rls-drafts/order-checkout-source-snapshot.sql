-- DRAFT ONLY: durable checkout-time source for the future Order webhook writer.
--
-- This candidate is additive and coexistence-safe. It deliberately leaves the
-- existing source-consistent functions unchanged for predecessor deployments.
-- Promotion requires a separately byte-pinned migration and release review.

BEGIN;

ALTER TABLE public."CheckoutStockReservation"
  ADD COLUMN "sourceSnapshot" jsonb;

ALTER TABLE public."CheckoutStockReservation"
  ADD CONSTRAINT "CheckoutStockReservation_sourceSnapshot_check"
  CHECK (
    "sourceSnapshot" IS NULL
    OR (
      pg_catalog.jsonb_typeof("sourceSnapshot") = 'object'
      AND pg_catalog.pg_column_size("sourceSnapshot") <= 1048576
    )
  ) NOT VALID;

ALTER TABLE public."CheckoutStockReservation"
  VALIDATE CONSTRAINT "CheckoutStockReservation_sourceSnapshot_check";

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
  updated_count integer;
BEGIN
  -- The predecessor rebuilds the complete database source while holding every
  -- mutable dependency lock and accepts p_expected_source only as an equality
  -- witness. Persisting it is safe only after that exact call succeeds.
  SELECT created.reservation_id, created.reserved_items, created.expires_at
    INTO STRICT source_reservation_id, source_reserved_items, source_expires_at
    FROM public.grainline_checkout_reservation_create_cart_consistent(
      p_buyer_id,
      p_cart_id,
      p_seller_profile_id,
      p_checkout_group_id,
      p_payload_hash,
      p_expected_source
    ) AS created;

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
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  updated_count integer;
BEGIN
  SELECT created.reservation_id, created.reserved_items, created.expires_at
    INTO source_reservation_id, source_reserved_items, source_expires_at
    FROM public.grainline_checkout_reservation_create_single_consistent(
      p_buyer_id,
      p_listing_id,
      p_quantity,
      p_selected_variant_option_ids,
      p_payload_hash,
      p_expected_source
    ) AS created;

  IF FOUND THEN
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
