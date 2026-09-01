-- Compatible participant Order account-export authority preparation.
--
-- This migration is additive. It does not enable RLS, revoke predecessor
-- table grants, mutate rows, or change existing application behavior. The
-- two fixed SECURITY DEFINER functions expose only actor-bound, bounded
-- export pages. Raw shipping-quote and provider identity material is
-- intentionally outside this contract.

CREATE FUNCTION public.grainline_order_buyer_export_page(
  p_actor_user_id text,
  p_limit integer,
  p_before_created_at_epoch_millis bigint,
  p_before_order_id text
)
RETURNS TABLE(
  order_data jsonb,
  created_at_epoch_millis bigint,
  order_id text
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_export_page$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25
     OR (p_before_created_at_epoch_millis IS NULL) <> (p_before_order_id IS NULL)
     OR (
       p_before_created_at_epoch_millis IS NOT NULL
       AND p_before_created_at_epoch_millis NOT BETWEEN 0 AND 253402300799999
     )
     OR (
       p_before_order_id IS NOT NULL
       AND pg_catalog.char_length(pg_catalog.btrim(p_before_order_id)) NOT BETWEEN 1 AND 191
     ) THEN
    RAISE EXCEPTION 'Buyer Order export input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    pg_catalog.jsonb_build_object(
      'id', source_order.id,
      'createdAtEpochMillis', pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint,
      'paidAtEpochMillis', CASE WHEN source_order."paidAt" IS NULL THEN NULL ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."paidAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint END,
      'currency', source_order.currency::text,
      'itemsSubtotalCents', source_order."itemsSubtotalCents",
      'shippingTitle', source_order."shippingTitle"::text,
      'shippingAmountCents', source_order."shippingAmountCents",
      'taxAmountCents', source_order."taxAmountCents",
      'buyerEmail', CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."buyerEmail"::text ELSE NULL END,
      'buyerName', CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."buyerName"::text ELSE NULL END,
      'shipToLine1', CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToLine1"::text ELSE NULL END,
      'shipToLine2', CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToLine2"::text ELSE NULL END,
      'shipToCity', CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToCity"::text ELSE NULL END,
      'shipToState', CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToState"::text ELSE NULL END,
      'shipToPostalCode', CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToPostalCode"::text ELSE NULL END,
      'shipToCountry', CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToCountry"::text ELSE NULL END,
      'fulfillmentMethod', source_order."fulfillmentMethod"::text,
      'fulfillmentStatus', source_order."fulfillmentStatus"::text,
      'trackingCarrier', source_order."trackingCarrier"::text,
      'trackingNumber', source_order."trackingNumber"::text,
      'shippedAtEpochMillis', CASE WHEN source_order."shippedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."shippedAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint END,
      'deliveredAtEpochMillis', CASE WHEN source_order."deliveredAt" IS NULL THEN NULL ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."deliveredAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint END,
      'sellerRefundState', CASE
        WHEN source_order."sellerRefundId" IS NULL THEN 'NONE'
        WHEN source_order."sellerRefundId" = 'pending' THEN 'PROCESSING'
        WHEN source_order."sellerRefundId" = 'ambiguous_refund_pending_reconciliation' THEN 'AMBIGUOUS'
        ELSE 'RECORDED'
      END,
      'sellerRefundAmountCents', CASE
        WHEN source_order."sellerRefundId" IS NULL
          OR source_order."sellerRefundId" IN ('pending', 'ambiguous_refund_pending_reconciliation')
          THEN NULL
        ELSE source_order."sellerRefundAmountCents"
      END,
      'giftNote', CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."giftNote"::text ELSE NULL END,
      'giftWrapping', source_order."giftWrapping",
      'giftWrappingPriceCents', source_order."giftWrappingPriceCents",
      'buyerDataPurgedAtEpochMillis', CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."buyerDataPurgedAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint END,
      'items', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'listingId', export_item."listingId",
            'quantity', export_item.quantity,
            'priceCents', export_item."priceCents",
            'selectedVariants', CASE
              WHEN pg_catalog.jsonb_typeof(export_item."selectedVariants") <> 'array' THEN NULL
              ELSE COALESCE((
                SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'groupName', variant.value->'groupName',
                  'optionLabel', variant.value->'optionLabel',
                  'priceAdjustCents', variant.value->'priceAdjustCents'
                ) ORDER BY variant.ordinality)
                  FROM pg_catalog.jsonb_array_elements(export_item."selectedVariants")
                    WITH ORDINALITY AS variant(value, ordinality)
              ), '[]'::jsonb)
            END,
            'listingSnapshot', CASE WHEN export_item."listingSnapshot" IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
              'title', export_item."listingSnapshot"->'title',
              'description', export_item."listingSnapshot"->'description',
              'priceCents', export_item."listingSnapshot"->'priceCents',
              'imageUrls', export_item."listingSnapshot"->'imageUrls',
              'category', export_item."listingSnapshot"->'category',
              'tags', export_item."listingSnapshot"->'tags',
              'sellerName', export_item."listingSnapshot"->'sellerName',
              'capturedAt', export_item."listingSnapshot"->'capturedAt',
              'listingType', export_item."listingSnapshot"->'listingType',
              'processingTimeMinDays', export_item."listingSnapshot"->'processingTimeMinDays',
              'processingTimeMaxDays', export_item."listingSnapshot"->'processingTimeMaxDays',
              'shipsWithinDays', export_item."listingSnapshot"->'shipsWithinDays'
            ) END
          ) ORDER BY export_item."createdAt", export_item.id
        )
          FROM (
            SELECT source_item.*
              FROM public."OrderItem" AS source_item
             WHERE source_item."orderId" = source_order.id
             ORDER BY source_item."createdAt", source_item.id
             LIMIT 101
          ) AS export_item
      ), '[]'::jsonb)
    ),
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint,
    source_order.id
  FROM public."Order" AS source_order
  WHERE source_order."buyerId" = p_actor_user_id
    AND (
      p_before_created_at_epoch_millis IS NULL
      OR (source_order."createdAt", source_order.id) < (
        (
          pg_catalog.to_timestamp(p_before_created_at_epoch_millis::double precision / 1000.0)
          AT TIME ZONE 'UTC'
        )::timestamp(3) without time zone,
        p_before_order_id
      )
    )
  ORDER BY source_order."createdAt" DESC, source_order.id DESC
  LIMIT p_limit;
