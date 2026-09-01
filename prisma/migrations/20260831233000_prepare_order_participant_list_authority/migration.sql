-- Compatible participant Order-list authority preparation.
--
-- This migration is additive. It does not enable RLS, revoke predecessor
-- table grants, mutate rows, or change existing application behavior. The
-- four fixed SECURITY DEFINER functions expose only actor-bound, bounded
-- list/count projections needed by buyer and seller order screens.

CREATE FUNCTION public.grainline_order_buyer_count(
  p_actor_user_id text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_count$
DECLARE
  result bigint;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Buyer Order count actor is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pg_catalog.count(*)
    INTO STRICT result
    FROM public."Order" AS source_order
   WHERE source_order."buyerId" = p_actor_user_id;

  RETURN result;
END
$grainline_order_buyer_count$;

CREATE FUNCTION public.grainline_order_buyer_page(
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
  fulfillment_status text
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_page$
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
    RAISE EXCEPTION 'Buyer Order page input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    source_order.id,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint,
    CASE
      WHEN source_order."paidAt" IS NULL THEN NULL
      ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."paidAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint
    END,
    source_order.currency::text,
    source_order."itemsSubtotalCents",
    source_order."shippingTitle",
    source_order."shippingAmountCents",
    source_order."taxAmountCents",
    source_order."giftWrappingPriceCents",
    source_order."sellerRefundAmountCents",
    source_order."fulfillmentStatus"::text
  FROM public."Order" AS source_order
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
$grainline_order_buyer_page$;

CREATE FUNCTION public.grainline_order_seller_count(
  p_actor_user_id text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_count$
DECLARE
  result bigint;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Seller Order count actor is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pg_catalog.count(*)
    INTO STRICT result
    FROM public."Order" AS source_order
    JOIN public."SellerProfile" AS seller
      ON seller.id = source_order."sellerProfileId"
     AND seller."userId" = p_actor_user_id;

  RETURN result;
END
$grainline_order_seller_count$;

CREATE FUNCTION public.grainline_order_seller_page(
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
  buyer_deleted_at_epoch_millis bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_page$
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
    RAISE EXCEPTION 'Seller Order page input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    source_order.id,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (source_order."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint,
    CASE
      WHEN source_order."paidAt" IS NULL THEN NULL
      ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."paidAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint
    END,
    source_order.currency::text,
    source_order."itemsSubtotalCents",
    source_order."shippingTitle",
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
      ELSE source_order."buyerName"
    END,
    CASE
      WHEN source_order."buyerDataPurgedAt" IS NOT NULL OR buyer."deletedAt" IS NOT NULL
        THEN NULL
      ELSE source_order."buyerEmail"
    END,
    CASE
      WHEN source_order."buyerDataPurgedAt" IS NULL THEN NULL
      ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (source_order."buyerDataPurgedAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint
    END,
    CASE
      WHEN buyer."deletedAt" IS NULL THEN NULL
      ELSE pg_catalog.floor(
        EXTRACT(EPOCH FROM (buyer."deletedAt" AT TIME ZONE 'UTC')) * 1000
      )::bigint
    END
  FROM public."Order" AS source_order
  JOIN public."SellerProfile" AS seller
    ON seller.id = source_order."sellerProfileId"
   AND seller."userId" = p_actor_user_id
  LEFT JOIN public."User" AS buyer
    ON buyer.id = source_order."buyerId"
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
$grainline_order_seller_page$;

REVOKE ALL ON FUNCTION public.grainline_order_buyer_count(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_buyer_page(text, integer, bigint, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_seller_count(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_seller_page(text, integer, bigint, text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_count(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_page(text, integer, bigint, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_count(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_page(text, integer, bigint, text)
  TO grainline_app_runtime;
