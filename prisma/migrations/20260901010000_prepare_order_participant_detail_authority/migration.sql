-- Compatible participant Order-detail authority preparation.
--
-- This migration is additive. It does not enable RLS, revoke predecessor
-- table grants, mutate rows, or switch application readers. The two fixed
-- SECURITY DEFINER functions bind the actor and Order lookup in PostgreSQL,
-- expose actor-specific columns, derive participant-safe status fields, and
-- return a bounded, fixed-key historical item projection in one statement.

CREATE FUNCTION public.grainline_order_buyer_detail(
  p_actor_user_id text,
  p_order_id text
)
RETURNS TABLE(
  order_id text,
  created_at_epoch_millis bigint,
  paid_at_epoch_millis bigint,
  currency text,
  items_subtotal_cents integer,
  shipping_title text,
  shipping_amount_cents integer,
  tax_amount_cents integer,
  fulfillment_method text,
  fulfillment_status text,
  tracking_carrier text,
  tracking_number text,
  pickup_ready_at_epoch_millis bigint,
  picked_up_at_epoch_millis bigint,
  shipped_at_epoch_millis bigint,
  delivered_at_epoch_millis bigint,
  estimated_delivery_at_epoch_millis bigint,
  shipping_carrier text,
  shipping_service text,
  review_needed boolean,
  gift_note text,
  gift_wrapping boolean,
  gift_wrapping_price_cents integer,
  buyer_data_purged_at_epoch_millis bigint,
  ship_to_line_1 text,
  ship_to_line_2 text,
  ship_to_city text,
  ship_to_state text,
  ship_to_postal_code text,
  ship_to_country text,
  seller_refund_state text,
  seller_refund_amount_cents integer,
  seller_user_id text,
  items jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_detail$
DECLARE
  item_count integer;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Buyer Order detail input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO STRICT item_count
    FROM public."OrderItem" AS source_item
    JOIN public."Order" AS source_order
      ON source_order.id = source_item."orderId"
     AND source_order."buyerId" = p_actor_user_id
   WHERE source_item."orderId" = p_order_id;

  IF item_count > 100 THEN
    RAISE EXCEPTION 'Buyer Order detail item count exceeds limit'
      USING ERRCODE = 'program_limit_exceeded';
  END IF;

  RETURN QUERY
  SELECT
    source_order.id,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint,
    CASE WHEN source_order."paidAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."paidAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    source_order.currency::text,
    source_order."itemsSubtotalCents",
    source_order."shippingTitle"::text,
    source_order."shippingAmountCents",
    source_order."taxAmountCents",
    source_order."fulfillmentMethod"::text,
    source_order."fulfillmentStatus"::text,
    source_order."trackingCarrier"::text,
    source_order."trackingNumber"::text,
    CASE WHEN source_order."pickupReadyAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."pickupReadyAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN source_order."pickedUpAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."pickedUpAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN source_order."shippedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."shippedAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN source_order."deliveredAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."deliveredAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN source_order."estimatedDeliveryDate" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."estimatedDeliveryDate" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    source_order."shippingCarrier"::text,
    source_order."shippingService"::text,
    source_order."reviewNeeded",
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."giftNote"::text ELSE NULL END,
    source_order."giftWrapping",
    source_order."giftWrappingPriceCents",
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."buyerDataPurgedAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToLine1"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToLine2"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToCity"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToState"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToPostalCode"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToCountry"::text ELSE NULL END,
    CASE
      WHEN source_order."sellerRefundId" IS NULL THEN 'NONE'
      WHEN source_order."sellerRefundId" = 'pending' THEN 'PROCESSING'
      WHEN source_order."sellerRefundId" = 'ambiguous_refund_pending_reconciliation' THEN 'AMBIGUOUS'
      ELSE 'RECORDED'
    END,
    CASE
      WHEN source_order."sellerRefundId" IS NULL
        OR source_order."sellerRefundId" IN ('pending', 'ambiguous_refund_pending_reconciliation')
        THEN NULL
      ELSE source_order."sellerRefundAmountCents"
    END,
    seller."userId",
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', source_item.id,
          'listingId', source_item."listingId",
          'priceCents', source_item."priceCents",
          'quantity', source_item.quantity,
          'listingActive', COALESCE(source_listing.status::text = 'ACTIVE', false),
          'listingSnapshot', CASE
            WHEN source_item."listingSnapshot" IS NULL THEN NULL
            ELSE pg_catalog.jsonb_build_object(
              'title', source_item."listingSnapshot"->'title',
              'description', source_item."listingSnapshot"->'description',
              'priceCents', source_item."listingSnapshot"->'priceCents',
              'imageUrls', source_item."listingSnapshot"->'imageUrls',
              'category', source_item."listingSnapshot"->'category',
              'tags', source_item."listingSnapshot"->'tags',
              'sellerName', source_item."listingSnapshot"->'sellerName',
              'capturedAt', source_item."listingSnapshot"->'capturedAt',
              'listingType', source_item."listingSnapshot"->'listingType',
              'processingTimeMinDays', source_item."listingSnapshot"->'processingTimeMinDays',
              'processingTimeMaxDays', source_item."listingSnapshot"->'processingTimeMaxDays',
              'shipsWithinDays', source_item."listingSnapshot"->'shipsWithinDays'
            )
          END,
          'selectedVariants', CASE
            WHEN pg_catalog.jsonb_typeof(source_item."selectedVariants") <> 'array' THEN NULL
            ELSE COALESCE((
              SELECT pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'groupName', variant.value->'groupName',
                  'optionLabel', variant.value->'optionLabel',
                  'priceAdjustCents', variant.value->'priceAdjustCents'
                )
                ORDER BY variant.ordinality
              )
              FROM pg_catalog.jsonb_array_elements(source_item."selectedVariants")
                WITH ORDINALITY AS variant(value, ordinality)
            ), '[]'::jsonb)
          END
        )
        ORDER BY source_item."createdAt", source_item.id
      )
      FROM public."OrderItem" AS source_item
      LEFT JOIN public."Listing" AS source_listing
        ON source_listing.id = source_item."listingId"
      WHERE source_item."orderId" = source_order.id
    ), '[]'::jsonb)
  FROM public."Order" AS source_order
  JOIN public."SellerProfile" AS seller
    ON seller.id = source_order."sellerProfileId"
  WHERE source_order.id = p_order_id
    AND source_order."buyerId" = p_actor_user_id;
