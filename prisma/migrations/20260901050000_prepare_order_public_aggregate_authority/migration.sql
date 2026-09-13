-- Compatible public Order aggregate authority preparation.
--
-- This migration is additive. It does not enable RLS, revoke predecessor
-- table grants, mutate rows, or change existing application behavior. The
-- four fixed SECURITY DEFINER functions expose public aggregate facts only;
-- no Order row, participant identity, address, or provider identifier leaves
-- the database boundary.

CREATE FUNCTION public.grainline_order_public_fulfilled_count()
RETURNS bigint
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_public_fulfilled_count$
  SELECT pg_catalog.count(*)::bigint
    FROM public."Order" AS source_order
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
     )
$grainline_order_public_fulfilled_count$;

CREATE FUNCTION public.grainline_order_public_seller_stats(
  p_seller_profile_id text,
  p_recent_shipping_since_epoch_millis bigint
)
RETURNS TABLE(
  sold_count bigint,
  shipped_count bigint,
  avg_ship_days double precision
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_public_seller_stats$
DECLARE
  recent_shipping_cutoff timestamp(3) without time zone;
BEGIN
  IF p_seller_profile_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_seller_profile_id)) NOT BETWEEN 1 AND 191
     OR p_recent_shipping_since_epoch_millis IS NULL
     OR p_recent_shipping_since_epoch_millis NOT BETWEEN 0 AND 253402300799999 THEN
    RAISE EXCEPTION 'Public seller Order stats input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  recent_shipping_cutoff := (
    pg_catalog.to_timestamp(
      p_recent_shipping_since_epoch_millis::double precision / 1000.0
    ) AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;

  RETURN QUERY
  WITH visible_seller AS (
    SELECT seller.id
      FROM public."SellerProfile" AS seller
      JOIN public."User" AS seller_user
        ON seller_user.id = seller."userId"
     WHERE seller.id = p_seller_profile_id
       AND seller."chargesEnabled" = true
       AND (
         seller."stripeAccountVersion" IS NULL
         OR seller."stripeAccountVersion" = 'v2'
       )
       AND seller_user.banned = false
       AND seller_user."deletedAt" IS NULL
  ),
  sold AS (
    SELECT
      visible_seller.id,
      COALESCE(pg_catalog.sum(source_item.quantity::bigint), 0::numeric)::bigint AS value
      FROM visible_seller
      LEFT JOIN public."Order" AS source_order
        ON source_order."sellerProfileId" = visible_seller.id
       AND source_order."paidAt" IS NOT NULL
       AND (
         source_order."stripeSessionId" IS NOT NULL
         OR source_order."stripePaymentIntentId" IS NOT NULL
         OR source_order."stripeChargeId" IS NOT NULL
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
      LEFT JOIN public."OrderItem" AS source_item
        ON source_item."orderId" = source_order.id
       AND source_item."sellerProfileId" = visible_seller.id
     GROUP BY visible_seller.id
  ),
  recent_shipping AS (
    SELECT source_order."paidAt", source_order."shippedAt"
      FROM visible_seller
      JOIN public."Order" AS source_order
        ON source_order."sellerProfileId" = visible_seller.id
     WHERE source_order."shippedAt" IS NOT NULL
       AND source_order."shippedAt" >= recent_shipping_cutoff
       AND source_order."paidAt" IS NOT NULL
       AND (
         source_order."stripeSessionId" IS NOT NULL
         OR source_order."stripePaymentIntentId" IS NOT NULL
         OR source_order."stripeChargeId" IS NOT NULL
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
     ORDER BY source_order."shippedAt" DESC, source_order.id DESC
     LIMIT 30
  )
  SELECT
    sold.value,
    pg_catalog.count(recent_shipping."shippedAt")::bigint,
    pg_catalog.avg(
      EXTRACT(
        epoch FROM (recent_shipping."shippedAt" - recent_shipping."paidAt")
      ) / 86400.0
    )::double precision
    FROM sold
    LEFT JOIN recent_shipping ON true
   GROUP BY sold.value;
END
$grainline_order_public_seller_stats$;

CREATE FUNCTION public.grainline_order_public_listing_counts(
  p_listing_ids text[]
)
RETURNS TABLE(
  listing_id text,
  order_count bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_public_listing_counts$
BEGIN
  IF p_listing_ids IS NULL
     OR pg_catalog.cardinality(p_listing_ids) NOT BETWEEN 1 AND 200
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR pg_catalog.char_length(pg_catalog.btrim(requested.id)) NOT BETWEEN 1 AND 191
     )
     OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
     ) <> (
       SELECT pg_catalog.count(DISTINCT requested.id)
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
     ) THEN
    RAISE EXCEPTION 'Public listing Order counts input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    listing.id,
    pg_catalog.count(source_order.id)::bigint
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    JOIN public."User" AS seller_user
      ON seller_user.id = seller."userId"
    LEFT JOIN public."OrderItem" AS source_item
      ON source_item."listingId" = listing.id
     AND source_item."sellerProfileId" = seller.id
    LEFT JOIN public."Order" AS source_order
      ON source_order.id = source_item."orderId"
     AND source_order."sellerProfileId" = seller.id
     AND source_order."paidAt" IS NOT NULL
     AND (
       source_order."stripeSessionId" IS NOT NULL
       OR source_order."stripePaymentIntentId" IS NOT NULL
       OR source_order."stripeChargeId" IS NOT NULL
     )
     AND source_order."sellerRefundId" IS NULL
     AND source_order."paymentRefundBlocked" = false
     AND source_order."paymentConversionDisputeBlocked" = false
   WHERE listing.id = ANY(p_listing_ids)
     AND listing.status = 'ACTIVE'::public."ListingStatus"
     AND listing."isPrivate" = false
     AND seller."chargesEnabled" = true
     AND (
       seller."stripeAccountVersion" IS NULL
       OR seller."stripeAccountVersion" = 'v2'
     )
     AND seller."vacationMode" = false
     AND seller_user.banned = false
     AND seller_user."deletedAt" IS NULL
   GROUP BY listing.id
   ORDER BY listing.id;
END
$grainline_order_public_listing_counts$;

CREATE FUNCTION public.grainline_order_public_marketplace_listing_metrics()
RETURNS TABLE(
  total_views bigint,
  total_clicks bigint,
  total_orders bigint
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_public_marketplace_listing_metrics$
  WITH visible_listings AS (
    SELECT listing.id, listing."viewCount", listing."clickCount", listing."sellerId"
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
      JOIN public."User" AS seller_user
        ON seller_user.id = seller."userId"
     WHERE listing.status = 'ACTIVE'::public."ListingStatus"
       AND listing."isPrivate" = false
       AND seller."chargesEnabled" = true
       AND (
         seller."stripeAccountVersion" IS NULL
         OR seller."stripeAccountVersion" = 'v2'
       )
       AND seller."vacationMode" = false
       AND seller_user.banned = false
       AND seller_user."deletedAt" IS NULL
  )
  SELECT
    COALESCE((SELECT pg_catalog.sum("viewCount") FROM visible_listings), 0)::bigint,
    COALESCE((SELECT pg_catalog.sum("clickCount") FROM visible_listings), 0)::bigint,
    COALESCE((
      SELECT pg_catalog.count(source_item.id)
        FROM visible_listings
        JOIN public."OrderItem" AS source_item
          ON source_item."listingId" = visible_listings.id
         AND source_item."sellerProfileId" = visible_listings."sellerId"
        JOIN public."Order" AS source_order
          ON source_order.id = source_item."orderId"
         AND source_order."sellerProfileId" = visible_listings."sellerId"
       WHERE source_order."paidAt" IS NOT NULL
         AND (
           source_order."stripeSessionId" IS NOT NULL
           OR source_order."stripePaymentIntentId" IS NOT NULL
           OR source_order."stripeChargeId" IS NOT NULL
         )
         AND source_order."sellerRefundId" IS NULL
         AND source_order."paymentRefundBlocked" = false
         AND source_order."paymentConversionDisputeBlocked" = false
    ), 0)::bigint
$grainline_order_public_marketplace_listing_metrics$;

REVOKE ALL ON FUNCTION public.grainline_order_public_fulfilled_count()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_public_seller_stats(text, bigint)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_public_listing_counts(text[])
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_public_marketplace_listing_metrics()
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_order_public_fulfilled_count()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_public_seller_stats(text, bigint)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_public_listing_counts(text[])
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_public_marketplace_listing_metrics()
  TO grainline_app_runtime;
