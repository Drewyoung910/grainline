-- Compatible bidirectional Order-summary cursor authority.
--
-- The predecessor summary pages provide the older-page half of keyset
-- navigation. These two additive functions provide the exact newer-page half
-- so buyer history and seller sales can retire bounded-but-growing OFFSET
-- scans without losing explicit Previous navigation.
-- No RLS posture, table grant, row data, or predecessor behavior changes.

BEGIN;

CREATE FUNCTION public.grainline_order_buyer_summary_after_page(
  p_actor_user_id text,
  p_limit integer,
  p_after_created_at_epoch_millis bigint,
  p_after_order_id text
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
AS $grainline_order_buyer_summary_after_page$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR p_after_created_at_epoch_millis IS NULL
     OR p_after_created_at_epoch_millis NOT BETWEEN 0 AND 253402300799999
     OR p_after_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_after_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Buyer Order newer summary-page input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT newer_page.*
  FROM (
    SELECT
      source_order.id AS order_id,
      pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint AS created_at_epoch_millis,
      CASE WHEN source_order."paidAt" IS NULL THEN NULL ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."paidAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint END AS paid_at_epoch_millis,
      source_order.currency::text AS currency,
      source_order."itemsSubtotalCents" AS items_subtotal_cents,
      source_order."shippingTitle"::text AS shipping_title,
      source_order."shippingAmountCents" AS shipping_amount_cents,
      source_order."taxAmountCents" AS tax_amount_cents,
      source_order."giftWrappingPriceCents" AS gift_wrapping_price_cents,
      source_order."sellerRefundAmountCents" AS seller_refund_amount_cents,
      source_order."fulfillmentStatus"::text AS fulfillment_status,
      source_order."labelCarrier"::text AS label_carrier,
      source_order."labelTrackingNumber"::text AS label_tracking_number,
      summary_items.item_count AS item_count,
      summary_items.items AS items
    FROM public."Order" AS source_order
    CROSS JOIN LATERAL public.grainline_order_summary_items(source_order.id) AS summary_items
    WHERE source_order."buyerId" = p_actor_user_id
      AND (source_order."createdAt", source_order.id) > (
        (
          pg_catalog.to_timestamp(p_after_created_at_epoch_millis::double precision / 1000.0)
          AT TIME ZONE 'UTC'
        )::timestamp(3) without time zone,
        p_after_order_id
      )
    ORDER BY source_order."createdAt" ASC, source_order.id ASC
    LIMIT p_limit
  ) AS newer_page
  ORDER BY newer_page.created_at_epoch_millis DESC, newer_page.order_id DESC;
END
$grainline_order_buyer_summary_after_page$;

CREATE FUNCTION public.grainline_order_seller_summary_after_page(
  p_actor_user_id text,
  p_limit integer,
  p_after_created_at_epoch_millis bigint,
  p_after_order_id text
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
AS $grainline_order_seller_summary_after_page$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR p_after_created_at_epoch_millis IS NULL
     OR p_after_created_at_epoch_millis NOT BETWEEN 0 AND 253402300799999
     OR p_after_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_after_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Seller Order newer summary-page input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT newer_page.*
  FROM (
    SELECT
      source_order.id AS order_id,
      pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint AS created_at_epoch_millis,
      CASE WHEN source_order."paidAt" IS NULL THEN NULL ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."paidAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint END AS paid_at_epoch_millis,
      source_order.currency::text AS currency,
      source_order."itemsSubtotalCents" AS items_subtotal_cents,
      source_order."shippingTitle"::text AS shipping_title,
      source_order."shippingAmountCents" AS shipping_amount_cents,
      source_order."taxAmountCents" AS tax_amount_cents,
      source_order."giftWrappingPriceCents" AS gift_wrapping_price_cents,
      source_order."sellerRefundAmountCents" AS seller_refund_amount_cents,
      source_order."fulfillmentStatus"::text AS fulfillment_status,
      source_order."sellerNotes" IS NOT NULL
        AND pg_catalog.char_length(source_order."sellerNotes") > 0 AS seller_notes_present,
      CASE
        WHEN source_order."buyerDataPurgedAt" IS NOT NULL OR buyer."deletedAt" IS NOT NULL
          THEN NULL
        ELSE source_order."buyerName"::text
      END AS buyer_name,
      CASE
        WHEN source_order."buyerDataPurgedAt" IS NOT NULL OR buyer."deletedAt" IS NOT NULL
          THEN NULL
        ELSE source_order."buyerEmail"::text
      END AS buyer_email,
      CASE WHEN source_order."buyerDataPurgedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."buyerDataPurgedAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint END AS buyer_data_purged_at_epoch_millis,
      CASE WHEN buyer."deletedAt" IS NULL THEN NULL ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (buyer."deletedAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint END AS buyer_deleted_at_epoch_millis,
      summary_items.item_count AS item_count,
      summary_items.items AS items
    FROM public."Order" AS source_order
    JOIN public."SellerProfile" AS seller
      ON seller.id = source_order."sellerProfileId"
     AND seller."userId" = p_actor_user_id
    LEFT JOIN public."User" AS buyer
      ON buyer.id = source_order."buyerId"
    CROSS JOIN LATERAL public.grainline_order_summary_items(source_order.id) AS summary_items
    WHERE (source_order."createdAt", source_order.id) > (
      (
        pg_catalog.to_timestamp(p_after_created_at_epoch_millis::double precision / 1000.0)
        AT TIME ZONE 'UTC'
      )::timestamp(3) without time zone,
      p_after_order_id
    )
    ORDER BY source_order."createdAt" ASC, source_order.id ASC
    LIMIT p_limit
  ) AS newer_page
  ORDER BY newer_page.created_at_epoch_millis DESC, newer_page.order_id DESC;
END
$grainline_order_seller_summary_after_page$;

REVOKE ALL ON FUNCTION public.grainline_order_buyer_summary_after_page(text, integer, bigint, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_seller_summary_after_page(text, integer, bigint, text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_summary_after_page(text, integer, bigint, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_summary_after_page(text, integer, bigint, text)
  TO grainline_app_runtime;

COMMIT;
