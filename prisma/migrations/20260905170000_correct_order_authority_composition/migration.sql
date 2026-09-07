-- Correct the composed Order trust/refund boundaries found during the complete
-- pre-RLS audit. This successor preserves signatures, ownership, grants, RLS
-- posture and table data. It replaces only exact byte-attested function bodies.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order.authority-composition-correction', 0)
);

DO $grainline_order_authority_composition_preflight$
DECLARE
  drifted text[];
BEGIN
  WITH expected(identity, body_md5, runtime_execute) AS (
    VALUES
      ('public.grainline_order_review_eligibility_lock(text,text,bigint)', '428d3ac57643261d600c7fe5015aa798', true),
      ('public.grainline_order_seller_verification_sales(text,text)', '2ca511ec30c5ffd3e1fd0292935d8c21', true),
      ('public.grainline_order_seller_analytics_summary(text,bigint,bigint,boolean)', 'a3c59544e178b41228fb84d004f0165c', true),
      ('public.grainline_order_seller_analytics_buckets(text,bigint,bigint,boolean,text)', '75044e220d968d1d76f7312aa7b9fcd0', true),
      ('public.grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)', '05b7441717e26cfe144e915576335a9a', true),
      ('public.grainline_order_seller_recent_sales(text)', 'a90e9c3d47b4c04807cc7baf9bfa6307', true),
      ('public.grainline_order_seller_completed_count(text)', '088feb4d43a62e88147c6424ef8be758', true),
      ('public.grainline_order_seller_metrics_facts(text,bigint)', '3a7eac359884e1ce06374256f82c6018', true),
      ('public.grainline_blocked_checkout_refund_claim(text,bigint,text,text,integer)', 'e0c4cb6d34fd59ce2c0b3043c3f5fa63', false),
      ('public.grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)', '687ec7b3100828bb21748adda74a8848', false)
  ), inspected AS (
    SELECT
      expected.identity,
      expected.body_md5,
      expected.runtime_execute,
      procedure.oid,
      procedure.prosrc,
      procedure.prosecdef,
      procedure.proconfig,
      procedure.proowner
    FROM expected
    LEFT JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.identity)
  )
  SELECT pg_catalog.array_agg(identity ORDER BY identity)
    INTO drifted
    FROM inspected
   WHERE oid IS NULL
      OR pg_catalog.md5(prosrc) IS DISTINCT FROM body_md5
      OR NOT prosecdef
      OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR proowner = 'grainline_app_runtime'::pg_catalog.regrole
      OR pg_catalog.has_function_privilege(
           'grainline_app_runtime', oid, 'EXECUTE'
         ) IS DISTINCT FROM runtime_execute
      OR pg_catalog.has_function_privilege('public', oid, 'EXECUTE');

  IF drifted IS NOT NULL THEN
    RAISE EXCEPTION 'Order authority composition predecessor drift: %', drifted;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_metadata
     WHERE constraint_metadata.conrelid = 'public."Order"'::pg_catalog.regclass
       AND constraint_metadata.conname = 'Order_provider_claim_mutual_exclusion_check'
       AND constraint_metadata.convalidated
  ) THEN
    RAISE EXCEPTION 'Order provider-claim exclusion predecessor is missing';
  END IF;
END
$grainline_order_authority_composition_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_order_review_eligibility_lock(
  p_actor_user_id text,
  p_listing_id text,
  p_since_epoch_millis bigint
)
RETURNS TABLE(
  order_item_id text,
  seller_profile_id text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_review_eligibility_lock$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_listing_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_listing_id)) NOT BETWEEN 1 AND 191
     OR p_since_epoch_millis IS NULL
     OR p_since_epoch_millis NOT BETWEEN 0 AND 253402300799999 THEN
    RAISE EXCEPTION 'Order review eligibility input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT source_item.id, source_item."sellerProfileId"
    FROM public."OrderItem" AS source_item
    JOIN public."Order" AS source_order
      ON source_order.id = source_item."orderId"
   WHERE source_item."listingId" = p_listing_id
     AND source_item."sellerProfileId" IS NOT NULL
     AND source_order."buyerId" = p_actor_user_id
     AND source_order."createdAt" >= (
       pg_catalog.to_timestamp(p_since_epoch_millis::double precision / 1000.0)
       AT TIME ZONE 'UTC'
     )::timestamp(3) without time zone
     AND source_order."fulfillmentStatus" IN (
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
     )
     AND source_order."sellerRefundId" IS NULL
     AND source_order."paymentRefundBlocked" = false
     AND source_order."paymentConversionDisputeBlocked" = false
     AND source_order."paidAt" IS NOT NULL
     AND (
       source_order."stripeSessionId" IS NOT NULL
       OR source_order."stripePaymentIntentId" IS NOT NULL
       OR source_order."stripeChargeId" IS NOT NULL
     )
   ORDER BY source_order."createdAt" DESC, source_item.id DESC
   LIMIT 1
   FOR UPDATE OF source_order;
