-- Additive correction for staff Order totals after the exact charged-total
-- witness was introduced. The original dormant projections remain private;
-- these corrected wrappers are the only variants intended for application use.

CREATE FUNCTION public.grainline_order_staff_page_v2(
  p_actor_user_id text,
  p_scope text,
  p_requested_page integer,
  p_page_size integer
)
RETURNS TABLE(total_count bigint, safe_page integer, orders jsonb)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_staff_page_v2$
  WITH base AS (
    SELECT *
      FROM public.grainline_order_staff_page(
        p_actor_user_id,
        p_scope,
        p_requested_page,
        p_page_size
      )
  ),
  enriched AS (
    SELECT
      base.total_count,
      base.safe_page,
      entry.ordinality,
      entry.value || pg_catalog.jsonb_build_object(
        'chargedTotalCents', source_order."chargedTotalCents"
      ) AS value
      FROM base
      LEFT JOIN LATERAL pg_catalog.jsonb_array_elements(base.orders)
        WITH ORDINALITY AS entry(value, ordinality) ON true
      LEFT JOIN public."Order" AS source_order
        ON source_order.id = entry.value->>'id'
  )
  SELECT
    enriched.total_count,
    enriched.safe_page,
    COALESCE(
      pg_catalog.jsonb_agg(enriched.value ORDER BY enriched.ordinality)
        FILTER (WHERE enriched.value IS NOT NULL),
      '[]'::jsonb
    ) AS orders
    FROM enriched
   GROUP BY enriched.total_count, enriched.safe_page
$grainline_order_staff_page_v2$;

CREATE FUNCTION public.grainline_order_staff_detail_v2(
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
  items jsonb,
  charged_total_cents integer,
  seller_user_id text,
  seller_user_name text,
  seller_user_email text
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_staff_detail_v2$
  SELECT
    base.*,
    source_order."chargedTotalCents",
    seller_user.id,
    seller_user.name::text,
    seller_user.email::text
    FROM public.grainline_order_staff_detail(
      p_actor_user_id,
      p_order_id
    ) AS base
    INNER JOIN public."Order" AS source_order
      ON source_order.id = base.order_id
    LEFT JOIN public."SellerProfile" AS seller_profile
      ON seller_profile.id = base.seller_profile_id
    LEFT JOIN public."User" AS seller_user
      ON seller_user.id = seller_profile."userId"
$grainline_order_staff_detail_v2$;

REVOKE ALL ON FUNCTION public.grainline_order_staff_page_v2(text, text, integer, integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_staff_detail_v2(text, text)
  FROM PUBLIC, grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_order_staff_page_v2(text, text, integer, integer) IS
  'Dormant staff Order queue projection corrected to include the signed charged-total witness.';
COMMENT ON FUNCTION public.grainline_order_staff_detail_v2(text, text) IS
  'Dormant staff Order detail projection corrected to include the signed charged-total witness.';
