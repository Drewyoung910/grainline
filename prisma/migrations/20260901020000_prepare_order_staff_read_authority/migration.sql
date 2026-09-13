-- Compatible staff Order read-authority preparation.
--
-- This migration is intentionally dormant. It adds two fixed projections but
-- grants them to neither PUBLIC nor the ordinary application runtime. A later
-- release may grant EXECUTE only to the separately provisioned
-- grainline_staff_read_runtime login after its credential and application
-- isolation have been proved. Both functions also require that exact
-- SESSION_USER and revalidate the supplied live staff actor row.

CREATE FUNCTION public.grainline_order_staff_page(
  p_actor_user_id text,
  p_scope text,
  p_requested_page integer,
  p_page_size integer
)
RETURNS TABLE(total_count bigint, safe_page integer, orders jsonb)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_staff_page$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_scope IS NULL OR p_scope NOT IN ('ALL', 'REVIEW_NEEDED')
     OR p_requested_page IS NULL OR p_requested_page NOT BETWEEN 1 AND 1000
     OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Staff Order page input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = p_actor_user_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
          AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
     ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH filtered_rows AS NOT MATERIALIZED (
    SELECT source_order.*
      FROM public."Order" AS source_order
     WHERE p_scope = 'ALL' OR source_order."reviewNeeded" = true
  ),
  pagination AS (
    SELECT
      pg_catalog.count(*)::bigint AS row_count,
      LEAST(
        p_requested_page,
        GREATEST(
          1,
          pg_catalog.ceil(
            pg_catalog.count(*)::numeric / p_page_size::numeric
          )::integer
        )
      ) AS page_number
      FROM filtered_rows
  ),
  page_rows AS (
    SELECT filtered_row.*
      FROM filtered_rows AS filtered_row
     ORDER BY filtered_row."createdAt" DESC, filtered_row.id DESC
     OFFSET ((SELECT page_number FROM pagination) - 1) * p_page_size
     LIMIT p_page_size
  ),
  projected_rows AS (
    SELECT
      page_row.id,
      page_row."createdAt",
      page_row.currency::text AS currency,
      page_row."itemsSubtotalCents",
      page_row."shippingAmountCents",
      page_row."taxAmountCents",
      page_row."giftWrappingPriceCents",
      page_row."quotedShippingAmountCents",
      page_row."fulfillmentStatus"::text AS fulfillment_status,
      page_row."reviewNeeded",
      page_row."reviewNote"::text AS review_note,
      CASE
        WHEN page_row."buyerDataPurgedAt" IS NOT NULL THEN 'Buyer data purged'
        ELSE COALESCE(
          NULLIF(page_row."buyerName"::text, ''),
          NULLIF(page_row."buyerEmail"::text, ''),
          NULLIF(buyer.name::text, ''),
          NULLIF(buyer.email::text, ''),
          'Deleted user'
        )
      END AS buyer_label,
      CASE
        WHEN page_row."buyerDataPurgedAt" IS NOT NULL OR buyer."deletedAt" IS NOT NULL
          THEN NULL
        ELSE COALESCE(page_row."buyerEmail"::text, buyer.email::text)
      END AS buyer_email,
      page_row."sellerProfileId",
      COALESCE(
        NULLIF(first_item.seller_name, ''),
        NULLIF(seller."displayName"::text, ''),
        'Unnamed seller'
      ) AS seller_label,
      item_summary.item_count,
      item_summary.items
      FROM page_rows AS page_row
      LEFT JOIN public."User" AS buyer ON buyer.id = page_row."buyerId"
      LEFT JOIN public."SellerProfile" AS seller
        ON seller.id = page_row."sellerProfileId"
      LEFT JOIN LATERAL (
        SELECT source_item."listingSnapshot"->>'sellerName' AS seller_name
          FROM public."OrderItem" AS source_item
         WHERE source_item."orderId" = page_row.id
         ORDER BY source_item."createdAt", source_item.id
         LIMIT 1
      ) AS first_item ON true
      CROSS JOIN LATERAL (
        SELECT
          (SELECT pg_catalog.count(*)::integer
             FROM public."OrderItem" AS counted_item
            WHERE counted_item."orderId" = page_row.id) AS item_count,
          COALESCE(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'title', COALESCE(
                  NULLIF(summary_item."listingSnapshot"->>'title', ''),
                  'Unavailable listing'
                ),
                'quantity', summary_item.quantity
              ) ORDER BY summary_item."createdAt", summary_item.id
            ) FILTER (WHERE summary_item.id IS NOT NULL),
            '[]'::jsonb
          ) AS items
          FROM (
            SELECT source_item.id, source_item.quantity,
                   source_item."listingSnapshot", source_item."createdAt"
              FROM public."OrderItem" AS source_item
             WHERE source_item."orderId" = page_row.id
             ORDER BY source_item."createdAt", source_item.id
             LIMIT 3
          ) AS summary_item
      ) AS item_summary
  )
  SELECT
    pagination.row_count,
    pagination.page_number,
    COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', projected_row.id,
          'createdAtEpochMillis', pg_catalog.floor(
            EXTRACT(EPOCH FROM (projected_row."createdAt" AT TIME ZONE 'UTC')) * 1000
          )::bigint,
          'currency', projected_row.currency,
          'itemsSubtotalCents', projected_row."itemsSubtotalCents",
          'shippingAmountCents', projected_row."shippingAmountCents",
          'taxAmountCents', projected_row."taxAmountCents",
          'giftWrappingPriceCents', projected_row."giftWrappingPriceCents",
          'quotedShippingAmountCents', projected_row."quotedShippingAmountCents",
          'fulfillmentStatus', projected_row.fulfillment_status,
          'reviewNeeded', projected_row."reviewNeeded",
          'reviewNote', projected_row.review_note,
          'buyerLabel', projected_row.buyer_label,
          'buyerEmail', projected_row.buyer_email,
          'sellerProfileId', projected_row."sellerProfileId",
          'sellerLabel', projected_row.seller_label,
          'itemCount', projected_row.item_count,
          'items', projected_row.items
        ) ORDER BY projected_row."createdAt" DESC, projected_row.id DESC
      ) FILTER (WHERE projected_row.id IS NOT NULL),
      '[]'::jsonb
    )
    FROM pagination
    LEFT JOIN projected_rows AS projected_row ON true
   GROUP BY pagination.row_count, pagination.page_number;