END
$grainline_order_buyer_export_page$;

CREATE FUNCTION public.grainline_order_seller_export_page(
  p_actor_user_id text,
  p_limit integer,
  p_before_created_at_epoch_millis bigint,
  p_before_order_id text
)
RETURNS TABLE(
  order_data jsonb,
  created_at_epoch_millis bigint,
  order_id text
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_export_page$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25
     OR (p_before_created_at_epoch_millis IS NULL) <> (p_before_order_id IS NULL)
     OR (
       p_before_created_at_epoch_millis IS NOT NULL
       AND p_before_created_at_epoch_millis NOT BETWEEN 0 AND 253402300799999
     )
     OR (
       p_before_order_id IS NOT NULL
       AND pg_catalog.char_length(pg_catalog.btrim(p_before_order_id)) NOT BETWEEN 1 AND 191
     ) THEN
    RAISE EXCEPTION 'Seller Order export input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    pg_catalog.jsonb_build_object(
      'id', source_order.id,
      'createdAtEpochMillis', pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint,
      'paidAtEpochMillis', CASE WHEN source_order."paidAt" IS NULL THEN NULL ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."paidAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint END,
      'currency', source_order.currency::text,
      'itemsSubtotalCents', source_order."itemsSubtotalCents",
      'shippingTitle', source_order."shippingTitle"::text,
      'shippingAmountCents', source_order."shippingAmountCents",
      'taxAmountCents', source_order."taxAmountCents",
      'fulfillmentMethod', source_order."fulfillmentMethod"::text,
      'fulfillmentStatus', source_order."fulfillmentStatus"::text,
      'trackingCarrier', source_order."trackingCarrier"::text,
      'trackingNumber', source_order."trackingNumber"::text,
      'shippedAtEpochMillis', CASE WHEN source_order."shippedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."shippedAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint END,
      'deliveredAtEpochMillis', CASE WHEN source_order."deliveredAt" IS NULL THEN NULL ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."deliveredAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint END,
      'sellerRefundState', CASE
        WHEN source_order."sellerRefundId" IS NULL THEN 'NONE'
        WHEN source_order."sellerRefundId" = 'pending' THEN 'PROCESSING'
        WHEN source_order."sellerRefundId" = 'ambiguous_refund_pending_reconciliation' THEN 'AMBIGUOUS'
        ELSE 'RECORDED'
      END,
      'sellerRefundAmountCents', CASE
        WHEN source_order."sellerRefundId" IS NULL
          OR source_order."sellerRefundId" IN ('pending', 'ambiguous_refund_pending_reconciliation')
          THEN NULL
        ELSE source_order."sellerRefundAmountCents"
      END,
      'items', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'listingId', export_item."listingId",
            'quantity', export_item.quantity,
            'priceCents', export_item."priceCents",
            'selectedVariants', CASE
              WHEN pg_catalog.jsonb_typeof(export_item."selectedVariants") <> 'array' THEN NULL
              ELSE COALESCE((
                SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'groupName', variant.value->'groupName',
                  'optionLabel', variant.value->'optionLabel',
                  'priceAdjustCents', variant.value->'priceAdjustCents'
                ) ORDER BY variant.ordinality)
                  FROM pg_catalog.jsonb_array_elements(export_item."selectedVariants")
                    WITH ORDINALITY AS variant(value, ordinality)
              ), '[]'::jsonb)
            END,
            'listingSnapshot', CASE WHEN export_item."listingSnapshot" IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
              'title', export_item."listingSnapshot"->'title',
              'description', export_item."listingSnapshot"->'description',
              'priceCents', export_item."listingSnapshot"->'priceCents',
              'imageUrls', export_item."listingSnapshot"->'imageUrls',
              'category', export_item."listingSnapshot"->'category',
              'tags', export_item."listingSnapshot"->'tags',
              'sellerName', export_item."listingSnapshot"->'sellerName',
              'capturedAt', export_item."listingSnapshot"->'capturedAt',
              'listingType', export_item."listingSnapshot"->'listingType',
              'processingTimeMinDays', export_item."listingSnapshot"->'processingTimeMinDays',
              'processingTimeMaxDays', export_item."listingSnapshot"->'processingTimeMaxDays',
              'shipsWithinDays', export_item."listingSnapshot"->'shipsWithinDays'
            ) END
          ) ORDER BY export_item."createdAt", export_item.id
        )
          FROM (
            SELECT source_item.*
              FROM public."OrderItem" AS source_item
             WHERE source_item."orderId" = source_order.id
             ORDER BY source_item."createdAt", source_item.id
             LIMIT 101
          ) AS export_item
      ), '[]'::jsonb)
    ),
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint,
    source_order.id
  FROM public."Order" AS source_order
  JOIN public."SellerProfile" AS seller
    ON seller.id = source_order."sellerProfileId"
   AND seller."userId" = p_actor_user_id
  WHERE p_before_created_at_epoch_millis IS NULL
     OR (source_order."createdAt", source_order.id) < (
       (
         pg_catalog.to_timestamp(p_before_created_at_epoch_millis::double precision / 1000.0)
         AT TIME ZONE 'UTC'
       )::timestamp(3) without time zone,
       p_before_order_id
     )
  ORDER BY source_order."createdAt" DESC, source_order.id DESC
  LIMIT p_limit;
END
$grainline_order_seller_export_page$;

REVOKE ALL ON FUNCTION public.grainline_order_buyer_export_page(text, integer, bigint, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_export_page(text, integer, bigint, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_export_page(text, integer, bigint, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_export_page(text, integer, bigint, text)
  TO grainline_app_runtime;
