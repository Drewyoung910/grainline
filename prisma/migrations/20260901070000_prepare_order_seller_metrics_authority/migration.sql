-- Compatible fixed Order facts for Guild/service seller metrics. This adds one
-- aggregate-only operation and changes no RLS posture, table privilege, row,
-- provider state or predecessor application behavior.

BEGIN;

CREATE FUNCTION public.grainline_order_seller_metrics_facts(
  p_seller_profile_id text,
  p_period_start_epoch_millis bigint
)
RETURNS TABLE(
  seller_profile_id text,
  completed_order_count bigint,
  total_sales_cents bigint,
  shipped_count bigint,
  on_time_count bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_metrics_facts$
DECLARE
  period_start timestamp(3) without time zone;
  database_now timestamp(3) without time zone;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_period_start_epoch_millis IS NULL
     OR p_period_start_epoch_millis NOT BETWEEN 0 AND 253402300799999 THEN
    RAISE EXCEPTION 'Order seller-metrics input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  period_start := (
    pg_catalog.to_timestamp(
      p_period_start_epoch_millis::double precision / 1000.0
    ) AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;
  database_now := (
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;

  IF period_start > database_now + INTERVAL '5 minutes'
     OR period_start < database_now - INTERVAL '400 days' THEN
    RAISE EXCEPTION 'Order seller-metrics period is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."SellerProfile" AS seller
     WHERE seller.id = p_seller_profile_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH completed_sales AS (
    SELECT
      pg_catalog.count(DISTINCT source_order.id)::bigint AS order_count,
      COALESCE(
        pg_catalog.sum(
          source_item."priceCents"::bigint * source_item.quantity::bigint
        ),
        0::numeric
      )::bigint AS sales_cents
      FROM public."Order" AS source_order
      JOIN public."OrderItem" AS source_item
        ON source_item."orderId" = source_order.id
       AND source_item."sellerProfileId" = p_seller_profile_id
     WHERE source_order."sellerProfileId" = p_seller_profile_id
       AND source_order."paidAt" IS NOT NULL
       AND (
         source_order."stripeSessionId" IS NOT NULL
         OR source_order."stripePaymentIntentId" IS NOT NULL
         OR source_order."stripeChargeId" IS NOT NULL
       )
       AND source_order."fulfillmentStatus" IN (
         'DELIVERED'::public."FulfillmentStatus",
         'PICKED_UP'::public."FulfillmentStatus"
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
  ),
  shipping_summary AS (
    SELECT
      pg_catalog.count(*)::bigint AS shipped_count,
      pg_catalog.count(*) FILTER (
        WHERE source_order."shippedAt" <= source_order."processingDeadline"
      )::bigint AS on_time_count
      FROM public."Order" AS source_order
     WHERE source_order."sellerProfileId" = p_seller_profile_id
       AND source_order."paidAt" IS NOT NULL
       AND (
         source_order."stripeSessionId" IS NOT NULL
         OR source_order."stripePaymentIntentId" IS NOT NULL
         OR source_order."stripeChargeId" IS NOT NULL
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
       AND source_order."shippedAt" IS NOT NULL
       AND source_order."shippedAt" >= period_start
       AND source_order."processingDeadline" IS NOT NULL
  )
  SELECT
    p_seller_profile_id,
    completed_sales.order_count,
    completed_sales.sales_cents,
    shipping_summary.shipped_count,
    shipping_summary.on_time_count
    FROM completed_sales
    CROSS JOIN shipping_summary;
END
$grainline_order_seller_metrics_facts$;

REVOKE ALL ON FUNCTION public.grainline_order_seller_metrics_facts(
  text, bigint
) FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_order_seller_metrics_facts(
  text, bigint
) TO grainline_app_runtime;

COMMIT;
