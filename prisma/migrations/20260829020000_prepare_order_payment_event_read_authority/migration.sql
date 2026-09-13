-- Compatible OrderPaymentEvent read-authority preparation.
--
-- This release is additive: predecessor runtime table CRUD and RLS-off posture
-- remain unchanged so old and new application instances can coexist. The five
-- fixed functions expose only actor-bound, bounded projections. They do not
-- provide a generic row lookup, arbitrary predicate, or base-table cursor.

CREATE FUNCTION public.grainline_order_payment_buyer_refund_outcomes(
  p_actor_user_id text,
  p_order_ids text[]
)
RETURNS TABLE(
  order_id text,
  amount_cents integer,
  currency text,
  status text,
  created_at_epoch_millis bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_buyer_refund_outcomes$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR pg_catalog.array_ndims(p_order_ids) IS DISTINCT FROM 1
     OR pg_catalog.cardinality(p_order_ids) NOT BETWEEN 1 AND 100
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_order_ids) AS requested(value)
        WHERE requested.value IS NULL
           OR pg_catalog.char_length(pg_catalog.btrim(requested.value)) NOT BETWEEN 1 AND 191
     )
     OR (
       SELECT pg_catalog.count(DISTINCT requested.value)
         FROM pg_catalog.unnest(p_order_ids) AS requested(value)
     ) IS DISTINCT FROM pg_catalog.cardinality(p_order_ids)::bigint THEN
    RAISE EXCEPTION 'Buyer payment outcome input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    source_order.id,
    refund."amountCents",
    refund.currency::text,
    refund.status::text,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (refund."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint
  FROM pg_catalog.unnest(p_order_ids) WITH ORDINALITY
    AS requested(order_id, request_ordinal)
  JOIN public."Order" AS source_order
    ON source_order.id = requested.order_id
   AND source_order."buyerId" = p_actor_user_id
  JOIN LATERAL (
    SELECT
      payment."amountCents",
      payment.currency,
      payment.status,
      payment."createdAt"
    FROM public."OrderPaymentEvent" AS payment
    WHERE payment."orderId" = source_order.id
      AND payment."eventType" = 'REFUND'
      AND (
        payment.status IS NULL
        OR pg_catalog.lower(payment.status) NOT IN ('failed', 'canceled', 'cancelled')
      )
    ORDER BY payment."createdAt" DESC, payment.id DESC
    LIMIT 1
  ) AS refund ON true
  ORDER BY requested.request_ordinal;
END
$grainline_order_payment_buyer_refund_outcomes$;

CREATE FUNCTION public.grainline_order_payment_seller_refund_outcomes(
  p_actor_user_id text,
  p_order_ids text[]
)
RETURNS TABLE(
  order_id text,
  amount_cents integer,
  currency text,
  status text,
  created_at_epoch_millis bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_seller_refund_outcomes$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR pg_catalog.array_ndims(p_order_ids) IS DISTINCT FROM 1
     OR pg_catalog.cardinality(p_order_ids) NOT BETWEEN 1 AND 100
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_order_ids) AS requested(value)
        WHERE requested.value IS NULL
           OR pg_catalog.char_length(pg_catalog.btrim(requested.value)) NOT BETWEEN 1 AND 191
     )
     OR (
       SELECT pg_catalog.count(DISTINCT requested.value)
         FROM pg_catalog.unnest(p_order_ids) AS requested(value)
     ) IS DISTINCT FROM pg_catalog.cardinality(p_order_ids)::bigint THEN
    RAISE EXCEPTION 'Seller payment outcome input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    source_order.id,
    refund."amountCents",
    refund.currency::text,
    refund.status::text,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (refund."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint
  FROM pg_catalog.unnest(p_order_ids) WITH ORDINALITY
    AS requested(order_id, request_ordinal)
  JOIN public."Order" AS source_order
    ON source_order.id = requested.order_id
  JOIN public."SellerProfile" AS seller
    ON seller.id = source_order."sellerProfileId"
   AND seller."userId" = p_actor_user_id
  JOIN LATERAL (
    SELECT
      payment."amountCents",
      payment.currency,
      payment.status,
      payment."createdAt"
    FROM public."OrderPaymentEvent" AS payment
    WHERE payment."orderId" = source_order.id
      AND payment."eventType" = 'REFUND'
      AND (
        payment.status IS NULL
        OR pg_catalog.lower(payment.status) NOT IN ('failed', 'canceled', 'cancelled')
      )
    ORDER BY payment."createdAt" DESC, payment.id DESC
    LIMIT 1
  ) AS refund ON true
  ORDER BY requested.request_ordinal;
END
$grainline_order_payment_seller_refund_outcomes$;

CREATE FUNCTION public.grainline_order_payment_buyer_export_page(
  p_actor_user_id text,
  p_limit integer,
  p_before_created_at_epoch_millis bigint,
  p_before_payment_event_id text
)
RETURNS TABLE(
  payment_event_id text,
  order_id text,
  event_type text,
  amount_cents integer,
  currency text,
  status text,
  created_at_epoch_millis bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_buyer_export_page$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500
     OR (p_before_created_at_epoch_millis IS NULL) <> (p_before_payment_event_id IS NULL)
     OR (
       p_before_created_at_epoch_millis IS NOT NULL
       AND p_before_created_at_epoch_millis NOT BETWEEN 0 AND 253402300799999
     )
     OR (
       p_before_payment_event_id IS NOT NULL
       AND pg_catalog.char_length(pg_catalog.btrim(p_before_payment_event_id)) NOT BETWEEN 1 AND 191
     ) THEN
    RAISE EXCEPTION 'Buyer payment export input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    payment.id,
    payment."orderId",
    payment."eventType"::text,
    payment."amountCents",
    payment.currency::text,
    payment.status::text,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (payment."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint
  FROM public."Order" AS source_order
  JOIN public."OrderPaymentEvent" AS payment
    ON payment."orderId" = source_order.id
  WHERE source_order."buyerId" = p_actor_user_id
    AND payment."eventType" = 'REFUND'
    AND (
      p_before_created_at_epoch_millis IS NULL
      OR (payment."createdAt", payment.id) < (
        (
          pg_catalog.to_timestamp(p_before_created_at_epoch_millis::double precision / 1000.0)
          AT TIME ZONE 'UTC'
        )::timestamp(3) without time zone,
        p_before_payment_event_id
      )
    )
  ORDER BY payment."createdAt" DESC, payment.id DESC
  LIMIT p_limit;
END
$grainline_order_payment_buyer_export_page$;

CREATE FUNCTION public.grainline_order_payment_seller_export_page(
  p_actor_user_id text,
  p_limit integer,
  p_before_created_at_epoch_millis bigint,
  p_before_payment_event_id text
)
RETURNS TABLE(
  payment_event_id text,
  order_id text,
  event_type text,
  amount_cents integer,
  currency text,
  status text,
  reason text,
  created_at_epoch_millis bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_seller_export_page$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500
     OR (p_before_created_at_epoch_millis IS NULL) <> (p_before_payment_event_id IS NULL)
     OR (
       p_before_created_at_epoch_millis IS NOT NULL
       AND p_before_created_at_epoch_millis NOT BETWEEN 0 AND 253402300799999
     )
     OR (
       p_before_payment_event_id IS NOT NULL
       AND pg_catalog.char_length(pg_catalog.btrim(p_before_payment_event_id)) NOT BETWEEN 1 AND 191
     ) THEN
    RAISE EXCEPTION 'Seller payment export input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    payment.id,
    payment."orderId",
    payment."eventType"::text,
    payment."amountCents",
    payment.currency::text,
    payment.status::text,
    payment.reason::text,
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (payment."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint
  FROM public."Order" AS source_order
  JOIN public."SellerProfile" AS seller
    ON seller.id = source_order."sellerProfileId"
  JOIN public."OrderPaymentEvent" AS payment
    ON payment."orderId" = source_order.id
  WHERE seller."userId" = p_actor_user_id
    AND payment."eventType" = 'REFUND'
    AND (
      p_before_created_at_epoch_millis IS NULL
      OR (payment."createdAt", payment.id) < (
        (
          pg_catalog.to_timestamp(p_before_created_at_epoch_millis::double precision / 1000.0)
          AT TIME ZONE 'UTC'
        )::timestamp(3) without time zone,
        p_before_payment_event_id
      )
    )
  ORDER BY payment."createdAt" DESC, payment.id DESC
  LIMIT p_limit;
END
$grainline_order_payment_seller_export_page$;

CREATE FUNCTION public.grainline_order_payment_staff_timeline(
  p_actor_user_id text,
  p_order_id text,
  p_limit integer
)
RETURNS TABLE(
  payment_event_id text,
  stripe_event_id text,
  stripe_object_id text,
  stripe_object_type text,
  event_type text,
  amount_cents integer,
  currency text,
  status text,
  reason text,
  description text,
  transfer_reversal_id text,
  transfer_reversal_amount_cents text,
  platform_funded_refund_cents text,
  original_transfer_amount_cents text,
  created_at_epoch_millis bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_staff_timeline$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION 'Staff payment timeline input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = p_actor_user_id
       AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Staff payment timeline access denied'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    payment.id,
    payment."stripeEventId"::text,
    payment."stripeObjectId"::text,
    payment."stripeObjectType"::text,
    payment."eventType"::text,
    payment."amountCents",
    payment.currency::text,
    payment.status::text,
    payment.reason::text,
    payment.description::text,
    NULLIF(payment.metadata #>> '{refundAccounting,transferReversalId}', ''),
    NULLIF(payment.metadata #>> '{refundAccounting,transferReversalAmountCents}', ''),
    NULLIF(payment.metadata #>> '{refundAccounting,platformFundedRefundCents}', ''),
    NULLIF(payment.metadata #>> '{refundAccounting,originalTransferAmountCents}', ''),
    pg_catalog.floor(
      EXTRACT(EPOCH FROM (payment."createdAt" AT TIME ZONE 'UTC')) * 1000
    )::bigint
  FROM public."OrderPaymentEvent" AS payment
  WHERE payment."orderId" = p_order_id
  ORDER BY payment."createdAt" DESC, payment.id DESC
  LIMIT p_limit;
END
$grainline_order_payment_staff_timeline$;

REVOKE ALL ON FUNCTION public.grainline_order_payment_buyer_refund_outcomes(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_payment_seller_refund_outcomes(text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_payment_buyer_export_page(text, integer, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_payment_seller_export_page(text, integer, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_payment_staff_timeline(text, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_order_payment_buyer_refund_outcomes(text, text[]) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_payment_seller_refund_outcomes(text, text[]) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_payment_buyer_export_page(text, integer, bigint, text) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_payment_seller_export_page(text, integer, bigint, text) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_payment_staff_timeline(text, text, integer) TO grainline_app_runtime;
