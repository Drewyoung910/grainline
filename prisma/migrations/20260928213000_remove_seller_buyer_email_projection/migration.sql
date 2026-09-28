BEGIN;

-- Sellers need a fulfillment name and shipping address, but they do not need
-- the buyer's account email. Keep the earlier projections executable during
-- the compatible application overlap and move the new application to
-- successors that omit buyer_email entirely.
CREATE FUNCTION public.grainline_order_seller_detail_v5(
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
  buyer_deleted_at_epoch_millis bigint,
  seller_notes text,
  seller_refund_state text,
  seller_refund_amount_cents integer,
  label_status text,
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
AS $grainline_order_seller_detail_v5$
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
    detail.buyer_deleted_at_epoch_millis,
    detail.seller_notes,
    detail.seller_refund_state,
    detail.seller_refund_amount_cents,
    detail.label_status,
    detail.label_carrier,
    detail.label_tracking_number,
    detail.label_purchased_at_epoch_millis,
    detail.items
  FROM public.grainline_order_seller_detail_v4(p_actor_user_id, p_order_id) AS detail;
$grainline_order_seller_detail_v5$;

CREATE FUNCTION public.grainline_order_seller_recent_sales_v2(
  p_actor_user_id text
)
RETURNS TABLE(
  order_id text,
  created_at_epoch_millis bigint,
  items_subtotal_cents integer,
  shipping_amount_cents integer,
  tax_amount_cents integer,
  gift_wrapping_price_cents integer,
  currency text,
  fulfillment_status text,
  first_item_price_cents integer,
  first_item_listing_snapshot jsonb,
  buyer_name text,
  buyer_data_purged_at_epoch_millis bigint,
  buyer_deleted_at_epoch_millis bigint
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_recent_sales_v2$
  SELECT
    sale.order_id,
    sale.created_at_epoch_millis,
    sale.items_subtotal_cents,
    sale.shipping_amount_cents,
    sale.tax_amount_cents,
    sale.gift_wrapping_price_cents,
    sale.currency,
    sale.fulfillment_status,
    sale.first_item_price_cents,
    sale.first_item_listing_snapshot,
    sale.buyer_name,
    sale.buyer_data_purged_at_epoch_millis,
    sale.buyer_deleted_at_epoch_millis
  FROM public.grainline_order_seller_recent_sales(p_actor_user_id) AS sale;
$grainline_order_seller_recent_sales_v2$;

REVOKE ALL ON FUNCTION public.grainline_order_seller_detail_v5(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_recent_sales_v2(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_order_seller_detail_v5(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_recent_sales_v2(text)
  TO grainline_app_runtime;

COMMIT;
