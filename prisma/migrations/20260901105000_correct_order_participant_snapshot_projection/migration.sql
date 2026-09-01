-- Compatible Order participant-detail snapshot correction.
--
-- The v2 projections intentionally narrowed historical listing snapshots too
-- far: the application snapshot validator requires the checkout-time price,
-- description, category, tags, and capture time as well as display fields.
-- These v3 wrappers preserve every v2 authorization and link decision while
-- restoring the complete retained OrderItem snapshot for entitled buyers and
-- sellers. The v2 functions remain executable during the deployment overlap.
-- This migration does not enable RLS, change table grants, or mutate rows.

CREATE FUNCTION public.grainline_order_buyer_detail_v3(
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
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_detail_v3$
  SELECT
    detail.order_id,
    detail.created_at_epoch_millis,
    detail.paid_at_epoch_millis,
    detail.currency,
    detail.items_subtotal_cents,
    detail.shipping_title,
    detail.shipping_amount_cents,
    detail.tax_amount_cents,
    detail.fulfillment_method,
    detail.fulfillment_status,
    detail.tracking_carrier,
    detail.tracking_number,
    detail.pickup_ready_at_epoch_millis,
    detail.picked_up_at_epoch_millis,
    detail.shipped_at_epoch_millis,
    detail.delivered_at_epoch_millis,
    detail.estimated_delivery_at_epoch_millis,
    detail.shipping_carrier,
    detail.shipping_service,
    detail.review_needed,
    detail.gift_note,
    detail.gift_wrapping,
    detail.gift_wrapping_price_cents,
    detail.buyer_data_purged_at_epoch_millis,
    detail.ship_to_line_1,
    detail.ship_to_line_2,
    detail.ship_to_city,
    detail.ship_to_state,
    detail.ship_to_postal_code,
    detail.ship_to_country,
    detail.seller_refund_state,
    detail.seller_refund_amount_cents,
    detail.seller_user_id,
    corrected_items.items
  FROM public.grainline_order_buyer_detail_v2(p_actor_user_id, p_order_id) AS detail
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        item.value || pg_catalog.jsonb_build_object(
          'listingSnapshot', CASE
            WHEN pg_catalog.jsonb_typeof(source_item."listingSnapshot") = 'object'
              THEN pg_catalog.jsonb_build_object(
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
            ELSE NULL
          END
        )
        ORDER BY item.ordinality
      ),
      '[]'::jsonb
    ) AS items
    FROM pg_catalog.jsonb_array_elements(detail.items)
      WITH ORDINALITY AS item(value, ordinality)
    LEFT JOIN public."OrderItem" AS source_item
      ON source_item.id = item.value->>'id'
     AND source_item."orderId" = detail.order_id
  ) AS corrected_items;
$grainline_order_buyer_detail_v3$;

CREATE FUNCTION public.grainline_order_seller_detail_v3(
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
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_detail_v3$
  SELECT
    detail.order_id,
    detail.created_at_epoch_millis,
    detail.paid_at_epoch_millis,
    detail.currency,
    detail.items_subtotal_cents,
    detail.shipping_title,
    detail.shipping_amount_cents,
    detail.tax_amount_cents,
    detail.fulfillment_method,
    detail.fulfillment_status,
    detail.tracking_carrier,
    detail.tracking_number,
    detail.pickup_ready_at_epoch_millis,
    detail.picked_up_at_epoch_millis,
    detail.shipped_at_epoch_millis,
    detail.delivered_at_epoch_millis,
    detail.estimated_delivery_at_epoch_millis,
    detail.processing_deadline_epoch_millis,
    detail.shipping_carrier,
    detail.shipping_service,
    detail.review_needed,
    detail.deauthorized_review_hold,
    detail.gift_note,
    detail.gift_wrapping,
    detail.gift_wrapping_price_cents,
    detail.buyer_data_purged_at_epoch_millis,
    detail.ship_to_line_1,
    detail.ship_to_line_2,
    detail.ship_to_city,
    detail.ship_to_state,
    detail.ship_to_postal_code,
    detail.ship_to_country,
    detail.buyer_id,
    detail.buyer_name,
    detail.buyer_email,
    detail.buyer_deleted_at_epoch_millis,
    detail.seller_notes,
    detail.seller_refund_state,
    detail.seller_refund_amount_cents,
    detail.label_status,
    detail.label_url,
    detail.label_carrier,
    detail.label_tracking_number,
    detail.label_purchased_at_epoch_millis,
    corrected_items.items
  FROM public.grainline_order_seller_detail_v2(p_actor_user_id, p_order_id) AS detail
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        item.value || pg_catalog.jsonb_build_object(
          'listingSnapshot', CASE
            WHEN pg_catalog.jsonb_typeof(source_item."listingSnapshot") = 'object'
              THEN pg_catalog.jsonb_build_object(
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
            ELSE NULL
          END
        )
        ORDER BY item.ordinality
      ),
      '[]'::jsonb
    ) AS items
    FROM pg_catalog.jsonb_array_elements(detail.items)
      WITH ORDINALITY AS item(value, ordinality)
    LEFT JOIN public."OrderItem" AS source_item
      ON source_item.id = item.value->>'id'
     AND source_item."orderId" = detail.order_id
  ) AS corrected_items;
$grainline_order_seller_detail_v3$;

REVOKE ALL ON FUNCTION public.grainline_order_buyer_detail_v3(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_seller_detail_v3(text, text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_detail_v3(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_detail_v3(text, text)
  TO grainline_app_runtime;
