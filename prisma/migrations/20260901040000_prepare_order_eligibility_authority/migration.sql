-- Compatible Order eligibility authority preparation.
--
-- This migration is additive. It does not enable RLS, revoke predecessor
-- table grants, mutate rows, or change existing application behavior. The
-- four fixed SECURITY DEFINER functions expose only actor-bound booleans,
-- aggregate cents, or the single locked source pair required by existing
-- review, report, verification, and listing-archive flows.

CREATE FUNCTION public.grainline_order_review_eligibility_lock(
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

CREATE FUNCTION public.grainline_order_report_target_access(
  p_actor_user_id text,
  p_reported_user_id text,
  p_order_id text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_report_target_access$
DECLARE
  result boolean;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_reported_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_reported_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Order report target input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(pg_catalog.bool_or(
    (source_order."buyerId" = p_actor_user_id OR seller."userId" = p_actor_user_id)
    AND
    (source_order."buyerId" = p_reported_user_id OR seller."userId" = p_reported_user_id)
  ), false)
    INTO STRICT result
    FROM public."Order" AS source_order
    JOIN public."SellerProfile" AS seller
      ON seller.id = source_order."sellerProfileId"
   WHERE source_order.id = p_order_id;

  RETURN result;
END
$grainline_order_report_target_access$;

CREATE FUNCTION public.grainline_order_seller_verification_sales(
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

CREATE FUNCTION public.grainline_listing_order_archive_blocked(
  p_actor_user_id text,
  p_listing_id text,
  p_now_epoch_millis bigint
)
RETURNS TABLE(blocked boolean)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_order_archive_blocked$
DECLARE
  reference_now timestamp(3) without time zone;
  terminal_cutoff timestamp(3) without time zone;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_listing_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_listing_id)) NOT BETWEEN 1 AND 191
     OR p_now_epoch_millis IS NULL
     OR p_now_epoch_millis NOT BETWEEN 0 AND 253402300799999 THEN
    RAISE EXCEPTION 'Listing Order archive input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  reference_now := (
    pg_catalog.to_timestamp(p_now_epoch_millis::double precision / 1000.0)
    AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;
  terminal_cutoff := reference_now - INTERVAL '30 days';

  RETURN QUERY
  SELECT EXISTS (
    SELECT 1
      FROM public."OrderItem" AS source_item
      JOIN public."Order" AS source_order
        ON source_order.id = source_item."orderId"
     WHERE source_item."listingId" = listing.id
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
       AND (
         source_order."fulfillmentStatus" IN (
           'PENDING'::public."FulfillmentStatus",
           'READY_FOR_PICKUP'::public."FulfillmentStatus",
           'SHIPPED'::public."FulfillmentStatus"
         )
         OR (
           source_order."fulfillmentStatus" = 'DELIVERED'::public."FulfillmentStatus"
           AND (
             source_order."deliveredAt" IS NULL
             OR source_order."deliveredAt" >= terminal_cutoff
           )
         )
         OR (
           source_order."fulfillmentStatus" = 'PICKED_UP'::public."FulfillmentStatus"
           AND (
             source_order."pickedUpAt" IS NULL
             OR source_order."pickedUpAt" >= terminal_cutoff
           )
         )
         OR EXISTS (
           SELECT 1
             FROM public."Case" AS source_case
            WHERE source_case."orderId" = source_order.id
              AND source_case.status IN (
                'OPEN'::public."CaseStatus",
                'IN_DISCUSSION'::public."CaseStatus",
                'PENDING_CLOSE'::public."CaseStatus",
                'UNDER_REVIEW'::public."CaseStatus"
              )
         )
       )
  )
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
     AND seller."userId" = p_actor_user_id;
END
$grainline_listing_order_archive_blocked$;

REVOKE ALL ON FUNCTION public.grainline_order_review_eligibility_lock(text, text, bigint)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_report_target_access(text, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_verification_sales(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_listing_order_archive_blocked(text, text, bigint)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_order_review_eligibility_lock(text, text, bigint)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_report_target_access(text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_verification_sales(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_order_archive_blocked(text, text, bigint)
  TO grainline_app_runtime;
