-- Compatible Order participant-detail projection successor.
--
-- The predecessor detail functions remain owner-private building blocks. The
-- v2 functions add active-actor checks, suppress unavailable counterparty
-- contact targets, enforce buyer-data purge semantics for seller notes, strip
-- unused historical snapshot keys, and expose label download material only
-- for a purchased label. This migration does not enable RLS, change table
-- grants, mutate rows, or switch application readers.

CREATE FUNCTION public.grainline_order_buyer_detail_v2(
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
AS $grainline_order_buyer_detail_v2$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Buyer Order detail v2 input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
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
    CASE
      WHEN seller_user.id IS NOT NULL
       AND seller_user.banned = false
       AND seller_user."deletedAt" IS NULL
        THEN detail.seller_user_id
      ELSE NULL
    END,
    sanitized_items.items
  FROM public.grainline_order_buyer_detail(p_actor_user_id, p_order_id) AS detail
  JOIN public."User" AS actor
    ON actor.id = p_actor_user_id
   AND actor.banned = false
   AND actor."deletedAt" IS NULL
  LEFT JOIN public."User" AS seller_user
    ON seller_user.id = detail.seller_user_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', item.value->'id',
          'listingId', item.value->'listingId',
          'priceCents', item.value->'priceCents',
          'quantity', item.value->'quantity',
          'listingActive', item.value->'listingActive',
          'listingSnapshot', CASE
            WHEN pg_catalog.jsonb_typeof(item.value->'listingSnapshot') = 'object'
              THEN pg_catalog.jsonb_build_object(
                'title', item.value->'listingSnapshot'->'title',
                'imageUrls', item.value->'listingSnapshot'->'imageUrls',
                'sellerName', item.value->'listingSnapshot'->'sellerName',
                'listingType', item.value->'listingSnapshot'->'listingType',
                'processingTimeMinDays', item.value->'listingSnapshot'->'processingTimeMinDays',
                'processingTimeMaxDays', item.value->'listingSnapshot'->'processingTimeMaxDays',
                'shipsWithinDays', item.value->'listingSnapshot'->'shipsWithinDays'
              )
            ELSE NULL
          END,
          'selectedVariants', item.value->'selectedVariants'
        )
        ORDER BY item.ordinality
      ),
      '[]'::jsonb
    ) AS items
    FROM pg_catalog.jsonb_array_elements(detail.items)
      WITH ORDINALITY AS item(value, ordinality)
  ) AS sanitized_items;
END;
$grainline_order_buyer_detail_v2$;

CREATE FUNCTION public.grainline_order_seller_detail_v2(
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
AS $grainline_order_seller_detail_v2$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Seller Order detail v2 input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
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
    CASE
      WHEN detail.buyer_data_purged_at_epoch_millis IS NULL
       AND buyer.id IS NOT NULL
       AND buyer.banned = false
       AND buyer."deletedAt" IS NULL
        THEN detail.buyer_id
      ELSE NULL
    END,
    detail.buyer_name,
    detail.buyer_email,
    detail.buyer_deleted_at_epoch_millis,
    CASE
      WHEN detail.buyer_data_purged_at_epoch_millis IS NULL
        THEN detail.seller_notes
      ELSE NULL
    END,
    detail.seller_refund_state,
    detail.seller_refund_amount_cents,
    detail.label_status,
    CASE WHEN detail.label_status = 'PURCHASED' THEN detail.label_url ELSE NULL END,
    CASE WHEN detail.label_status = 'PURCHASED' THEN detail.label_carrier ELSE NULL END,
    CASE WHEN detail.label_status = 'PURCHASED' THEN detail.label_tracking_number ELSE NULL END,
    CASE WHEN detail.label_status = 'PURCHASED' THEN detail.label_purchased_at_epoch_millis ELSE NULL END,
    sanitized_items.items
  FROM public.grainline_order_seller_detail(p_actor_user_id, p_order_id) AS detail
  JOIN public."User" AS actor
    ON actor.id = p_actor_user_id
   AND actor.banned = false
   AND actor."deletedAt" IS NULL
  LEFT JOIN public."User" AS buyer
    ON buyer.id = detail.buyer_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', item.value->'id',
          'listingId', item.value->'listingId',
          'priceCents', item.value->'priceCents',
          'quantity', item.value->'quantity',
          'listingActive', item.value->'listingActive',
          'listingSnapshot', CASE
            WHEN pg_catalog.jsonb_typeof(item.value->'listingSnapshot') = 'object'
              THEN pg_catalog.jsonb_build_object(
                'title', item.value->'listingSnapshot'->'title',
                'imageUrls', item.value->'listingSnapshot'->'imageUrls',
                'sellerName', item.value->'listingSnapshot'->'sellerName',
                'listingType', item.value->'listingSnapshot'->'listingType',
                'processingTimeMinDays', item.value->'listingSnapshot'->'processingTimeMinDays',
                'processingTimeMaxDays', item.value->'listingSnapshot'->'processingTimeMaxDays',
                'shipsWithinDays', item.value->'listingSnapshot'->'shipsWithinDays'
              )
            ELSE NULL
          END,
          'selectedVariants', item.value->'selectedVariants'
        )
        ORDER BY item.ordinality
      ),
      '[]'::jsonb
    ) AS items
    FROM pg_catalog.jsonb_array_elements(detail.items)
      WITH ORDINALITY AS item(value, ordinality)
  ) AS sanitized_items;
END;
$grainline_order_seller_detail_v2$;

REVOKE ALL ON FUNCTION public.grainline_order_buyer_detail(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_seller_detail(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_buyer_detail_v2(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_seller_detail_v2(text, text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_detail_v2(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_detail_v2(text, text)
  TO grainline_app_runtime;
