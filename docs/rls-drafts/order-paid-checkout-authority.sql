-- Compatible generation-bound paid Checkout -> Order/OrderItem authority.
--
-- This migration requires order-checkout-source-snapshot.sql. It does not
-- enable RLS or revoke any predecessor table authority; predecessor checkout
-- deployments remain compatible until the later application drain.

BEGIN;

CREATE FUNCTION public.grainline_stripe_checkout_order_create(
  p_event_id text,
  p_claim_generation bigint,
  p_reservation_id text,
  p_session_id text,
  p_paid_at timestamp(3) without time zone,
  p_provider jsonb
)
RETURNS TABLE(
  outcome text,
  order_id text,
  invalid_reason text,
  invalid_seller_user_ids text[],
  listing_visibility_changed boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stripe_checkout_order_create$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_reservation public."CheckoutStockReservation"%ROWTYPE;
  source_snapshot jsonb;
  source_items jsonb;
  source_item jsonb;
  provider_item jsonb;
  source_mode text;
  source_seller_id text;
  source_seller_user_id text;
  source_buyer_id text;
  source_listing_id text;
  source_item_key text;
  source_variant_key text;
  source_selected_variants jsonb;
  source_selected_variant_count bigint;
  source_unit_price_cents integer;
  source_quantity integer;
  source_items_subtotal bigint := 0;
  source_max_processing_days integer := 0;
  source_listing_visibility_changed boolean := false;
  source_invalid_reason text := '';
  source_invalid_listing_ids text[] := ARRAY[]::text[];
  source_buyer_invalid_reason text;
  source_seller_invalid_reason text;
  source_listing_invalid_reason text;
  source_review_needed boolean := false;
  source_review_note text;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_order_id text;
  source_existing_order public."Order"%ROWTYPE;
  source_completion_result text;
  source_paid_item_count integer;
  source_gift_wrapping boolean;
  source_gift_wrapping_price integer;
  source_address_mismatch boolean;
  source_amount_mismatch boolean;
  source_fulfillment_method public."FulfillmentMethod";
  source_processing_deadline timestamp(3) without time zone;
  source_estimated_delivery timestamp(3) without time zone;
  source_listing_snapshot jsonb;
  source_weight double precision;
  source_length double precision;
  source_width double precision;
  source_height double precision;
  source_package_complete boolean;
  source_key_count bigint;
  source_source_key_count bigint;
  source_unknown_key text;
  source_current_buyer record;
  source_current_seller record;
  source_current_listing record;
BEGIN
  IF p_event_id IS NULL
     OR p_event_id !~ '^evt_[A-Za-z0-9_]+$'
     OR pg_catalog.char_length(p_event_id) > 255
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_reservation_id IS NULL
     OR pg_catalog.char_length(p_reservation_id) NOT BETWEEN 1 AND 191
     OR p_session_id IS NULL
     OR p_session_id !~ '^cs_[A-Za-z0-9_]+$'
     OR pg_catalog.char_length(p_session_id) > 255
     OR p_paid_at IS NULL
     OR p_paid_at < source_now - interval '8 days'
     OR p_paid_at > source_now + interval '5 minutes'
     OR p_provider IS NULL
     OR pg_catalog.jsonb_typeof(p_provider) <> 'object'
     OR pg_catalog.pg_column_size(p_provider) > 524288 THEN
    RAISE EXCEPTION 'Paid checkout authority input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT key
    INTO source_unknown_key
    FROM pg_catalog.jsonb_object_keys(p_provider) AS provider_key(key)
   WHERE key <> ALL (ARRAY[
     'currency', 'chargedTotalCents', 'itemsSubtotalCents',
     'shippingTitle', 'shippingAmountCents', 'taxAmountCents',
     'buyerEmail', 'buyerName',
     'shipToLine1', 'shipToLine2', 'shipToCity', 'shipToState',
     'shipToPostalCode', 'shipToCountry',
     'stripePaymentIntentId', 'stripeChargeId',
     'stripeApplicationFeeId', 'stripeTransferId',
     'shippingCarrier', 'shippingService',
     'quotedToLine1', 'quotedToLine2', 'quotedToCity', 'quotedToState',
     'quotedToPostalCode', 'quotedToCountry', 'quotedToName', 'quotedToPhone',
     'quotedShippingAmountCents', 'shippoShipmentId', 'shippoRateObjectId',
     'giftNote', 'giftWrapping', 'giftWrappingPriceCents', 'estDays',
     'paidItems'
   ])
   LIMIT 1;
  IF source_unknown_key IS NOT NULL
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_provider)) <> 36
     OR pg_catalog.jsonb_typeof(p_provider->'paidItems') <> 'array'
     OR pg_catalog.jsonb_array_length(p_provider->'paidItems') NOT BETWEEN 1 AND 50
     OR p_provider->>'currency' !~ '^[a-z]{3}$'
     OR p_provider->>'chargedTotalCents' !~ '^[1-9][0-9]{0,9}$'
     OR p_provider->>'itemsSubtotalCents' !~ '^[0-9]{1,10}$'
     OR p_provider->>'shippingAmountCents' !~ '^[0-9]{1,10}$'
     OR p_provider->>'taxAmountCents' !~ '^[0-9]{1,10}$'
     OR p_provider->>'giftWrappingPriceCents' !~ '^[0-9]{1,10}$'
     OR (
       p_provider->'quotedShippingAmountCents' <> 'null'::jsonb
       AND p_provider->>'quotedShippingAmountCents' !~ '^[0-9]{1,10}$'
     )
     OR p_provider->>'estDays' !~ '^[1-9][0-9]?$'
     OR (p_provider->>'estDays')::integer NOT BETWEEN 1 AND 60
     OR pg_catalog.jsonb_typeof(p_provider->'giftWrapping') <> 'boolean'
     OR p_provider->>'stripePaymentIntentId' !~ '^pi_[A-Za-z0-9_]+$'
     OR p_provider->>'stripeChargeId' !~ '^ch_[A-Za-z0-9_]+$'
     OR p_provider->>'stripeTransferId' !~ '^tr_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'Paid checkout provider projection is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Nullable provider strings must be JSON null or bounded strings. Required
  -- payment references above deliberately wait out Stripe consistency rather
  -- than creating an Order that can never be safely refunded.
  IF (p_provider->'stripeApplicationFeeId' <> 'null'::jsonb AND (
        pg_catalog.jsonb_typeof(p_provider->'stripeApplicationFeeId') <> 'string'
        OR p_provider->>'stripeApplicationFeeId' !~ '^fee_[A-Za-z0-9_]+$'
        OR pg_catalog.char_length(p_provider->>'stripeApplicationFeeId') > 255
      ))
     OR EXISTS (
       SELECT 1
         FROM (VALUES
           ('shippingTitle', 200), ('buyerEmail', 254), ('buyerName', 200),
           ('shipToLine1', 200), ('shipToLine2', 200), ('shipToCity', 100),
           ('shipToState', 50), ('shipToPostalCode', 20), ('shipToCountry', 2),
           ('shippingCarrier', 100), ('shippingService', 100),
           ('quotedToLine1', 200), ('quotedToLine2', 200),
           ('quotedToCity', 100), ('quotedToState', 50),
           ('quotedToPostalCode', 20), ('quotedToCountry', 2),
           ('quotedToName', 200), ('quotedToPhone', 30),
           ('shippoShipmentId', 255), ('shippoRateObjectId', 255),
           ('giftNote', 500)
         ) AS bound(field_name, max_length)
        WHERE p_provider->bound.field_name <> 'null'::jsonb
          AND (
            pg_catalog.jsonb_typeof(p_provider->bound.field_name) <> 'string'
            OR pg_catalog.char_length(p_provider->>bound.field_name) > bound.max_length
          )
     ) THEN
    RAISE EXCEPTION 'Paid checkout provider string is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (p_provider->>'chargedTotalCents')::bigint > 2147483647
     OR (p_provider->>'itemsSubtotalCents')::bigint > 2147483647
     OR (p_provider->>'shippingAmountCents')::bigint > 2147483647
     OR (p_provider->>'taxAmountCents')::bigint > 2147483647
     OR (p_provider->>'giftWrappingPriceCents')::bigint > 2147483647
     OR (p_provider->>'chargedTotalCents')::bigint <>
        (p_provider->>'itemsSubtotalCents')::bigint
        + (p_provider->>'shippingAmountCents')::bigint
        + (p_provider->>'taxAmountCents')::bigint
        + (p_provider->>'giftWrappingPriceCents')::bigint THEN
    RAISE EXCEPTION 'Paid checkout amount projection is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type::text NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR source_event."sourceObjectId" IS DISTINCT FROM p_session_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Paid checkout event authority is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT reservation.*
    INTO source_reservation
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation.id = p_reservation_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_reservation."stripeSessionId" IS DISTINCT FROM p_session_id
     OR source_reservation.status NOT IN ('RESERVED', 'COMPLETED')
     OR source_reservation."buyerId" IS NULL
     OR source_reservation."sellerId" IS NULL
     OR source_reservation."sourceSnapshot" IS NULL THEN
    RAISE EXCEPTION 'Paid checkout reservation authority is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  source_snapshot := source_reservation."sourceSnapshot";
  source_buyer_id := source_reservation."buyerId";
  source_seller_id := source_reservation."sellerId";
  source_seller_user_id := source_snapshot#>>'{seller,userId}';
  IF source_snapshot#>>'{seller,id}' IS DISTINCT FROM source_seller_id
     OR source_seller_user_id IS NULL
     OR source_seller_user_id = source_buyer_id
     OR source_snapshot#>>'{seller,stripeAccountId}' IS NULL THEN
    RAISE EXCEPTION 'Paid checkout retained source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF pg_catalog.jsonb_typeof(source_snapshot->'items') = 'array'
     AND NOT (source_snapshot ? 'item') THEN
    source_mode := 'cart';
    source_items := source_snapshot->'items';
  ELSIF pg_catalog.jsonb_typeof(source_snapshot->'item') = 'object'
        AND NOT (source_snapshot ? 'items') THEN
    source_mode := 'single';
    source_items := pg_catalog.jsonb_build_array(source_snapshot->'item');
  ELSE
    RAISE EXCEPTION 'Paid checkout retained source mode is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  source_max_processing_days := CASE WHEN source_mode = 'cart' THEN 3 ELSE 0 END;
  IF pg_catalog.jsonb_array_length(source_items) NOT BETWEEN 1 AND 50
     OR pg_catalog.jsonb_array_length(source_items) <>
        pg_catalog.jsonb_array_length(p_provider->'paidItems') THEN
    RAISE EXCEPTION 'Paid checkout retained item count is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lock actors in identifier order before the SellerProfile and Listing
  -- rows. This matches account deletion and checkout reservation lock order.
  PERFORM actor.id
    FROM public."User" AS actor
   WHERE actor.id IN (source_buyer_id, source_seller_user_id)
   ORDER BY actor.id
   FOR UPDATE;

  SELECT buyer.id, buyer.banned, buyer."deletedAt"
    INTO source_current_buyer
    FROM public."User" AS buyer
   WHERE buyer.id = source_buyer_id;
  IF NOT FOUND THEN
    source_buyer_invalid_reason := 'Buyer account could not be verified at payment completion.';
  ELSIF source_current_buyer.banned THEN
    source_buyer_invalid_reason := 'Buyer account was suspended before payment completion.';
  ELSIF source_current_buyer."deletedAt" IS NOT NULL THEN
    source_buyer_invalid_reason := 'Buyer account was deleted before payment completion.';
  END IF;

  SELECT seller.id, seller."userId", seller."chargesEnabled",
         seller."stripeAccountId", seller."stripeAccountVersion",
         seller."vacationMode",
         seller."acceptingNewOrders", seller_user.banned AS user_banned,
         seller_user."deletedAt" AS user_deleted_at
    INTO source_current_seller
    FROM public."SellerProfile" AS seller
    JOIN public."User" AS seller_user ON seller_user.id = seller."userId"
   WHERE seller.id = source_seller_id
   FOR UPDATE OF seller;
  IF NOT FOUND OR source_current_seller."userId" IS DISTINCT FROM source_seller_user_id THEN
    source_seller_invalid_reason := 'Seller account could not be verified at payment completion.';
  ELSIF source_current_seller.user_banned THEN
    source_seller_invalid_reason := 'Seller account was suspended before payment completion.';
  ELSIF source_current_seller.user_deleted_at IS NOT NULL THEN
    source_seller_invalid_reason := 'Seller account was deleted before payment completion.';
  ELSIF NOT source_current_seller."chargesEnabled" THEN
    source_seller_invalid_reason := 'Seller Stripe account was disabled before payment completion.';
  ELSIF source_current_seller."stripeAccountId" IS NULL THEN
    source_seller_invalid_reason := 'Seller Stripe account was disconnected before payment completion.';
  ELSIF source_current_seller."stripeAccountId" IS DISTINCT FROM
        source_snapshot#>>'{seller,stripeAccountId}'
        OR source_current_seller."stripeAccountVersion" IS DISTINCT FROM
           source_snapshot#>>'{seller,stripeAccountVersion}' THEN
    source_seller_invalid_reason := 'Seller Stripe account changed before payment completion.';
  ELSIF source_current_seller."vacationMode" THEN
    source_seller_invalid_reason := 'Seller entered vacation mode before payment completion.';
  ELSIF NOT source_current_seller."acceptingNewOrders" THEN
    source_seller_invalid_reason := 'Seller stopped accepting new orders before payment completion.';
  END IF;

  -- Lock each retained Listing even if it became non-purchasable. Orders must
  -- describe checkout-time source while current state decides refund review.
  PERFORM listing.id
    FROM public."Listing" AS listing
   WHERE listing.id IN (
     SELECT item#>>'{listing,id}'
       FROM pg_catalog.jsonb_array_elements(source_items) AS retained(item)
   )
   ORDER BY listing.id
   FOR UPDATE;

  source_paid_item_count := pg_catalog.jsonb_array_length(p_provider->'paidItems');
  SELECT pg_catalog.count(DISTINCT paid->>'sourceKey')
    INTO source_key_count
    FROM pg_catalog.jsonb_array_elements(p_provider->'paidItems') AS paid_items(paid);
  IF source_key_count <> source_paid_item_count THEN
    RAISE EXCEPTION 'Paid checkout provider item keys are invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT pg_catalog.count(DISTINCT CASE
           WHEN source_mode = 'cart' THEN retained.item->>'cartItemId'
           ELSE 'single:' || COALESCE(retained.item#>>'{listing,id}', '')
         END)
    INTO source_source_key_count
    FROM pg_catalog.jsonb_array_elements(source_items) AS retained(item);
  IF source_source_key_count <> pg_catalog.jsonb_array_length(source_items) THEN
    RAISE EXCEPTION 'Paid checkout retained source keys are invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR source_item IN
    SELECT retained.item
      FROM pg_catalog.jsonb_array_elements(source_items) AS retained(item)
     ORDER BY CASE
       WHEN source_mode = 'cart' THEN retained.item->>'cartItemId'
       ELSE retained.item#>>'{listing,id}'
     END COLLATE "C"
  LOOP
    source_listing_id := source_item#>>'{listing,id}';
    source_quantity := NULL;
    IF source_item->>'quantity' ~ '^[1-9][0-9]{0,2}$' THEN
      source_quantity := (source_item->>'quantity')::integer;
    END IF;
    source_item_key := CASE
      WHEN source_mode = 'cart' THEN source_item->>'cartItemId'
      ELSE 'single:' || COALESCE(source_listing_id, '')
    END;
    IF source_listing_id IS NULL
       OR source_item#>>'{listing,sellerId}' IS DISTINCT FROM source_seller_id
       OR pg_catalog.lower(COALESCE(source_item#>>'{listing,currency}', 'usd'))
          IS DISTINCT FROM p_provider->>'currency'
       OR source_quantity IS NULL
       OR source_quantity > 200
       OR source_item_key IS NULL
       OR pg_catalog.char_length(source_item_key) NOT BETWEEN 1 AND 220
       OR pg_catalog.jsonb_typeof(source_item->'selectedVariantOptionIds') <> 'array'
       OR pg_catalog.jsonb_array_length(source_item->'selectedVariantOptionIds') > 3 THEN
      RAISE EXCEPTION 'Paid checkout retained item is invalid'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT paid
      INTO provider_item
      FROM pg_catalog.jsonb_array_elements(p_provider->'paidItems') AS paid_items(paid)
     WHERE paid->>'sourceKey' = source_item_key;
    IF NOT FOUND
       OR pg_catalog.jsonb_typeof(provider_item) <> 'object'
       OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(provider_item)) <> 5
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_object_keys(provider_item) AS paid_key(key)
          WHERE key <> ALL (ARRAY[
            'sourceKey', 'listingId', 'variantKey', 'quantity', 'unitAmountCents'
          ])
       )
       OR provider_item->>'listingId' IS DISTINCT FROM source_listing_id
       OR provider_item->>'quantity' !~ '^[1-9][0-9]{0,2}$'
       OR (provider_item->>'quantity')::integer IS DISTINCT FROM source_quantity
       OR provider_item->>'unitAmountCents' !~ '^[1-9][0-9]{0,8}$' THEN
      RAISE EXCEPTION 'Paid checkout provider item is invalid'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(pg_catalog.sum((option_value->>'priceAdjustCents')::integer), 0),
           COALESCE(pg_catalog.string_agg(option_id, ',' ORDER BY option_id COLLATE "C"), ''),
           COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'groupName', group_value->>'name',
               'optionLabel', option_value->>'label',
               'priceAdjustCents', (option_value->>'priceAdjustCents')::integer
             ) ORDER BY selected.ordinality
           ), '[]'::jsonb),
           pg_catalog.count(*)
      INTO source_unit_price_cents, source_variant_key, source_selected_variants,
           source_selected_variant_count
      FROM pg_catalog.jsonb_array_elements_text(
             source_item->'selectedVariantOptionIds'
           ) WITH ORDINALITY AS selected(option_id, ordinality)
      JOIN LATERAL pg_catalog.jsonb_array_elements(
             source_item#>'{listing,variantGroups}'
           ) AS source_group(group_value) ON true
      JOIN LATERAL pg_catalog.jsonb_array_elements(
             group_value->'options'
           ) AS source_option(option_value)
        ON option_value->>'id' = selected.option_id;
    source_unit_price_cents :=
      (source_item#>>'{listing,priceCents}')::integer + source_unit_price_cents;
    IF source_selected_variant_count IS DISTINCT FROM
         pg_catalog.jsonb_array_length(source_item->'selectedVariantOptionIds')
       OR (
         SELECT pg_catalog.count(DISTINCT selected_id)
           FROM pg_catalog.jsonb_array_elements_text(
             source_item->'selectedVariantOptionIds'
           ) AS selected(selected_id)
       ) IS DISTINCT FROM source_selected_variant_count
       OR source_unit_price_cents NOT BETWEEN 1 AND 10000000
       OR (provider_item->>'unitAmountCents')::integer IS DISTINCT FROM source_unit_price_cents
       OR provider_item->>'variantKey' IS DISTINCT FROM source_variant_key THEN
      RAISE EXCEPTION 'Paid checkout provider price is invalid'
        USING ERRCODE = 'check_violation';
    END IF;
    source_items_subtotal := source_items_subtotal
      + source_unit_price_cents::bigint * source_quantity::bigint;
    IF source_items_subtotal > 2147483647 THEN
      RAISE EXCEPTION 'Paid checkout item subtotal is invalid'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT listing.id, listing."sellerId", listing.status::text AS status, listing."isPrivate",
           listing."reservedForUserId"
      INTO source_current_listing
      FROM public."Listing" AS listing
     WHERE listing.id = source_listing_id;
    IF NOT FOUND THEN
      source_listing_invalid_reason := 'Listing could not be verified at payment completion.';
    ELSIF source_current_listing."sellerId" IS DISTINCT FROM source_seller_id THEN
      source_listing_invalid_reason := 'Listing seller changed before payment completion.';
    ELSIF source_current_listing.status <> 'ACTIVE' THEN
      source_listing_invalid_reason := 'Listing was no longer active before payment completion.';
    ELSIF source_current_listing."isPrivate"
          AND source_current_listing."reservedForUserId" IS DISTINCT FROM
              source_buyer_id THEN
      source_listing_invalid_reason := 'Listing reservation changed before payment completion.';
    ELSE
      source_listing_invalid_reason := NULL;
    END IF;
    IF source_listing_invalid_reason IS NOT NULL
       AND NOT (source_listing_id = ANY(source_invalid_listing_ids)) THEN
      source_invalid_listing_ids := pg_catalog.array_append(
        source_invalid_listing_ids, source_listing_id
      );
      source_invalid_reason := pg_catalog.concat_ws(
        ' ', NULLIF(source_invalid_reason, ''), source_listing_invalid_reason
      );
    END IF;

    source_max_processing_days := GREATEST(
      source_max_processing_days,
      CASE source_item#>>'{listing,listingType}'
        WHEN 'IN_STOCK' THEN GREATEST(
          CASE WHEN source_mode = 'single' THEN 1 ELSE 3 END,
          COALESCE((source_item#>>'{listing,shipsWithinDays}')::integer, 1)
        )
        WHEN 'MADE_TO_ORDER' THEN GREATEST(
          3, COALESCE((source_item#>>'{listing,processingTimeMaxDays}')::integer, 0)
        )
        ELSE 0
      END
    );
  END LOOP;

  IF source_items_subtotal IS DISTINCT FROM (p_provider->>'itemsSubtotalCents')::bigint THEN
    RAISE EXCEPTION 'Paid checkout source subtotal is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  source_gift_wrapping := (p_provider->>'giftWrapping')::boolean;
  source_gift_wrapping_price := (p_provider->>'giftWrappingPriceCents')::integer;
  IF (NOT source_gift_wrapping AND source_gift_wrapping_price <> 0)
     OR (
       source_gift_wrapping
       AND (
         source_snapshot#>>'{seller,offersGiftWrapping}' <> 'true'
         OR source_snapshot#>>'{seller,giftWrappingPriceCents}' IS NULL
         OR (source_snapshot#>>'{seller,giftWrappingPriceCents}')::integer
            IS DISTINCT FROM source_gift_wrapping_price
       )
     ) THEN
    RAISE EXCEPTION 'Paid checkout gift-wrap source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  source_invalid_reason := pg_catalog.concat_ws(
    ' ', source_buyer_invalid_reason, source_seller_invalid_reason,
    NULLIF(source_invalid_reason, '')
  );
  source_address_mismatch :=
    (COALESCE(p_provider->>'quotedToPostalCode', '') <> '' AND
      pg_catalog.upper(pg_catalog.split_part(p_provider->>'quotedToPostalCode', '-', 1)) <>
      pg_catalog.upper(pg_catalog.split_part(COALESCE(p_provider->>'shipToPostalCode', ''), '-', 1)))
    OR (COALESCE(p_provider->>'quotedToState', '') <> '' AND
      pg_catalog.upper(pg_catalog.btrim(p_provider->>'quotedToState')) <>
      pg_catalog.upper(pg_catalog.btrim(COALESCE(p_provider->>'shipToState', ''))))
    OR (COALESCE(p_provider->>'quotedToCity', '') <> '' AND
      pg_catalog.lower(pg_catalog.btrim(p_provider->>'quotedToCity')) <>
      pg_catalog.lower(pg_catalog.btrim(COALESCE(p_provider->>'shipToCity', ''))))
    OR (COALESCE(p_provider->>'quotedToCountry', '') <> '' AND
      pg_catalog.upper(pg_catalog.btrim(p_provider->>'quotedToCountry')) <>
      pg_catalog.upper(pg_catalog.btrim(COALESCE(p_provider->>'shipToCountry', ''))));
  source_amount_mismatch := p_provider->'quotedShippingAmountCents' <> 'null'::jsonb
    AND (
      p_provider->>'quotedShippingAmountCents' !~ '^[0-9]{1,10}$'
      OR (p_provider->>'quotedShippingAmountCents')::bigint <>
         (p_provider->>'shippingAmountCents')::bigint
    );
  source_review_needed := source_invalid_reason <> ''
    OR source_address_mismatch OR source_amount_mismatch;
  source_review_note := CASE
    WHEN source_invalid_reason <> ''
      THEN source_invalid_reason || ' Order was held for staff review.'
    WHEN source_address_mismatch OR source_amount_mismatch
      THEN 'Address and/or quoted amount changed at Checkout.'
    ELSE NULL
  END;

  source_fulfillment_method := CASE
    WHEN pg_catalog.lower(COALESCE(p_provider->>'shippingTitle', '')) LIKE '%pickup%'
      OR (
        p_provider->'shipToLine1' = 'null'::jsonb
        AND p_provider->'shipToCity' = 'null'::jsonb
        AND p_provider->'shipToPostalCode' = 'null'::jsonb
      ) THEN 'PICKUP'::public."FulfillmentMethod"
    ELSE 'SHIPPING'::public."FulfillmentMethod"
  END;
  IF (
       source_fulfillment_method = 'PICKUP'::public."FulfillmentMethod"
       AND source_snapshot#>>'{seller,allowLocalPickup}' <> 'true'
     )
     OR (
       source_fulfillment_method = 'SHIPPING'::public."FulfillmentMethod"
       AND (
         COALESCE(p_provider->>'shipToLine1', '') = ''
         OR COALESCE(p_provider->>'shipToCity', '') = ''
         OR COALESCE(p_provider->>'shipToPostalCode', '') = ''
         OR p_provider->>'shipToCountry' !~ '^[A-Z]{2}$'
       )
     ) THEN
    RAISE EXCEPTION 'Paid checkout fulfillment projection is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  source_processing_deadline := p_paid_at +
    pg_catalog.make_interval(days => source_max_processing_days);
  source_estimated_delivery := source_processing_deadline +
    pg_catalog.make_interval(days => (p_provider->>'estDays')::integer + 3);

  SELECT existing.*
    INTO source_existing_order
    FROM public."Order" AS existing
   WHERE existing."stripeSessionId" = p_session_id
   FOR UPDATE;
  IF FOUND THEN
    IF source_existing_order."paidAt" IS DISTINCT FROM p_paid_at
       OR source_existing_order.currency IS DISTINCT FROM p_provider->>'currency'
       OR source_existing_order."chargedTotalCents" IS DISTINCT FROM (p_provider->>'chargedTotalCents')::integer
       OR source_existing_order."itemsSubtotalCents" IS DISTINCT FROM (p_provider->>'itemsSubtotalCents')::integer
       OR source_existing_order."shippingAmountCents" IS DISTINCT FROM (p_provider->>'shippingAmountCents')::integer
       OR source_existing_order."taxAmountCents" IS DISTINCT FROM (p_provider->>'taxAmountCents')::integer
       OR source_existing_order."stripePaymentIntentId" IS DISTINCT FROM p_provider->>'stripePaymentIntentId'
       OR source_existing_order."stripeChargeId" IS DISTINCT FROM p_provider->>'stripeChargeId'
       OR source_existing_order."stripeTransferId" IS DISTINCT FROM p_provider->>'stripeTransferId' THEN
      RAISE EXCEPTION 'Paid checkout replay drifted'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN QUERY SELECT
      'replayed', source_existing_order.id, NULL::text, ARRAY[]::text[], false;
    RETURN;
  END IF;

  IF source_reservation.status <> 'RESERVED' THEN
    RAISE EXCEPTION 'Paid checkout completed reservation has no Order'
      USING ERRCODE = 'check_violation';
  END IF;

  source_order_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."Order" (
    id, "buyerId", "sellerProfileId", "createdAt", "paidAt",
    "stripeSessionId", currency, "chargedTotalCents", "itemsSubtotalCents",
    "shippingTitle", "shippingAmountCents", "taxAmountCents",
    "buyerEmail", "buyerName", "shipToLine1", "shipToLine2", "shipToCity",
    "shipToState", "shipToPostalCode", "shipToCountry",
    "stripePaymentIntentId", "stripeChargeId", "stripeApplicationFeeId",
    "stripeTransferId", "fulfillmentMethod", "fulfillmentStatus",
    "estimatedDeliveryDate", "processingDeadline", "shippingCarrier",
    "shippingService", "quotedShippingAmountCents", "reviewNeeded",
    "reviewNote", "quotedToLine1", "quotedToLine2", "quotedToCity",
    "quotedToState", "quotedToPostalCode", "quotedToCountry", "quotedToName",
    "quotedToPhone", "shippoShipmentId", "shippoRateObjectId", "giftNote",
    "giftWrapping", "giftWrappingPriceCents", "buyerDataPurgedAt"
  ) VALUES (
    source_order_id,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN source_buyer_id ELSE NULL END,
    source_seller_id, source_now, p_paid_at, p_session_id,
    p_provider->>'currency', (p_provider->>'chargedTotalCents')::integer,
    (p_provider->>'itemsSubtotalCents')::integer, p_provider->>'shippingTitle',
    (p_provider->>'shippingAmountCents')::integer,
    (p_provider->>'taxAmountCents')::integer,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'buyerEmail' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'buyerName' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToLine1' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToLine2' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToCity' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToState' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToPostalCode' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToCountry' ELSE NULL END,
    p_provider->>'stripePaymentIntentId', p_provider->>'stripeChargeId',
    p_provider->>'stripeApplicationFeeId', p_provider->>'stripeTransferId',
    source_fulfillment_method, 'PENDING'::public."FulfillmentStatus",
    source_estimated_delivery, source_processing_deadline,
    p_provider->>'shippingCarrier', p_provider->>'shippingService',
    CASE WHEN p_provider->'quotedShippingAmountCents' = 'null'::jsonb THEN NULL
      ELSE (p_provider->>'quotedShippingAmountCents')::integer END,
    source_review_needed, pg_catalog.left(source_review_note, 10000),
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToLine1' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToLine2' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToCity' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToState' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToPostalCode' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToCountry' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToName' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToPhone' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shippoShipmentId' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shippoRateObjectId' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'giftNote' ELSE NULL END,
    source_gift_wrapping, source_gift_wrapping_price,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN NULL ELSE source_now END
  );

  FOR source_item IN
    SELECT retained.item
      FROM pg_catalog.jsonb_array_elements(source_items) AS retained(item)
     ORDER BY CASE
       WHEN source_mode = 'cart' THEN retained.item->>'cartItemId'
       ELSE retained.item#>>'{listing,id}'
     END COLLATE "C"
  LOOP
    source_listing_id := source_item#>>'{listing,id}';
    source_item_key := CASE WHEN source_mode = 'cart'
      THEN source_item->>'cartItemId' ELSE 'single:' || source_listing_id END;
    SELECT paid INTO STRICT provider_item
      FROM pg_catalog.jsonb_array_elements(p_provider->'paidItems') AS paid_items(paid)
     WHERE paid->>'sourceKey' = source_item_key;

    SELECT COALESCE(pg_catalog.sum((option_value->>'priceAdjustCents')::integer), 0),
           COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'groupName', group_value->>'name',
               'optionLabel', option_value->>'label',
               'priceAdjustCents', (option_value->>'priceAdjustCents')::integer
             ) ORDER BY selected.ordinality
           ), '[]'::jsonb)
      INTO source_unit_price_cents, source_selected_variants
      FROM pg_catalog.jsonb_array_elements_text(
             source_item->'selectedVariantOptionIds'
           ) WITH ORDINALITY AS selected(option_id, ordinality)
      JOIN LATERAL pg_catalog.jsonb_array_elements(
             source_item#>'{listing,variantGroups}'
           ) AS source_group(group_value) ON true
      JOIN LATERAL pg_catalog.jsonb_array_elements(group_value->'options')
           AS source_option(option_value)
        ON option_value->>'id' = selected.option_id;
    source_unit_price_cents :=
      (source_item#>>'{listing,priceCents}')::integer + source_unit_price_cents;

    source_weight := COALESCE(
      (source_item#>>'{listing,packagedWeightGrams}')::double precision,
      (source_snapshot#>>'{seller,defaultPkgWeightGrams}')::double precision
    );
    source_length := COALESCE(
      (source_item#>>'{listing,packagedLengthCm}')::double precision,
      (source_snapshot#>>'{seller,defaultPkgLengthCm}')::double precision
    );
    source_width := COALESCE(
      (source_item#>>'{listing,packagedWidthCm}')::double precision,
      (source_snapshot#>>'{seller,defaultPkgWidthCm}')::double precision
    );
    source_height := COALESCE(
      (source_item#>>'{listing,packagedHeightCm}')::double precision,
      (source_snapshot#>>'{seller,defaultPkgHeightCm}')::double precision
    );
    source_package_complete := source_weight > 0 AND source_weight <= 500000
      AND source_length > 0 AND source_length <= 1000
      AND source_width > 0 AND source_width <= 1000
      AND source_height > 0 AND source_height <= 1000;

    source_listing_snapshot := pg_catalog.jsonb_build_object(
      'title', source_item#>>'{listing,title}',
      'description', source_item#>>'{listing,description}',
      'priceCents', source_unit_price_cents,
      'imageUrls', source_item#>'{listing,imageUrls}',
      'category', source_item#>'{listing,category}',
      'tags', source_item#>'{listing,tags}',
      'sellerName', source_snapshot#>>'{seller,displayName}',
      'capturedAt', pg_catalog.to_char(p_paid_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'listingType', source_item#>>'{listing,listingType}',
      'processingTimeMinDays', source_item#>'{listing,processingTimeMinDays}',
      'processingTimeMaxDays', source_item#>'{listing,processingTimeMaxDays}',
      'shipsWithinDays', source_item#>'{listing,shipsWithinDays}',
      'shippingWeightGrams', CASE WHEN source_package_complete THEN source_weight ELSE NULL END,
      'shippingLengthCm', CASE WHEN source_package_complete THEN source_length ELSE NULL END,
      'shippingWidthCm', CASE WHEN source_package_complete THEN source_width ELSE NULL END,
      'shippingHeightCm', CASE WHEN source_package_complete THEN source_height ELSE NULL END,
      'shippingPackageComplete', source_package_complete
    );

    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "sellerProfileId", quantity,
      "priceCents", "listingSnapshot", "selectedVariants", "createdAt"
    ) VALUES (
      pg_catalog.gen_random_uuid()::text, source_order_id, source_listing_id,
      source_seller_id, (provider_item->>'quantity')::integer,
      source_unit_price_cents, source_listing_snapshot,
      CASE WHEN source_selected_variants = '[]'::jsonb THEN NULL
        ELSE source_selected_variants END,
      source_now
    );

    UPDATE public."Listing" AS listing
       SET status = 'SOLD_OUT'
     WHERE listing.id = source_listing_id
       AND listing."listingType" = 'IN_STOCK'
       AND listing."stockQuantity" <= 0
       AND listing.status = 'ACTIVE';
    source_listing_visibility_changed := source_listing_visibility_changed OR FOUND;
  END LOOP;

  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId",
    reason, metadata, "createdAt"
  ) VALUES (
    'stripe-checkout-order:' || pg_catalog.gen_random_uuid()::text,
    'webhook', p_event_id, 'STRIPE_CHECKOUT_ORDER_CREATED',
    'ORDER', source_order_id, pg_catalog.left(NULLIF(source_invalid_reason, ''), 1000),
    pg_catalog.jsonb_build_object(
      'stripeEventType', source_event.type,
      'stripeSessionId', p_session_id,
      'stripePaymentIntentId', p_provider->>'stripePaymentIntentId',
      'stripeChargeId', p_provider->>'stripeChargeId',
      'checkoutMode', source_mode,
      'reviewNeeded', source_review_needed,
      'invalidReason', NULLIF(source_invalid_reason, ''),
      'itemCount', pg_catalog.jsonb_array_length(source_items),
      'currency', p_provider->>'currency',
      'chargedTotalCents', (p_provider->>'chargedTotalCents')::integer,
      'itemsSubtotalCents', (p_provider->>'itemsSubtotalCents')::integer,
      'shippingAmountCents', (p_provider->>'shippingAmountCents')::integer,
      'taxAmountCents', (p_provider->>'taxAmountCents')::integer
    ), source_now
  );

  SELECT public.grainline_checkout_reservation_complete(
    p_event_id, p_claim_generation, p_reservation_id, p_session_id
  ) INTO STRICT source_completion_result;
  IF source_completion_result <> 'completed' THEN
    RAISE EXCEPTION 'Paid checkout reservation completion failed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF source_mode = 'cart' THEN
    DELETE FROM public."CartItem" AS cart_item
     WHERE cart_item.id IN (
       SELECT retained.item->>'cartItemId'
         FROM pg_catalog.jsonb_array_elements(source_items) AS retained(item)
     );
  END IF;

  RETURN QUERY SELECT
    'created', source_order_id, NULLIF(source_invalid_reason, ''),
    CASE WHEN source_seller_invalid_reason IS NULL
      THEN ARRAY[]::text[] ELSE ARRAY[source_seller_user_id]::text[] END,
    source_listing_visibility_changed;
END;
$grainline_stripe_checkout_order_create$;

REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_order_create(
  text, bigint, text, text, timestamp without time zone, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grainline_stripe_checkout_order_create(
  text, bigint, text, text, timestamp without time zone, jsonb
) TO grainline_app_runtime;

COMMIT;
