-- Compatible seller-private Order analytics authority preparation.
--
-- This migration is additive. It does not enable RLS, revoke predecessor
-- table grants, mutate rows, or change provider state. Every operation binds
-- the supplied application user to SellerProfile.userId inside PostgreSQL and
-- returns only its fixed analytics or recent-sale projection.

CREATE FUNCTION public.grainline_order_seller_analytics_summary(
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

CREATE FUNCTION public.grainline_order_seller_analytics_buckets(
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

CREATE FUNCTION public.grainline_order_seller_analytics_top_listings(
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

CREATE FUNCTION public.grainline_order_seller_recent_sales(
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
   ORDER BY source_order."createdAt" DESC, source_order.id DESC
   LIMIT 10;
END
$grainline_order_seller_recent_sales$;

CREATE FUNCTION public.grainline_order_seller_completed_count(
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
     AND source_order."fulfillmentStatus" IN (
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
     );

  RETURN result;
END
$grainline_order_seller_completed_count$;

REVOKE ALL ON FUNCTION public.grainline_order_seller_analytics_summary(
  text, bigint, bigint, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_analytics_buckets(
  text, bigint, bigint, boolean, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_analytics_top_listings(
  text, bigint, bigint, boolean, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_recent_sales(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_completed_count(text)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_order_seller_analytics_summary(
  text, bigint, bigint, boolean
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_analytics_buckets(
  text, bigint, bigint, boolean, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_analytics_top_listings(
  text, bigint, bigint, boolean, boolean
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_recent_sales(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_completed_count(text)
  TO grainline_app_runtime;