END
$grainline_order_staff_page$;

CREATE FUNCTION public.grainline_order_staff_detail(
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
  review_note text,
  gift_note text,
  gift_wrapping boolean,
  gift_wrapping_price_cents integer,
  buyer_data_purged_at_epoch_millis bigint,
  buyer_id text,
  buyer_name text,
  buyer_email text,
  ship_to_line_1 text,
  ship_to_line_2 text,
  ship_to_city text,
  ship_to_state text,
  ship_to_postal_code text,
  ship_to_country text,
  quoted_shipping_amount_cents integer,
  quoted_to_city text,
  quoted_to_state text,
  quoted_to_postal_code text,
  quoted_to_country text,
  quoted_use_calculated_shipping boolean,
  seller_profile_id text,
  seller_display_name text,
  seller_refund_state text,
  seller_refund_id text,
  seller_refund_amount_cents integer,
  refund_claim_state text,
  label_status text,
  label_clawback_status text,
  items jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_staff_detail$
DECLARE
  item_count integer;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Staff Order detail input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = p_actor_user_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
          AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
     ) THEN
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO STRICT item_count
    FROM public."OrderItem" AS source_item
   WHERE source_item."orderId" = p_order_id;
  IF item_count > 100 THEN
    RAISE EXCEPTION 'Staff Order detail item count exceeds limit'
      USING ERRCODE = 'program_limit_exceeded';
  END IF;

  RETURN QUERY
  SELECT
    source_order.id,
    pg_catalog.floor(EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000)::bigint,
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
    CASE WHEN source_order."pickupReadyAt" IS NULL THEN NULL ELSE pg_catalog.floor(EXTRACT(EPOCH FROM (source_order."pickupReadyAt" AT TIME ZONE 'UTC')) * 1000)::bigint END,
    CASE WHEN source_order."pickedUpAt" IS NULL THEN NULL ELSE pg_catalog.floor(EXTRACT(EPOCH FROM (source_order."pickedUpAt" AT TIME ZONE 'UTC')) * 1000)::bigint END,
    CASE WHEN source_order."shippedAt" IS NULL THEN NULL ELSE pg_catalog.floor(EXTRACT(EPOCH FROM (source_order."shippedAt" AT TIME ZONE 'UTC')) * 1000)::bigint END,
    CASE WHEN source_order."deliveredAt" IS NULL THEN NULL ELSE pg_catalog.floor(EXTRACT(EPOCH FROM (source_order."deliveredAt" AT TIME ZONE 'UTC')) * 1000)::bigint END,
    CASE WHEN source_order."estimatedDeliveryDate" IS NULL THEN NULL ELSE pg_catalog.floor(EXTRACT(EPOCH FROM (source_order."estimatedDeliveryDate" AT TIME ZONE 'UTC')) * 1000)::bigint END,
    CASE WHEN source_order."processingDeadline" IS NULL THEN NULL ELSE pg_catalog.floor(EXTRACT(EPOCH FROM (source_order."processingDeadline" AT TIME ZONE 'UTC')) * 1000)::bigint END,
    source_order."shippingCarrier"::text,
    source_order."shippingService"::text,
    source_order."reviewNeeded",
    source_order."reviewNote"::text,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."giftNote"::text ELSE NULL END,
    source_order."giftWrapping",
    source_order."giftWrappingPriceCents",
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN NULL ELSE pg_catalog.floor(EXTRACT(EPOCH FROM (source_order."buyerDataPurgedAt" AT TIME ZONE 'UTC')) * 1000)::bigint END,
    source_order."buyerId",
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL AND buyer."deletedAt" IS NULL THEN COALESCE(source_order."buyerName"::text, buyer.name::text) ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL AND buyer."deletedAt" IS NULL THEN COALESCE(source_order."buyerEmail"::text, buyer.email::text) ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToLine1"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToLine2"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToCity"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToState"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToPostalCode"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."shipToCountry"::text ELSE NULL END,
    source_order."quotedShippingAmountCents",
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."quotedToCity"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."quotedToState"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."quotedToPostalCode"::text ELSE NULL END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN source_order."quotedToCountry"::text ELSE NULL END,
    source_order."quotedUseCalculatedShipping",
    source_order."sellerProfileId",
    COALESCE(NULLIF(seller."displayName"::text, ''), 'Unnamed seller'),
    CASE WHEN source_order."sellerRefundId" IS NULL THEN 'NONE' WHEN source_order."sellerRefundId" = 'pending' THEN 'PROCESSING' WHEN source_order."sellerRefundId" = 'ambiguous_refund_pending_reconciliation' THEN 'AMBIGUOUS' ELSE 'RECORDED' END,
    CASE WHEN source_order."sellerRefundId" IS NULL OR source_order."sellerRefundId" IN ('pending', 'ambiguous_refund_pending_reconciliation') THEN NULL ELSE source_order."sellerRefundId"::text END,
    CASE WHEN source_order."sellerRefundId" IS NULL OR source_order."sellerRefundId" IN ('pending', 'ambiguous_refund_pending_reconciliation') THEN NULL ELSE source_order."sellerRefundAmountCents" END,
    CASE WHEN source_order."refundClaimId" IS NULL THEN NULL WHEN source_order."sellerRefundId" = 'ambiguous_refund_pending_reconciliation' THEN 'AMBIGUOUS' ELSE 'PENDING' END,
    source_order."labelStatus"::text,
    source_order."labelClawbackStatus"::text,
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', source_item.id,
          'listingId', source_item."listingId",
          'priceCents', source_item."priceCents",
          'quantity', source_item.quantity,
          'currentListingType', source_listing."listingType"::text,
          'listingActive', COALESCE(source_listing.status::text = 'ACTIVE', false),
          'listingSnapshot', CASE WHEN source_item."listingSnapshot" IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
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
          ) END,
          'selectedVariants', CASE WHEN pg_catalog.jsonb_typeof(source_item."selectedVariants") <> 'array' THEN NULL ELSE COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'groupName', variant.value->'groupName',
              'optionLabel', variant.value->'optionLabel',
              'priceAdjustCents', variant.value->'priceAdjustCents'
            ) ORDER BY variant.ordinality)
              FROM pg_catalog.jsonb_array_elements(source_item."selectedVariants")
                WITH ORDINALITY AS variant(value, ordinality)
          ), '[]'::jsonb) END
        ) ORDER BY source_item."createdAt", source_item.id
      )
      FROM public."OrderItem" AS source_item
      LEFT JOIN public."Listing" AS source_listing ON source_listing.id = source_item."listingId"
      WHERE source_item."orderId" = source_order.id
    ), '[]'::jsonb)
  FROM public."Order" AS source_order
  LEFT JOIN public."User" AS buyer ON buyer.id = source_order."buyerId"
  LEFT JOIN public."SellerProfile" AS seller ON seller.id = source_order."sellerProfileId"
  WHERE source_order.id = p_order_id;
END
$grainline_order_staff_detail$;

REVOKE ALL ON FUNCTION public.grainline_order_staff_page(text, text, integer, integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_staff_detail(text, text)
  FROM PUBLIC, grainline_app_runtime;