END
$grainline_order_buyer_detail$;

CREATE FUNCTION public.grainline_order_seller_detail(
  p_actor_user_id text,
  p_order_id text
)
RETURNS TABLE(
  order_id text,
  created_at_epoch_millis bigint,
  paid_at_epoch_millis bigint,
  currency text,
  items_subtotal_cents integer,
  shipping_title text,
  shipping_amount_cents integer,
  tax_amount_cents integer,
  fulfillment_method text,
  fulfillment_status text,
  tracking_carrier text,
  tracking_number text,
  pickup_ready_at_epoch_millis bigint,
  picked_up_at_epoch_millis bigint,
  shipped_at_epoch_millis bigint,
  delivered_at_epoch_millis bigint,
  estimated_delivery_at_epoch_millis bigint,
  processing_deadline_epoch_millis bigint,
  shipping_carrier text,
  shipping_service text,
  review_needed boolean,
  deauthorized_review_hold boolean,
  gift_note text,
  gift_wrapping boolean,
  gift_wrapping_price_cents integer,
  buyer_data_purged_at_epoch_millis bigint,
  ship_to_line_1 text,
  ship_to_line_2 text,
  ship_to_city text,
  ship_to_state text,
  ship_to_postal_code text,
  ship_to_country text,
  buyer_id text,
  buyer_name text,
  buyer_email text,
  buyer_deleted_at_epoch_millis bigint,
  seller_notes text,
  seller_refund_state text,
  seller_refund_amount_cents integer,
  label_status text,
  label_url text,
  label_carrier text,
  label_tracking_number text,
  label_purchased_at_epoch_millis bigint,
  items jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_detail$
DECLARE
  item_count integer;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Seller Order detail input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO STRICT item_count
    FROM public."OrderItem" AS source_item
    JOIN public."Order" AS source_order
      ON source_order.id = source_item."orderId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = source_order."sellerProfileId"
     AND seller."userId" = p_actor_user_id
   WHERE source_item."orderId" = p_order_id;

  IF item_count > 100 THEN
    RAISE EXCEPTION 'Seller Order detail item count exceeds limit'
      USING ERRCODE = 'program_limit_exceeded';
  END IF;

  RETURN QUERY
  SELECT
    source_order.id,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint,
    CASE WHEN source_order."paidAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."paidAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    source_order.currency::text,
    source_order."itemsSubtotalCents",
    source_order."shippingTitle"::text,
    source_order."shippingAmountCents",
    source_order."taxAmountCents",
    source_order."fulfillmentMethod"::text,
    source_order."fulfillmentStatus"::text,
    source_order."trackingCarrier"::text,
    source_order."trackingNumber"::text,
    CASE WHEN source_order."pickupReadyAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."pickupReadyAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN source_order."pickedUpAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."pickedUpAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN source_order."shippedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."shippedAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN source_order."deliveredAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."deliveredAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN source_order."estimatedDeliveryDate" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."estimatedDeliveryDate" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN source_order."processingDeadline" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."processingDeadline" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    source_order."shippingCarrier"::text,
    source_order."shippingService"::text,
    source_order."reviewNeeded",
    COALESCE(
      source_order."reviewNeeded"
        AND source_order."reviewNote" LIKE 'Seller Stripe account was deauthorized after payment.%',
      false
    ),
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."giftNote"::text ELSE NULL END,
    source_order."giftWrapping",
    source_order."giftWrappingPriceCents",
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."buyerDataPurgedAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToLine1"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToLine2"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToCity"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToState"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToPostalCode"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToCountry"::text ELSE NULL END,
    source_order."buyerId",
    CASE
      WHEN source_order."buyerDataPurgedAt" IS NOT NULL OR buyer."deletedAt" IS NOT NULL
        THEN NULL
      ELSE source_order."buyerName"::text
    END,
    CASE
      WHEN source_order."buyerDataPurgedAt" IS NOT NULL OR buyer."deletedAt" IS NOT NULL
        THEN NULL
      ELSE source_order."buyerEmail"::text
    END,
    CASE WHEN buyer."deletedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (buyer."deletedAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    source_order."sellerNotes"::text,
    CASE
      WHEN source_order."sellerRefundId" IS NULL THEN 'NONE'
      WHEN source_order."sellerRefundId" = 'pending' THEN 'PROCESSING'
      WHEN source_order."sellerRefundId" = 'ambiguous_refund_pending_reconciliation' THEN 'AMBIGUOUS'
      ELSE 'RECORDED'
    END,
    CASE
      WHEN source_order."sellerRefundId" IS NULL
        OR source_order."sellerRefundId" IN ('pending', 'ambiguous_refund_pending_reconciliation')
        THEN NULL
      ELSE source_order."sellerRefundAmountCents"
    END,
    source_order."labelStatus"::text,
    source_order."labelUrl"::text,
    source_order."labelCarrier"::text,
    source_order."labelTrackingNumber"::text,
    CASE WHEN source_order."labelPurchasedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."labelPurchasedAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', source_item.id,
          'listingId', source_item."listingId",
          'priceCents', source_item."priceCents",
          'quantity', source_item.quantity,
          'listingActive', COALESCE(source_listing.status::text = 'ACTIVE', false),
          'listingSnapshot', CASE
            WHEN source_item."listingSnapshot" IS NULL THEN NULL
            ELSE pg_catalog.jsonb_build_object(
              'title', source_item."listingSnapshot"->'title',
              'description', source_item."listingSnapshot"->'description',
              'priceCents', source_item."listingSnapshot"->'priceCents',
              'imageUrls', source_item."listingSnapshot"->'imageUrls',
              'category', source_item."listingSnapshot"->'category',
              'tags', source_item."listingSnapshot"->'tags',
              'sellerName', source_item."listingSnapshot"->'sellerName',
              'capturedAt', source_item."listingSnapshot"->'capturedAt',
              'listingType', source_item."listingSnapshot"->'listingType',
              'processingTimeMinDays', source_item."listingSnapshot"->'processingTimeMinDays',
              'processingTimeMaxDays', source_item."listingSnapshot"->'processingTimeMaxDays',
              'shipsWithinDays', source_item."listingSnapshot"->'shipsWithinDays'
            )
          END,
          'selectedVariants', CASE
            WHEN pg_catalog.jsonb_typeof(source_item."selectedVariants") <> 'array' THEN NULL
            ELSE COALESCE((
              SELECT pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'groupName', variant.value->'groupName',
                  'optionLabel', variant.value->'optionLabel',
                  'priceAdjustCents', variant.value->'priceAdjustCents'
                )
                ORDER BY variant.ordinality
              )
              FROM pg_catalog.jsonb_array_elements(source_item."selectedVariants")
                WITH ORDINALITY AS variant(value, ordinality)
            ), '[]'::jsonb)
          END
        )
        ORDER BY source_item."createdAt", source_item.id
      )
      FROM public."OrderItem" AS source_item
      LEFT JOIN public."Listing" AS source_listing
        ON source_listing.id = source_item."listingId"
      WHERE source_item."orderId" = source_order.id
    ), '[]'::jsonb)
  FROM public."Order" AS source_order
  JOIN public."SellerProfile" AS seller
    ON seller.id = source_order."sellerProfileId"
   AND seller."userId" = p_actor_user_id
  LEFT JOIN public."User" AS buyer
    ON buyer.id = source_order."buyerId"
  WHERE source_order.id = p_order_id;
END
$grainline_order_seller_detail$;

REVOKE ALL ON FUNCTION public.grainline_order_buyer_detail(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_seller_detail(text, text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_detail(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_detail(text, text)
  TO grainline_app_runtime;
