-- Compatible participant Order-summary authority preparation.
--
-- The earlier scalar list projection omitted the historical item summaries
-- rendered by every buyer/seller list surface. This additive successor keeps
-- list payloads useful without N+1 detail reads: each Order returns at most
-- five minimal historical item summaries plus the complete item count.
-- No RLS posture, table grant, row data, or predecessor behavior changes.

BEGIN;

CREATE FUNCTION public.grainline_order_summary_items(
  p_order_id text
)
RETURNS TABLE(item_count integer, items jsonb)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_summary_items$
  SELECT
    (
      SELECT pg_catalog.count(*)::integer
        FROM public."OrderItem" AS counted_item
       WHERE counted_item."orderId" = p_order_id
    ),
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', summary_item.id,
          'listingId', summary_item."listingId",
          'priceCents', summary_item."priceCents",
          'quantity', summary_item.quantity,
          'title', summary_item."listingSnapshot"->'title',
          'imageUrl', summary_item."listingSnapshot"->'imageUrls'->0,
          'sellerName', summary_item."listingSnapshot"->'sellerName'
        )
        ORDER BY summary_item."createdAt", summary_item.id
      )
      FROM (
        SELECT source_item.*
          FROM public."OrderItem" AS source_item
         WHERE source_item."orderId" = p_order_id
         ORDER BY source_item."createdAt", source_item.id
         LIMIT 5
      ) AS summary_item
    ), '[]'::jsonb);
$grainline_order_summary_items$;

CREATE FUNCTION public.grainline_order_buyer_summary_page(
  p_actor_user_id text,
  p_limit integer,
  p_before_created_at_epoch_millis bigint,
  p_before_order_id text
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
  gift_wrapping_price_cents integer,
  seller_refund_amount_cents integer,
  fulfillment_status text,
  label_carrier text,
  label_tracking_number text,
  item_count integer,
  items jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_summary_page$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_before_created_at_epoch_millis IS NULL) <> (p_before_order_id IS NULL)
     OR (
       p_before_created_at_epoch_millis IS NOT NULL
       AND p_before_created_at_epoch_millis NOT BETWEEN 0 AND 253402300799999
     )
     OR (
       p_before_order_id IS NOT NULL
       AND pg_catalog.char_length(pg_catalog.btrim(p_before_order_id)) NOT BETWEEN 1 AND 191
     ) THEN
    RAISE EXCEPTION 'Buyer Order summary-page input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    source_order.id,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint,
    CASE WHEN source_order."paidAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."paidAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    source_order.currency::text,
    source_order."itemsSubtotalCents",
    source_order."shippingTitle"::text,
    source_order."shippingAmountCents",
    source_order."taxAmountCents",
    source_order."giftWrappingPriceCents",
    source_order."sellerRefundAmountCents",
    source_order."fulfillmentStatus"::text,
    source_order."labelCarrier"::text,
    source_order."labelTrackingNumber"::text,
    summary_items.item_count,
    summary_items.items
  FROM public."Order" AS source_order
  CROSS JOIN LATERAL public.grainline_order_summary_items(source_order.id) AS summary_items
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
$grainline_order_buyer_summary_page$;

CREATE FUNCTION public.grainline_order_seller_summary_page(
  p_actor_user_id text,
  p_limit integer,
  p_before_created_at_epoch_millis bigint,
  p_before_order_id text
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
  gift_wrapping_price_cents integer,
  seller_refund_amount_cents integer,
  fulfillment_status text,
  seller_notes_present boolean,
  buyer_name text,
  buyer_email text,
  buyer_data_purged_at_epoch_millis bigint,
  buyer_deleted_at_epoch_millis bigint,
  item_count integer,
  items jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_summary_page$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR (p_before_created_at_epoch_millis IS NULL) <> (p_before_order_id IS NULL)
     OR (
       p_before_created_at_epoch_millis IS NOT NULL
       AND p_before_created_at_epoch_millis NOT BETWEEN 0 AND 253402300799999
     )
     OR (
       p_before_order_id IS NOT NULL
       AND pg_catalog.char_length(pg_catalog.btrim(p_before_order_id)) NOT BETWEEN 1 AND 191
     ) THEN
    RAISE EXCEPTION 'Seller Order summary-page input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    source_order.id,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint,
    CASE WHEN source_order."paidAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."paidAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    source_order.currency::text,
    source_order."itemsSubtotalCents",
    source_order."shippingTitle"::text,
    source_order."shippingAmountCents",
    source_order."taxAmountCents",
    source_order."giftWrappingPriceCents",
    source_order."sellerRefundAmountCents",
    source_order."fulfillmentStatus"::text,
    source_order."sellerNotes" IS NOT NULL
      AND pg_catalog.char_length(source_order."sellerNotes") > 0,
    CASE
      WHEN source_order."buyerDataPurgedAt" IS NOT NULL OR buyer."deletedAt" IS NOT NULL
        THEN NULL
      ELSE source_order."buyerName"::text
    END,
    CASE
      WHEN source_order."buyerDataPurgedAt" IS NOT NULL OR buyer."deletedAt" IS NOT NULL
        THEN NULL
      ELSE source_order."buyerEmail"::text
    END,
    CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."buyerDataPurgedAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    CASE WHEN buyer."deletedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
      EXTRACT(EPOCH FROM (buyer."deletedAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint END,
    summary_items.item_count,
    summary_items.items
  FROM public."Order" AS source_order
  JOIN public."SellerProfile" AS seller
    ON seller.id = source_order."sellerProfileId"
   AND seller."userId" = p_actor_user_id
  LEFT JOIN public."User" AS buyer
    ON buyer.id = source_order."buyerId"
  CROSS JOIN LATERAL public.grainline_order_summary_items(source_order.id) AS summary_items
  WHERE (
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
$grainline_order_seller_summary_page$;

REVOKE ALL ON FUNCTION public.grainline_order_summary_items(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_buyer_summary_page(text, integer, bigint, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_seller_summary_page(text, integer, bigint, text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_summary_page(text, integer, bigint, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_summary_page(text, integer, bigint, text)
  TO grainline_app_runtime;

COMMIT;