END
$grainline_order_review_eligibility_lock$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_verification_sales(
  p_actor_user_id text,
  p_seller_profile_id text
)
RETURNS TABLE(total_sales_cents bigint)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_verification_sales$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_seller_profile_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_seller_profile_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Order seller verification input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT COALESCE((
    SELECT pg_catalog.sum(source_item."priceCents"::bigint * source_item.quantity::bigint)::bigint
      FROM public."Order" AS source_order
      JOIN public."OrderItem" AS source_item
        ON source_item."orderId" = source_order.id
     WHERE source_order."sellerProfileId" = seller.id
       AND source_order."fulfillmentStatus" IN (
         'DELIVERED'::public."FulfillmentStatus",
         'PICKED_UP'::public."FulfillmentStatus"
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
       AND source_order."paymentConversionDisputeBlocked" = false
       AND source_order."paidAt" IS NOT NULL
       AND (
         source_order."stripeSessionId" IS NOT NULL
         OR source_order."stripePaymentIntentId" IS NOT NULL
         OR source_order."stripeChargeId" IS NOT NULL
       )
  ), 0::bigint)
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = p_actor_user_id;
END
$grainline_order_seller_verification_sales$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_analytics_summary(
  p_actor_user_id text,
  p_start_epoch_millis bigint,
  p_end_epoch_millis bigint,
  p_end_exclusive boolean
)
RETURNS TABLE(
  seller_profile_id text,
  total_revenue_cents bigint,
  total_orders bigint,
  total_buyers bigint,
  repeat_buyers bigint,
  avg_processing_hours double precision,
  cart_abandonment bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_analytics_summary$
DECLARE
  range_start timestamp(3) without time zone;
  range_end timestamp(3) without time zone;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_start_epoch_millis IS NULL
     OR p_end_epoch_millis IS NULL
     OR p_start_epoch_millis NOT BETWEEN 0 AND 253402300799999
     OR p_end_epoch_millis NOT BETWEEN 0 AND 253402300799999
     OR p_start_epoch_millis > p_end_epoch_millis
     OR p_end_epoch_millis - p_start_epoch_millis > 3155760000000
     OR p_end_exclusive IS NULL THEN
    RAISE EXCEPTION 'Seller Order analytics summary input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  range_start := (
    pg_catalog.to_timestamp(p_start_epoch_millis::double precision / 1000.0)
    AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;
  range_end := (
    pg_catalog.to_timestamp(p_end_epoch_millis::double precision / 1000.0)
    AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;

  RETURN QUERY
  WITH seller_actor AS (
    SELECT seller.id
      FROM public."SellerProfile" AS seller
     WHERE seller."userId" = p_actor_user_id
  ),
  range_orders AS (
    SELECT source_order.id, source_order."buyerId", source_order."createdAt",
           source_order."shippedAt"
      FROM seller_actor
      JOIN public."Order" AS source_order
        ON source_order."sellerProfileId" = seller_actor.id
     WHERE source_order."paidAt" IS NOT NULL
       AND (
         source_order."stripeSessionId" IS NOT NULL
         OR source_order."stripePaymentIntentId" IS NOT NULL
         OR source_order."stripeChargeId" IS NOT NULL
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
       AND source_order."paymentConversionDisputeBlocked" = false
       AND source_order."createdAt" >= range_start
       AND (
         (p_end_exclusive AND source_order."createdAt" < range_end)
         OR (NOT p_end_exclusive AND source_order."createdAt" <= range_end)
       )
  ),
  overview AS (
    SELECT
      COALESCE(pg_catalog.sum(source_item."priceCents"::bigint * source_item.quantity::bigint), 0::numeric)::bigint AS revenue,
      pg_catalog.count(DISTINCT range_orders.id)::bigint AS orders
      FROM range_orders
      LEFT JOIN public."OrderItem" AS source_item
        ON source_item."orderId" = range_orders.id
       AND source_item."sellerProfileId" = (SELECT id FROM seller_actor)
  ),
  buyer_order_counts AS (
    SELECT source_order."buyerId", pg_catalog.count(*)::bigint AS order_count
      FROM seller_actor
      JOIN public."Order" AS source_order
        ON source_order."sellerProfileId" = seller_actor.id
     WHERE source_order."buyerId" IS NOT NULL
       AND source_order."paidAt" IS NOT NULL
       AND (
         source_order."stripeSessionId" IS NOT NULL
         OR source_order."stripePaymentIntentId" IS NOT NULL
         OR source_order."stripeChargeId" IS NOT NULL
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
       AND source_order."paymentConversionDisputeBlocked" = false
     GROUP BY source_order."buyerId"
  ),
  buyer_summary AS (
    SELECT
      pg_catalog.count(*)::bigint AS total_count,
      pg_catalog.count(*) FILTER (WHERE order_count > 1)::bigint AS repeat_count
      FROM buyer_order_counts
  ),
  processing_summary AS (
    SELECT pg_catalog.avg(
      EXTRACT(EPOCH FROM (range_orders."shippedAt" - range_orders."createdAt")) / 3600.0
    )::double precision AS avg_hours
      FROM range_orders
     WHERE range_orders."shippedAt" IS NOT NULL
  ),
  abandonment_summary AS (
    SELECT pg_catalog.count(*)::bigint AS abandoned_count
      FROM seller_actor
      JOIN public."Listing" AS listing
        ON listing."sellerId" = seller_actor.id
      JOIN public."CartItem" AS cart_item
        ON cart_item."listingId" = listing.id
      JOIN public."Cart" AS cart
        ON cart.id = cart_item."cartId"
     WHERE cart_item."createdAt" >= range_start
       AND (
         (p_end_exclusive AND cart_item."createdAt" < range_end)
         OR (NOT p_end_exclusive AND cart_item."createdAt" <= range_end)
       )
       AND cart_item."createdAt" <= (
         pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
       ) - INTERVAL '24 hours'
       AND NOT EXISTS (
         SELECT 1
           FROM public."OrderItem" AS purchased_item
           JOIN public."Order" AS purchased_order
             ON purchased_order.id = purchased_item."orderId"
            AND purchased_order."sellerProfileId" = seller_actor.id
          WHERE purchased_item."listingId" = cart_item."listingId"
            AND purchased_item."sellerProfileId" = seller_actor.id
            AND purchased_order."buyerId" = cart."userId"
            AND purchased_order."createdAt" >= cart_item."createdAt"
            AND purchased_order."paidAt" IS NOT NULL
            AND (
              purchased_order."stripeSessionId" IS NOT NULL
              OR purchased_order."stripePaymentIntentId" IS NOT NULL
              OR purchased_order."stripeChargeId" IS NOT NULL
            )
            AND purchased_order."sellerRefundId" IS NULL
            AND purchased_order."paymentRefundBlocked" = false
            AND purchased_order."paymentConversionDisputeBlocked" = false
       )
  )
  SELECT
    seller_actor.id,
    overview.revenue,
    overview.orders,
    buyer_summary.total_count,
    buyer_summary.repeat_count,
    processing_summary.avg_hours,
    abandonment_summary.abandoned_count
    FROM seller_actor
    CROSS JOIN overview
    CROSS JOIN buyer_summary
    CROSS JOIN processing_summary
    CROSS JOIN abandonment_summary;
END
$grainline_order_seller_analytics_summary$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_analytics_buckets(
  p_actor_user_id text,
  p_start_epoch_millis bigint,
  p_end_epoch_millis bigint,
  p_end_exclusive boolean,
  p_grouping text
)
RETURNS TABLE(
  bucket_epoch_millis bigint,
  revenue_cents bigint,
  order_count bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_analytics_buckets$
DECLARE
  range_start timestamp(3) without time zone;
  range_end timestamp(3) without time zone;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_start_epoch_millis IS NULL
     OR p_end_epoch_millis IS NULL
     OR p_start_epoch_millis NOT BETWEEN 0 AND 253402300799999
     OR p_end_epoch_millis NOT BETWEEN 0 AND 253402300799999
     OR p_start_epoch_millis > p_end_epoch_millis
     OR p_end_exclusive IS NULL
     OR p_grouping IS NULL
     OR p_grouping NOT IN ('hour', 'day', 'month', 'year')
     OR (
       p_grouping = 'hour'
       AND p_end_epoch_millis - p_start_epoch_millis > 172800000
     )
     OR (
       p_grouping = 'day'
       AND p_end_epoch_millis - p_start_epoch_millis > 34560000000
     )
     OR (
       p_grouping = 'month'
       AND p_end_epoch_millis - p_start_epoch_millis > 631152000000
     )
     OR (
       p_grouping = 'year'
       AND p_end_epoch_millis - p_start_epoch_millis > 3155760000000
     ) THEN
    RAISE EXCEPTION 'Seller Order analytics bucket input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  range_start := (
    pg_catalog.to_timestamp(p_start_epoch_millis::double precision / 1000.0)
    AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;
  range_end := (
    pg_catalog.to_timestamp(p_end_epoch_millis::double precision / 1000.0)
    AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;

  RETURN QUERY
  WITH seller_actor AS (
    SELECT seller.id
      FROM public."SellerProfile" AS seller
     WHERE seller."userId" = p_actor_user_id
  ),
  bucketed AS (
    SELECT
      pg_catalog.date_trunc(p_grouping, source_order."createdAt") AS bucket,
      source_order.id,
      source_item."priceCents",
      source_item.quantity
      FROM seller_actor
      JOIN public."Order" AS source_order
        ON source_order."sellerProfileId" = seller_actor.id
      JOIN public."OrderItem" AS source_item
        ON source_item."orderId" = source_order.id
       AND source_item."sellerProfileId" = seller_actor.id
     WHERE source_order."paidAt" IS NOT NULL
       AND (
         source_order."stripeSessionId" IS NOT NULL
         OR source_order."stripePaymentIntentId" IS NOT NULL
         OR source_order."stripeChargeId" IS NOT NULL
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
       AND source_order."paymentConversionDisputeBlocked" = false
       AND source_order."createdAt" >= range_start
       AND (
         (p_end_exclusive AND source_order."createdAt" < range_end)
         OR (NOT p_end_exclusive AND source_order."createdAt" <= range_end)
       )
  )
  SELECT
    pg_catalog.floor(EXTRACT(EPOCH FROM bucket) * 1000)::bigint,
    COALESCE(pg_catalog.sum("priceCents"::bigint * quantity::bigint), 0::numeric)::bigint,
    pg_catalog.count(DISTINCT id)::bigint
    FROM bucketed
   GROUP BY bucket
   ORDER BY bucket;
END
$grainline_order_seller_analytics_buckets$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_analytics_top_listings(
  p_actor_user_id text,
  p_start_epoch_millis bigint,
  p_end_epoch_millis bigint,
  p_end_exclusive boolean,
  p_all_time boolean
)
RETURNS TABLE(
  listing_id text,
  title text,
  image_url text,
  total_revenue_cents bigint,
  units_sold bigint,
  avg_price_cents bigint,
  view_count bigint,
  click_count bigint,
  favorite_count bigint,
  stock_notification_count bigint,
  listing_created_at_epoch_millis bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_analytics_top_listings$
DECLARE
  range_start timestamp(3) without time zone;
  range_end timestamp(3) without time zone;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_start_epoch_millis IS NULL
     OR p_end_epoch_millis IS NULL
     OR p_start_epoch_millis NOT BETWEEN 0 AND 253402300799999
     OR p_end_epoch_millis NOT BETWEEN 0 AND 253402300799999
     OR p_start_epoch_millis > p_end_epoch_millis
     OR p_end_epoch_millis - p_start_epoch_millis > 3155760000000
     OR p_end_exclusive IS NULL
     OR p_all_time IS NULL THEN
    RAISE EXCEPTION 'Seller Order top-listing analytics input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  range_start := (
    pg_catalog.to_timestamp(p_start_epoch_millis::double precision / 1000.0)
    AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;
  range_end := (
    pg_catalog.to_timestamp(p_end_epoch_millis::double precision / 1000.0)
    AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;

  RETURN QUERY
  WITH seller_actor AS (
    SELECT seller.id
      FROM public."SellerProfile" AS seller
     WHERE seller."userId" = p_actor_user_id
  ),
  seller_listings AS (
    SELECT listing.id, listing.title, listing."createdAt",
           listing."viewCount", listing."clickCount"
      FROM seller_actor
      JOIN public."Listing" AS listing
        ON listing."sellerId" = seller_actor.id
  ),
  sales AS (
    SELECT
      source_item."listingId" AS listing_id,
      pg_catalog.sum(source_item."priceCents"::bigint * source_item.quantity::bigint)::bigint AS revenue,
      pg_catalog.sum(source_item.quantity::bigint)::bigint AS units
      FROM seller_actor
      JOIN public."Order" AS source_order
        ON source_order."sellerProfileId" = seller_actor.id
      JOIN public."OrderItem" AS source_item
        ON source_item."orderId" = source_order.id
       AND source_item."sellerProfileId" = seller_actor.id
     WHERE source_order."paidAt" IS NOT NULL
       AND (
         source_order."stripeSessionId" IS NOT NULL
         OR source_order."stripePaymentIntentId" IS NOT NULL
         OR source_order."stripeChargeId" IS NOT NULL
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
       AND source_order."paymentConversionDisputeBlocked" = false
       AND source_order."createdAt" >= range_start
       AND (
         (p_end_exclusive AND source_order."createdAt" < range_end)
         OR (NOT p_end_exclusive AND source_order."createdAt" <= range_end)
       )
     GROUP BY source_item."listingId"
  ),
  daily_views AS (
    SELECT view_daily."listingId" AS listing_id,
           pg_catalog.sum(view_daily.views)::bigint AS views,
           pg_catalog.sum(view_daily.clicks)::bigint AS clicks
      FROM seller_actor
      JOIN public."ListingViewDaily" AS view_daily
        ON view_daily."sellerProfileId" = seller_actor.id
     WHERE view_daily.date >= range_start
       AND (
         (p_end_exclusive AND view_daily.date < range_end)
         OR (NOT p_end_exclusive AND view_daily.date <= range_end)
       )
     GROUP BY view_daily."listingId"
  ),
  favorites AS (
    SELECT favorite."listingId" AS listing_id,
           pg_catalog.count(*)::bigint AS value
      FROM seller_listings
      JOIN public."Favorite" AS favorite
        ON favorite."listingId" = seller_listings.id
     WHERE favorite."createdAt" >= range_start
       AND (
         (p_end_exclusive AND favorite."createdAt" < range_end)
         OR (NOT p_end_exclusive AND favorite."createdAt" <= range_end)
       )
     GROUP BY favorite."listingId"
  ),
  watchers AS (
    SELECT stock_notification."listingId" AS listing_id,
           pg_catalog.count(*)::bigint AS value
      FROM seller_listings
      JOIN public."StockNotification" AS stock_notification
        ON stock_notification."listingId" = seller_listings.id
     WHERE stock_notification."createdAt" >= range_start
       AND (
         (p_end_exclusive AND stock_notification."createdAt" < range_end)
         OR (NOT p_end_exclusive AND stock_notification."createdAt" <= range_end)
       )
     GROUP BY stock_notification."listingId"
  ),
  combined AS (
    SELECT
      seller_listings.id,
      seller_listings.title,
      seller_listings."createdAt",
      COALESCE(sales.revenue, 0)::bigint AS revenue,
      COALESCE(sales.units, 0)::bigint AS units,
      CASE
        WHEN COALESCE(sales.units, 0) = 0 THEN 0::bigint
        ELSE (sales.revenue / sales.units)::bigint
      END AS average_price,
      CASE
        WHEN p_all_time THEN seller_listings."viewCount"::bigint
        ELSE COALESCE(daily_views.views, 0)::bigint
      END AS views,
      CASE
        WHEN p_all_time THEN seller_listings."clickCount"::bigint
        ELSE COALESCE(daily_views.clicks, 0)::bigint
      END AS clicks,
      COALESCE(favorites.value, 0)::bigint AS favorite_value,
      COALESCE(watchers.value, 0)::bigint AS watcher_value
      FROM seller_listings
      LEFT JOIN sales ON sales.listing_id = seller_listings.id
      LEFT JOIN daily_views ON daily_views.listing_id = seller_listings.id
      LEFT JOIN favorites ON favorites.listing_id = seller_listings.id
      LEFT JOIN watchers ON watchers.listing_id = seller_listings.id
  )
  SELECT
    combined.id,
    combined.title::text,
    photo.url::text,
    combined.revenue,
    combined.units,
    combined.average_price,
    combined.views,
    combined.clicks,
    combined.favorite_value,
    combined.watcher_value,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM combined."createdAt") * 1000
    )::bigint
    FROM combined
    LEFT JOIN LATERAL (
      SELECT source_photo.url
        FROM public."Photo" AS source_photo
       WHERE source_photo."listingId" = combined.id
       ORDER BY source_photo."sortOrder" ASC, source_photo.id ASC
       LIMIT 1
    ) AS photo ON true
   WHERE combined.revenue > 0
      OR combined.units > 0
      OR combined.views > 0
      OR combined.clicks > 0
      OR combined.favorite_value > 0
      OR combined.watcher_value > 0
   ORDER BY combined.revenue DESC, combined.views DESC,
            combined.clicks DESC, combined.id ASC
   LIMIT 8;
END
$grainline_order_seller_analytics_top_listings$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_recent_sales(
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
  buyer_email text,
  buyer_data_purged_at_epoch_millis bigint,
  buyer_deleted_at_epoch_millis bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_recent_sales$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Seller recent-sales actor is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    source_order.id,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM source_order."createdAt") * 1000
    )::bigint,
    source_order."itemsSubtotalCents",
    source_order."shippingAmountCents",
    source_order."taxAmountCents",
    source_order."giftWrappingPriceCents",
    source_order.currency::text,
    source_order."fulfillmentStatus"::text,
    first_item."priceCents",
    first_item."listingSnapshot"::jsonb,
    (CASE
      WHEN source_order."buyerDataPurgedAt" IS NOT NULL OR buyer."deletedAt" IS NOT NULL
        THEN NULL
      ELSE source_order."buyerName"
    END)::text,
    (CASE
      WHEN source_order."buyerDataPurgedAt" IS NOT NULL OR buyer."deletedAt" IS NOT NULL
        THEN NULL
      ELSE source_order."buyerEmail"
    END)::text,
    CASE
      WHEN source_order."buyerDataPurgedAt" IS NULL THEN NULL
      ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM source_order."buyerDataPurgedAt") * 1000
      )::bigint
    END,
    CASE
      WHEN buyer."deletedAt" IS NULL THEN NULL
      ELSE pg_catalog.floor(EXTRACT(EPOCH FROM buyer."deletedAt") * 1000)::bigint
    END
    FROM public."Order" AS source_order
    JOIN public."SellerProfile" AS seller
      ON seller.id = source_order."sellerProfileId"
     AND seller."userId" = p_actor_user_id
    JOIN LATERAL (
      SELECT source_item."priceCents", source_item."listingSnapshot"
        FROM public."OrderItem" AS source_item
       WHERE source_item."orderId" = source_order.id
         AND source_item."sellerProfileId" = seller.id
       ORDER BY source_item."createdAt" ASC, source_item.id ASC
       LIMIT 1
    ) AS first_item ON true
    LEFT JOIN public."User" AS buyer
      ON buyer.id = source_order."buyerId"
   WHERE source_order."paidAt" IS NOT NULL
     AND (
       source_order."stripeSessionId" IS NOT NULL
       OR source_order."stripePaymentIntentId" IS NOT NULL
       OR source_order."stripeChargeId" IS NOT NULL
     )
     AND source_order."sellerRefundId" IS NULL
     AND source_order."paymentRefundBlocked" = false
     AND source_order."paymentConversionDisputeBlocked" = false
   ORDER BY source_order."createdAt" DESC, source_order.id DESC
   LIMIT 10;
END
$grainline_order_seller_recent_sales$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_completed_count(
  p_actor_user_id text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_completed_count$
DECLARE
  result bigint;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Seller completed-Order actor is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pg_catalog.count(*)::bigint
    INTO result
    FROM public."Order" AS source_order
    JOIN public."SellerProfile" AS seller
      ON seller.id = source_order."sellerProfileId"
     AND seller."userId" = p_actor_user_id
   WHERE source_order."paidAt" IS NOT NULL
     AND (
       source_order."stripeSessionId" IS NOT NULL
       OR source_order."stripePaymentIntentId" IS NOT NULL
       OR source_order."stripeChargeId" IS NOT NULL
     )
     AND source_order."sellerRefundId" IS NULL
     AND source_order."paymentRefundBlocked" = false
     AND source_order."paymentConversionDisputeBlocked" = false
     AND source_order."fulfillmentStatus" IN (
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
     );

  RETURN result;
END
$grainline_order_seller_completed_count$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_metrics_facts(
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
       AND source_order."paymentConversionDisputeBlocked" = false
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

CREATE OR REPLACE FUNCTION public.grainline_blocked_checkout_refund_claim(
  p_event_id text,
  p_event_claim_generation bigint,
  p_session_id text,
  p_order_id text,
  p_expected_amount_cents integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_blocked_checkout_refund_claim$
DECLARE
  locked_event public."StripeWebhookEvent"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  claim_id text;
  claim_generation bigint;
  claim_amount integer;
  idempotency_scope text;
  transition_at timestamp(3) without time zone;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_event_claim_generation IS NULL OR p_event_claim_generation < 1
     OR p_session_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_session_id)) NOT BETWEEN 1 AND 255
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191
     OR p_expected_amount_cents IS NULL OR p_expected_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Blocked-checkout refund claim input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT source_event.*
    INTO locked_event
    FROM public."StripeWebhookEvent" AS source_event
   WHERE source_event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_event.type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR locked_event."claimGeneration" IS DISTINCT FROM p_event_claim_generation
     OR locked_event."processingStartedAt" IS NULL
     OR locked_event."processedAt" IS NOT NULL
     OR locked_event."sourceObjectId" IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'Blocked-checkout refund source lease is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND OR locked_order."stripeSessionId" IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'Blocked-checkout refund Order source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF locked_order."sellerRefundId" = 'pending'
     AND locked_order."refundClaimId" IS NOT NULL
     AND locked_order."refundClaimSource" = 'BLOCKED_CHECKOUT'
     AND locked_order."refundClaimSourceId" = locked_event.id
     AND locked_order."refundClaimSourceGeneration"
       = locked_event."claimGeneration"
     AND locked_order."refundClaimProviderAuthorizedAt" IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_order."refundClaimId",
      'claimGeneration', locked_order."refundClaimGeneration",
      'idempotencyScope', locked_order."refundClaimIdempotencyScope",
      'refundAmountCents',
        locked_order."itemsSubtotalCents"
        + locked_order."shippingAmountCents"
        + COALESCE(locked_order."giftWrappingPriceCents", 0)
        + locked_order."taxAmountCents",
      'currency', pg_catalog.lower(locked_order.currency),
      'paymentIntentId', locked_order."stripePaymentIntentId",
      'itemsSubtotalCents', locked_order."itemsSubtotalCents",
      'shippingAmountCents', locked_order."shippingAmountCents",
      'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
      'taxAmountCents', locked_order."taxAmountCents",
      'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
      'action', 'replay'
    );
  END IF;

  IF locked_order."sellerRefundId" IS NOT NULL
     OR locked_order."sellerRefundLockedAt" IS NOT NULL
     OR locked_order."caseResolutionClaimId" IS NOT NULL
     OR locked_order."refundClaimId" IS NOT NULL
     OR locked_order."stripePaymentIntentId" IS NULL
     OR locked_order."paidAt" IS NULL
     OR locked_order."fulfillmentStatus"::text IS DISTINCT FROM 'PENDING'
     OR locked_order."labelStatus"::text IS NOT DISTINCT FROM 'PURCHASED'
     OR COALESCE(locked_order."labelClaimStatus", '') IN (
       'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
     )
     OR EXISTS (
       SELECT 1
         FROM public."OrderPaymentEvent" AS payment_event
        WHERE payment_event."orderId" = locked_order.id
          AND payment_event."eventType" = 'REFUND'
          AND (
            payment_event.status IS NULL
            OR pg_catalog.lower(payment_event.status)
              NOT IN ('failed', 'canceled', 'cancelled')
          )
     )
     OR EXISTS (
       SELECT 1
         FROM (
           SELECT DISTINCT ON (
             COALESCE(dispute_event."stripeObjectId", dispute_event.id)
           ) dispute_event.status
             FROM public."OrderPaymentEvent" AS dispute_event
            WHERE dispute_event."orderId" = locked_order.id
              AND dispute_event."eventType" = 'DISPUTE'
            ORDER BY
              COALESCE(dispute_event."stripeObjectId", dispute_event.id),
              COALESCE(
                CASE
                  WHEN dispute_event.metadata->>'stripeEventCreated' ~ '^[0-9]+$'
                  THEN (dispute_event.metadata->>'stripeEventCreated')::bigint
                  ELSE NULL
                END,
                EXTRACT(EPOCH FROM dispute_event."createdAt")::bigint
              ) DESC,
              dispute_event."createdAt" DESC,
              dispute_event.id DESC
         ) AS latest_dispute
        WHERE latest_dispute.status IS NULL
           OR pg_catalog.lower(latest_dispute.status)
             NOT IN ('won', 'lost', 'prevented', 'warning_closed')
     ) THEN
    RETURN NULL;
  END IF;

  claim_amount :=
    locked_order."itemsSubtotalCents"
    + locked_order."shippingAmountCents"
    + COALESCE(locked_order."giftWrappingPriceCents", 0)
    + locked_order."taxAmountCents";
  IF claim_amount IS DISTINCT FROM p_expected_amount_cents
     OR claim_amount > 2147483647
     OR locked_order.currency !~ '^[A-Za-z]{3}$' THEN
    RAISE EXCEPTION 'Blocked-checkout refund amount or currency drifted'
      USING ERRCODE = 'check_violation';
  END IF;

  transition_at := (
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3);
  claim_generation := locked_order."refundClaimGeneration" + 1;
  claim_id := 'order_refund_claim_' || pg_catalog.gen_random_uuid()::text;
  idempotency_scope :=
    'blocked-checkout-refund:' || claim_id || ':FULL:' || claim_amount::text;

  UPDATE public."Order" AS orders
     SET "sellerRefundId" = 'pending',
         "sellerRefundLockedAt" = transition_at,
         "refundClaimId" = claim_id,
         "refundClaimGeneration" = claim_generation,
         "refundClaimSource" = 'BLOCKED_CHECKOUT',
         "refundClaimSourceId" = locked_event.id,
         "refundClaimSourceGeneration" = locked_event."claimGeneration",
         "refundClaimIdempotencyScope" = idempotency_scope,
         "refundClaimProviderAuthorizedAt" = transition_at,
         "reviewNeeded" = true
   WHERE orders.id = locked_order.id
     AND orders."refundClaimGeneration" = locked_order."refundClaimGeneration"
     AND orders."sellerRefundId" IS NULL
     AND orders."refundClaimId" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blocked-checkout refund claim acquisition raced'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'claimId', claim_id,
    'claimGeneration', claim_generation,
    'idempotencyScope', idempotency_scope,
    'refundAmountCents', claim_amount,
    'currency', pg_catalog.lower(locked_order.currency),
    'paymentIntentId', locked_order."stripePaymentIntentId",
    'itemsSubtotalCents', locked_order."itemsSubtotalCents",
    'shippingAmountCents', locked_order."shippingAmountCents",
    'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
    'taxAmountCents', locked_order."taxAmountCents",
    'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
    'action', 'claimed'
  );
END
$grainline_blocked_checkout_refund_claim$;

CREATE OR REPLACE FUNCTION public.grainline_blocked_checkout_refund_record_core(
  p_event_id text,
  p_event_claim_generation bigint,
  p_claim_id text,
  p_claim_generation bigint,
  p_refund_id text,
  p_refund_status text,
  p_transfer_reversal_id text,
  p_transfer_reversal_amount_cents integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_blocked_checkout_refund_record_core$
DECLARE
  locked_event public."StripeWebhookEvent"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  existing_event public."OrderPaymentEvent"%ROWTYPE;
  stock_restore record;
  transition_at timestamp(3) without time zone;
  event_key text;
  payment_event_id text;
  audit_id text;
  refund_amount integer;
  seller_portion integer;
  original_transfer_amount integer;
  expected_transfer_reversal boolean;
  requires_manual_transfer_reconciliation boolean;
  requires_manual_follow_up boolean;
  platform_funded_refund_cents integer;
  refund_accounting jsonb;
  event_metadata jsonb;
  review_note text;
  restored_active_listing_count integer := 0;
  reactivated_count integer := 0;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_event_claim_generation IS NULL OR p_event_claim_generation < 1
     OR p_claim_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_claim_id)) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_refund_id IS NULL
     OR p_refund_id !~ '^re_[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_refund_id) > 220
     OR (
       p_refund_status IS NOT NULL
       AND p_refund_status NOT IN ('pending', 'requires_action', 'succeeded')
     )
     OR (
       p_transfer_reversal_id IS NOT NULL
       AND (
         p_transfer_reversal_id !~ '^trr_[A-Za-z0-9]+$'
         OR pg_catalog.char_length(p_transfer_reversal_id) > 220
       )
     )
     OR (
       p_transfer_reversal_amount_cents IS NOT NULL
       AND (
         p_transfer_reversal_amount_cents < 0
         OR p_transfer_reversal_id IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Blocked-checkout refund provider evidence is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    824022,
    pg_catalog.hashtext(p_claim_id)
  );
  event_key := 'local:blocked_checkout_refund_recorded:' || p_refund_id;

  SELECT source_event.*
    INTO locked_event
    FROM public."StripeWebhookEvent" AS source_event
   WHERE source_event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_event.type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR locked_event."claimGeneration" IS DISTINCT FROM p_event_claim_generation THEN
    RAISE EXCEPTION 'Blocked-checkout refund record source identity is invalid'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT payment_event.*
    INTO existing_event
    FROM public."OrderPaymentEvent" AS payment_event
   WHERE payment_event."stripeEventId" = event_key
   FOR SHARE;
  IF FOUND THEN
    SELECT orders.*
      INTO locked_order
      FROM public."Order" AS orders
     WHERE orders.id = existing_event."orderId"
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Blocked-checkout refund replay Order is missing'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    refund_amount :=
        locked_order."itemsSubtotalCents"
      + locked_order."shippingAmountCents"
      + COALESCE(locked_order."giftWrappingPriceCents", 0)
      + locked_order."taxAmountCents";
    seller_portion :=
        locked_order."itemsSubtotalCents"
      + locked_order."shippingAmountCents"
      + COALESCE(locked_order."giftWrappingPriceCents", 0);
    original_transfer_amount := seller_portion
      - pg_catalog.round(
          locked_order."itemsSubtotalCents"::numeric * 0.05::numeric
        )::integer;
    expected_transfer_reversal :=
      locked_order."stripeTransferId" IS NOT NULL AND seller_portion > 0;
    requires_manual_transfer_reconciliation :=
      locked_order."stripeTransferId" IS NULL;
    requires_manual_follow_up :=
      pg_catalog.lower(COALESCE(p_refund_status, ''))
        IN ('pending', 'requires_action');
    platform_funded_refund_cents := CASE
      WHEN p_transfer_reversal_amount_cents IS NOT NULL
        THEN GREATEST(
          0,
          refund_amount - p_transfer_reversal_amount_cents
        )
      WHEN expected_transfer_reversal THEN NULL
      ELSE refund_amount
    END;
    refund_accounting := pg_catalog.jsonb_build_object(
      'buyerRefundAmountCents', refund_amount,
      'chargeAmountCents', refund_amount,
      'originalTransferAmountCents', original_transfer_amount,
      'expectedTransferReversal', expected_transfer_reversal,
      'transferReversalId', p_transfer_reversal_id,
      'transferReversalAmountCents', p_transfer_reversal_amount_cents,
      'platformFundedRefundCents', platform_funded_refund_cents
    );
    event_metadata := pg_catalog.jsonb_build_object(
      'localAction', 'BLOCKED_CHECKOUT_REFUND_RECORDED',
      'refundIds', pg_catalog.jsonb_build_array(p_refund_id),
      'refundStatuses', pg_catalog.jsonb_build_array(p_refund_status),
      'refundAccounting', refund_accounting,
      'requiresManualTransferReconciliation',
        requires_manual_transfer_reconciliation,
      'requiresManualFollowUp', requires_manual_follow_up,
      'stripeSessionId', locked_order."stripeSessionId",
      'stripeEventType', locked_event.type,
      'refundClaimId', p_claim_id,
      'refundClaimGeneration', p_claim_generation::text,
      'refundClaimSource', 'BLOCKED_CHECKOUT',
      'refundClaimSourceId', p_event_id,
      'refundClaimSourceGeneration', p_event_claim_generation::text
    );

    IF locked_order."stripeSessionId" IS DISTINCT FROM locked_event."sourceObjectId"
       OR locked_order."sellerRefundId" IS DISTINCT FROM p_refund_id
       OR locked_order."sellerRefundAmountCents" IS DISTINCT FROM refund_amount
       OR locked_order."sellerRefundLockedAt" IS NOT NULL
       OR existing_event."stripeObjectId" IS DISTINCT FROM p_refund_id
       OR existing_event."stripeObjectType" IS DISTINCT FROM 'refund'
       OR existing_event."eventType" IS DISTINCT FROM 'REFUND'
       OR existing_event."amountCents" IS DISTINCT FROM refund_amount
       OR existing_event.currency IS DISTINCT FROM pg_catalog.lower(locked_order.currency)
       OR existing_event.status IS DISTINCT FROM p_refund_status
       OR existing_event.reason IS DISTINCT FROM 'blocked_checkout'
       OR existing_event.metadata - 'restoredActiveListingCount'
            IS DISTINCT FROM event_metadata
       OR pg_catalog.jsonb_typeof(
            existing_event.metadata->'restoredActiveListingCount'
          ) IS DISTINCT FROM 'number'
       OR (existing_event.metadata->>'restoredActiveListingCount')::integer < 0
       OR (
         expected_transfer_reversal
         AND (
           p_transfer_reversal_id IS NULL
           OR p_transfer_reversal_amount_cents
                IS DISTINCT FROM original_transfer_amount
         )
       )
       OR (
         NOT expected_transfer_reversal
         AND (
           p_transfer_reversal_id IS NOT NULL
           OR p_transfer_reversal_amount_cents IS NOT NULL
         )
       ) THEN
      RAISE EXCEPTION 'Blocked-checkout refund replay evidence drifted'
        USING ERRCODE = 'unique_violation';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'orderId', locked_order.id,
      'buyerUserId', locked_order."buyerId",
      'paymentEventId', existing_event.id,
      'refundId', p_refund_id,
      'refundAmountCents', refund_amount,
      'restoredActiveListingCount',
        (existing_event.metadata->>'restoredActiveListingCount')::integer,
      'action', 'replay'
    );
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders."refundClaimId" = p_claim_id
     AND orders."refundClaimGeneration" = p_claim_generation
   FOR UPDATE;
  IF NOT FOUND
     OR locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
     OR locked_order."refundClaimSource" IS DISTINCT FROM 'BLOCKED_CHECKOUT'
     OR locked_order."refundClaimSourceId" IS DISTINCT FROM locked_event.id
     OR locked_order."refundClaimSourceGeneration"
          IS DISTINCT FROM locked_event."claimGeneration"
     OR locked_order."refundClaimProviderAuthorizedAt" IS NULL
     OR locked_order."stripeSessionId" IS DISTINCT FROM locked_event."sourceObjectId"
     OR locked_order."fulfillmentStatus"::text IS DISTINCT FROM 'PENDING'
     OR locked_order."labelStatus"::text IS NOT DISTINCT FROM 'PURCHASED'
     OR COALESCE(locked_order."labelClaimStatus", '') IN (
       'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
     ) THEN
    RAISE EXCEPTION 'Blocked-checkout refund record claim is no longer active'
      USING ERRCODE = 'serialization_failure';
  END IF;

  refund_amount :=
      locked_order."itemsSubtotalCents"
    + locked_order."shippingAmountCents"
    + COALESCE(locked_order."giftWrappingPriceCents", 0)
    + locked_order."taxAmountCents";
  seller_portion :=
      locked_order."itemsSubtotalCents"
    + locked_order."shippingAmountCents"
    + COALESCE(locked_order."giftWrappingPriceCents", 0);
  IF refund_amount <= 0
     OR p_transfer_reversal_amount_cents > refund_amount THEN
    RAISE EXCEPTION 'Blocked-checkout refund accounting evidence is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  original_transfer_amount := seller_portion
    - pg_catalog.round(
        locked_order."itemsSubtotalCents"::numeric * 0.05::numeric
      )::integer;
  expected_transfer_reversal :=
    locked_order."stripeTransferId" IS NOT NULL AND seller_portion > 0;
  IF expected_transfer_reversal
     AND (
       p_transfer_reversal_id IS NULL
       OR p_transfer_reversal_amount_cents
            IS DISTINCT FROM original_transfer_amount
     ) THEN
    RAISE EXCEPTION 'Blocked-checkout refund reversal evidence is missing or mismatched'
      USING ERRCODE = 'check_violation';
  ELSIF NOT expected_transfer_reversal
     AND (
       p_transfer_reversal_id IS NOT NULL
       OR p_transfer_reversal_amount_cents IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Blocked-checkout refund has unexpected transfer-reversal evidence'
      USING ERRCODE = 'check_violation';
  END IF;
  requires_manual_transfer_reconciliation :=
    locked_order."stripeTransferId" IS NULL;
  requires_manual_follow_up :=
    pg_catalog.lower(COALESCE(p_refund_status, ''))
      IN ('pending', 'requires_action');
  platform_funded_refund_cents := CASE
    WHEN p_transfer_reversal_amount_cents IS NOT NULL
      THEN GREATEST(
        0,
        refund_amount - p_transfer_reversal_amount_cents
      )
    WHEN expected_transfer_reversal THEN NULL
    ELSE refund_amount
  END;
  refund_accounting := pg_catalog.jsonb_build_object(
    'buyerRefundAmountCents', refund_amount,
    'chargeAmountCents', refund_amount,
    'originalTransferAmountCents', original_transfer_amount,
    'expectedTransferReversal', expected_transfer_reversal,
    'transferReversalId', p_transfer_reversal_id,
    'transferReversalAmountCents', p_transfer_reversal_amount_cents,
    'platformFundedRefundCents', platform_funded_refund_cents
  );
  event_metadata := pg_catalog.jsonb_build_object(
    'localAction', 'BLOCKED_CHECKOUT_REFUND_RECORDED',
    'refundIds', pg_catalog.jsonb_build_array(p_refund_id),
    'refundStatuses', pg_catalog.jsonb_build_array(p_refund_status),
    'refundAccounting', refund_accounting,
    'requiresManualTransferReconciliation',
      requires_manual_transfer_reconciliation,
    'requiresManualFollowUp', requires_manual_follow_up,
    'stripeSessionId', locked_order."stripeSessionId",
    'stripeEventType', locked_event.type,
    'refundClaimId', p_claim_id,
    'refundClaimGeneration', p_claim_generation::text,
    'refundClaimSource', 'BLOCKED_CHECKOUT',
    'refundClaimSourceId', p_event_id,
    'refundClaimSourceGeneration', p_event_claim_generation::text
  );
  transition_at := (
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3);
  review_note := pg_catalog.format(
    'Automatic full refund of %s cents via Stripe refund %s because checkout was no longer eligible.%s%s',
    refund_amount,
    p_refund_id,
    CASE
      WHEN requires_manual_transfer_reconciliation
        THEN ' Seller transfer reversal requires manual reconciliation.'
      ELSE ''
    END,
    CASE
      WHEN requires_manual_follow_up
        THEN ' Stripe refund status requires manual follow-up.'
      ELSE ''
    END
  );

  payment_event_id :=
    'blocked-checkout-refund-payment:'
    || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."OrderPaymentEvent" (
    id,
    "orderId",
    "stripeEventId",
    "stripeObjectId",
    "stripeObjectType",
    "eventType",
    "amountCents",
    currency,
    status,
    reason,
    description,
    metadata,
    "createdAt",
    "updatedAt"
  )
  VALUES (
    payment_event_id,
    locked_order.id,
    event_key,
    p_refund_id,
    'refund',
    'REFUND',
    refund_amount,
    pg_catalog.lower(locked_order.currency),
    p_refund_status,
    'blocked_checkout',
    review_note,
    event_metadata,
    transition_at,
    transition_at
  );

  UPDATE public."Order" AS orders
     SET "sellerRefundId" = p_refund_id,
         "sellerRefundAmountCents" = refund_amount,
         "sellerRefundLockedAt" = NULL,
         "refundClaimId" = NULL,
         "refundClaimSource" = NULL,
         "refundClaimSourceId" = NULL,
         "refundClaimSourceGeneration" = NULL,
         "refundClaimIdempotencyScope" = NULL,
         "refundClaimProviderAuthorizedAt" = NULL,
         "reviewNeeded" = true,
         "reviewNote" = review_note
   WHERE orders.id = locked_order.id
     AND orders."refundClaimId" = p_claim_id
     AND orders."refundClaimGeneration" = p_claim_generation
     AND orders."sellerRefundId" = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blocked-checkout refund record lost its active generation'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF requires_manual_transfer_reconciliation
     AND locked_order."sellerProfileId" IS NOT NULL THEN
    UPDATE public."SellerProfile" AS seller
       SET "manualStripeReconciliationNeeded" = true,
           "manualStripeReconciliationNote" =
             'Blocked-checkout refund used a platform-only Stripe refund; staff must reconcile the seller transfer manually.',
           "updatedAt" = transition_at
     WHERE seller.id = locked_order."sellerProfileId";
  END IF;

  PERFORM item.id
    FROM public."OrderItem" AS item
   WHERE item."orderId" = locked_order.id
   ORDER BY item.id
   FOR SHARE;
  PERFORM listing.id
    FROM public."Listing" AS listing
   WHERE listing.id IN (
     SELECT item."listingId"
       FROM public."OrderItem" AS item
      WHERE item."orderId" = locked_order.id
   )
   ORDER BY listing.id
   FOR UPDATE;

  FOR stock_restore IN
    SELECT item."listingId" AS listing_id,
           pg_catalog.sum(item.quantity)::integer AS quantity
      FROM public."OrderItem" AS item
      JOIN public."Listing" AS listing
        ON listing.id = item."listingId"
     WHERE item."orderId" = locked_order.id
       AND listing."listingType"::text = 'IN_STOCK'
     GROUP BY item."listingId"
     ORDER BY item."listingId"
  LOOP
    UPDATE public."Listing" AS listing
       SET "stockQuantity" = COALESCE(listing."stockQuantity", 0)
             + stock_restore.quantity,
           "updatedAt" = transition_at
     WHERE listing.id = stock_restore.listing_id
       AND listing."listingType"::text = 'IN_STOCK';

    UPDATE public."Listing" AS listing
       SET status = 'ACTIVE'::public."ListingStatus",
           "updatedAt" = transition_at
     WHERE listing.id = stock_restore.listing_id
       AND listing."listingType"::text = 'IN_STOCK'
       AND listing.status::text = 'SOLD_OUT'
       AND listing."stockQuantity" > 0
       AND NOT listing."isPrivate";
    GET DIAGNOSTICS reactivated_count = ROW_COUNT;
    restored_active_listing_count :=
      restored_active_listing_count + reactivated_count;
  END LOOP;

  UPDATE public."OrderPaymentEvent" AS payment_event
     SET metadata = pg_catalog.jsonb_set(
           payment_event.metadata,
           '{restoredActiveListingCount}',
           pg_catalog.to_jsonb(restored_active_listing_count),
           true
         ),
         "updatedAt" = transition_at
   WHERE payment_event.id = payment_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blocked-checkout payment event disappeared before finalization'
      USING ERRCODE = 'serialization_failure';
  END IF;

  audit_id :=
    'blocked-checkout-refund-audit:'
    || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."SystemAuditLog" (
    id,
    "actorType",
    "actorId",
    action,
    "targetType",
    "targetId",
    reason,
    metadata,
    "createdAt"
  )
  VALUES (
    audit_id,
    'webhook',
    locked_event.id,
    'BLOCKED_CHECKOUT_REFUND_RECORDED',
    'ORDER',
    locked_order.id,
    'blocked_checkout',
    pg_catalog.jsonb_build_object(
      'orderPaymentEventId', payment_event_id,
      'stripeRefundId', p_refund_id,
      'refundIds', pg_catalog.jsonb_build_array(p_refund_id),
      'amountCents', refund_amount,
      'currency', pg_catalog.lower(locked_order.currency),
      'refundAccounting', refund_accounting,
      'stripeSessionId', locked_order."stripeSessionId",
      'stripeEventType', locked_event.type,
      'refundClaimId', p_claim_id,
      'refundClaimGeneration', p_claim_generation::text,
      'refundClaimSourceGeneration', p_event_claim_generation::text,
      'restoredActiveListingCount', restored_active_listing_count
    ),
    transition_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'orderId', locked_order.id,
    'buyerUserId', locked_order."buyerId",
    'paymentEventId', payment_event_id,
    'refundId', p_refund_id,
    'refundAmountCents', refund_amount,
    'restoredActiveListingCount', restored_active_listing_count,
    'action', 'recorded'
  );
END
$grainline_blocked_checkout_refund_record_core$;

COMMENT ON FUNCTION public.grainline_order_review_eligibility_lock(text, text, bigint) IS
  'Locks one review-eligible purchase while excluding refund and conversion-dispute-blocked Orders.';
COMMENT ON FUNCTION public.grainline_order_seller_verification_sales(text, text) IS
  'Returns actor-bound completed clean-conversion sales for Guild verification.';
COMMENT ON FUNCTION public.grainline_order_seller_metrics_facts(text, bigint) IS
  'Returns service-scoped Guild facts; clean completed sales exclude conversion disputes while shipment performance remains factual.';
COMMENT ON FUNCTION public.grainline_blocked_checkout_refund_claim(text, bigint, text, text, integer) IS
  'Claims one signed blocked-checkout refund only before fulfillment or label purchase.';
COMMENT ON FUNCTION public.grainline_blocked_checkout_refund_record_core(text, bigint, text, bigint, text, text, text, integer) IS
  'Owner-private blocked-checkout finalizer that rechecks pre-fulfillment state before refund and stock restoration.';

DO $grainline_order_authority_composition_postflight$
DECLARE
  drifted text[];
BEGIN
  WITH expected(identity, body_md5, runtime_execute) AS (
    VALUES
      ('public.grainline_order_review_eligibility_lock(text,text,bigint)', 'bfd9386e3bb872ba6cc78cc6d1e4acd2', true),
      ('public.grainline_order_seller_verification_sales(text,text)', 'ea74eb7deb00c3ad71c8f16c7073587a', true),
      ('public.grainline_order_seller_analytics_summary(text,bigint,bigint,boolean)', '3996c8a65104b6fa30aeceb3e1294175', true),
      ('public.grainline_order_seller_analytics_buckets(text,bigint,bigint,boolean,text)', 'ccb51dc955603c009f64f4bd434240bd', true),
      ('public.grainline_order_seller_analytics_top_listings(text,bigint,bigint,boolean,boolean)', '195c87faa7dab7e74006f768b0a2e488', true),
      ('public.grainline_order_seller_recent_sales(text)', 'c4ea0bdb0b76c03ae3ce8629a857878b', true),
      ('public.grainline_order_seller_completed_count(text)', '00ec80ee2e6290eb6c6f6964b8571697', true),
      ('public.grainline_order_seller_metrics_facts(text,bigint)', 'd5ec7383846a3d8d1f870c8f7405626c', true),
      ('public.grainline_blocked_checkout_refund_claim(text,bigint,text,text,integer)', 'b0bf492b319622e2903cd6746e81c44c', false),
      ('public.grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)', '57afbb69975aabeff64b8a069f9088cf', false)
  ), inspected AS (
    SELECT
      expected.identity,
      expected.body_md5,
      expected.runtime_execute,
      procedure.oid,
      procedure.prosrc,
      procedure.prosecdef,
      procedure.proconfig,
      procedure.proowner
    FROM expected
    LEFT JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.identity)
  )
  SELECT pg_catalog.array_agg(identity ORDER BY identity)
    INTO drifted
    FROM inspected
   WHERE oid IS NULL
      OR pg_catalog.md5(prosrc) IS DISTINCT FROM body_md5
      OR NOT prosecdef
      OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
      OR proowner = 'grainline_app_runtime'::pg_catalog.regrole
      OR pg_catalog.has_function_privilege(
           'grainline_app_runtime', oid, 'EXECUTE'
         ) IS DISTINCT FROM runtime_execute
      OR pg_catalog.has_function_privilege('public', oid, 'EXECUTE');

  IF drifted IS NOT NULL THEN
    RAISE EXCEPTION 'Order authority composition correction drift: %', drifted;
  END IF;
END
$grainline_order_authority_composition_postflight$;

COMMIT;
