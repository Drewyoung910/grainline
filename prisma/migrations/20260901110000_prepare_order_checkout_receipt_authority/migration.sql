-- Compatible checkout-success Order receipt authority.
--
-- This additive migration replaces the success page's direct Order read with
-- one bounded buyer-scoped projection. It returns only receipt fields, uses
-- the checkout-time buyer label and historical item projection, and accepts
-- only paid Orders. It does not enable RLS, change table grants, mutate rows,
-- or switch application readers.

CREATE FUNCTION public.grainline_order_buyer_receipts_by_sessions(
  p_actor_user_id text,
  p_session_ids text[]
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
  buyer_label text,
  items jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_receipts_by_sessions$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_session_ids IS NULL
     OR pg_catalog.cardinality(p_session_ids) NOT BETWEEN 1 AND 50
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_session_ids) AS requested(session_id)
        WHERE requested.session_id IS NULL
           OR pg_catalog.char_length(pg_catalog.btrim(requested.session_id)) NOT BETWEEN 4 AND 255
           OR requested.session_id <> pg_catalog.btrim(requested.session_id)
           OR requested.session_id !~ '^cs_'
     )
     OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.unnest(p_session_ids) AS requested(session_id)
     ) <> (
       SELECT pg_catalog.count(DISTINCT requested.session_id)
         FROM pg_catalog.unnest(p_session_ids) AS requested(session_id)
     ) THEN
    RAISE EXCEPTION 'Checkout receipt input is invalid'
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
    detail.gift_wrapping_price_cents,
    CASE
      WHEN source_order."buyerDataPurgedAt" IS NULL THEN COALESCE(
        NULLIF(pg_catalog.btrim(source_order."buyerName"), ''),
        NULLIF(pg_catalog.btrim(source_order."buyerEmail"), '')
      )
      ELSE NULL
    END,
    detail.items
    FROM public."Order" AS source_order
    JOIN public."User" AS actor
      ON actor.id = p_actor_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
    CROSS JOIN LATERAL public.grainline_order_buyer_detail_v3(
      p_actor_user_id,
      source_order.id
    ) AS detail
   WHERE source_order."buyerId" = p_actor_user_id
     AND source_order."stripeSessionId" = ANY(p_session_ids)
     AND source_order."paidAt" IS NOT NULL
   ORDER BY source_order."createdAt" DESC, source_order.id DESC;
END;
$grainline_order_buyer_receipts_by_sessions$;

REVOKE ALL ON FUNCTION public.grainline_order_buyer_receipts_by_sessions(text, text[])
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_receipts_by_sessions(text, text[])
  TO grainline_app_runtime;
