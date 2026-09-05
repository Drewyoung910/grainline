-- Audited Order post-payment projection candidate. This is not a migration.
-- It may be packaged only after the paid-order compatibility epoch proves that
-- every payable Checkout Session has a complete retained source snapshot.

CREATE OR REPLACE FUNCTION public.grainline_stripe_checkout_postpayment(
  p_event_id text,
  p_claim_generation bigint,
  p_session_id text
)
RETURNS TABLE(outcome text, order_id text, projection jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  source_buyer public."User"%ROWTYPE;
  source_seller public."SellerProfile"%ROWTYPE;
  source_seller_user public."User"%ROWTYPE;
  source_items jsonb;
  source_item_count bigint;
  is_first_legitimate_sale boolean;
BEGIN
  IF p_event_id IS NULL OR p_event_id = '' OR pg_catalog.length(p_event_id) > 255
     OR p_claim_generation IS NULL OR p_claim_generation <= 0
     OR p_session_id IS NULL OR p_session_id = '' OR pg_catalog.length(p_session_id) > 255 THEN
    RAISE EXCEPTION 'Checkout post-payment identity is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR source_event."sourceObjectId" IS DISTINCT FROM p_session_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout post-payment event authority is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT source.*
    INTO source_order
    FROM public."Order" AS source
   WHERE source."stripeSessionId" = p_session_id
   FOR SHARE;
  IF NOT FOUND OR source_order."paidAt" IS NULL THEN
    RAISE EXCEPTION 'Checkout post-payment Order is unavailable' USING ERRCODE = 'P0002';
  END IF;

  order_id := source_order.id;
  IF source_order."sellerRefundId" IS NOT NULL
     OR source_order."paymentRefundBlocked"
     OR (
       source_order."reviewNeeded"
       AND pg_catalog.strpos(
         COALESCE(source_order."reviewNote", ''),
         'Order was held for staff review.'
       ) > 0
     ) THEN
    outcome := 'blocked';
    projection := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF source_order."buyerId" IS NULL OR source_order."sellerProfileId" IS NULL THEN
    RAISE EXCEPTION 'Checkout post-payment participants are incomplete' USING ERRCODE = '23514';
  END IF;

  SELECT buyer.* INTO source_buyer
    FROM public."User" AS buyer
   WHERE buyer.id = source_order."buyerId";
  SELECT seller.* INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller.id = source_order."sellerProfileId";
  IF source_buyer.id IS NULL OR source_seller.id IS NULL THEN
    RAISE EXCEPTION 'Checkout post-payment participants are unavailable' USING ERRCODE = 'P0002';
  END IF;
  SELECT seller_user.* INTO source_seller_user
    FROM public."User" AS seller_user
   WHERE seller_user.id = source_seller."userId";
  IF source_seller_user.id IS NULL THEN
    RAISE EXCEPTION 'Checkout post-payment seller user is unavailable' USING ERRCODE = 'P0002';
  END IF;

  SELECT pg_catalog.count(*),
         pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'id', item.id,
             'listingId', item."listingId",
             'quantity', item.quantity,
             'priceCents', item."priceCents",
             'listingSnapshot', item."listingSnapshot",
             'currentStockQuantity', listing."stockQuantity"
           ) ORDER BY item.id
         )
    INTO source_item_count, source_items
    FROM public."OrderItem" AS item
    JOIN public."Listing" AS listing ON listing.id = item."listingId"
   WHERE item."orderId" = source_order.id;
  IF source_item_count < 1 OR source_item_count > 50
     OR source_items IS NULL
     OR EXISTS (
       SELECT 1
         FROM public."OrderItem" AS item
        WHERE item."orderId" = source_order.id
          AND (
            item."sellerProfileId" IS DISTINCT FROM source_seller.id
            OR item."listingSnapshot" IS NULL
            OR pg_catalog.jsonb_typeof(item."listingSnapshot") IS DISTINCT FROM 'object'
          )
     ) THEN
    RAISE EXCEPTION 'Checkout post-payment items are invalid' USING ERRCODE = '23514';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
      FROM public."Order" AS candidate
     WHERE candidate."sellerProfileId" = source_seller.id
       AND candidate."paidAt" IS NOT NULL
       AND candidate."sellerRefundId" IS NULL
       AND NOT candidate."paymentRefundBlocked"
       AND (
         NOT candidate."reviewNeeded"
         OR candidate."reviewNote" IS NULL
         OR pg_catalog.strpos(
           candidate."reviewNote",
           'Order was held for staff review.'
         ) = 0
       )
       AND (candidate."paidAt", candidate.id) < (source_order."paidAt", source_order.id)
  ) INTO is_first_legitimate_sale;

  outcome := 'ready';
  projection := pg_catalog.jsonb_build_object(
    'orderId', source_order.id,
    'buyerId', source_buyer.id,
    'buyerName', source_buyer.name,
    'buyerEmail', source_buyer.email,
    'sellerProfileId', source_seller.id,
    'sellerUserId', source_seller_user.id,
    'sellerDisplayName', source_seller."displayName",
    'sellerEmail', source_seller_user.email,
    'itemsSubtotalCents', source_order."itemsSubtotalCents",
    'shippingAmountCents', source_order."shippingAmountCents",
    'taxAmountCents', source_order."taxAmountCents",
    'giftWrapping', source_order."giftWrapping",
    'giftWrappingPriceCents', source_order."giftWrappingPriceCents",
    'currency', source_order.currency,
    'estimatedDeliveryDate', CASE
      WHEN source_order."estimatedDeliveryDate" IS NULL THEN NULL
      ELSE pg_catalog.to_char(
        source_order."estimatedDeliveryDate",
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    END,
    'processingDeadline', CASE
      WHEN source_order."processingDeadline" IS NULL THEN NULL
      ELSE pg_catalog.to_char(
        source_order."processingDeadline",
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    END,
    'shipToLine1', source_order."shipToLine1",
    'shipToCity', source_order."shipToCity",
    'shipToState', source_order."shipToState",
    'shipToPostalCode', source_order."shipToPostalCode",
    'isFirstLegitimateSale', is_first_legitimate_sale,
    'items', source_items
  );
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_postpayment(
  text, bigint, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_postpayment(
  text, bigint, text
) FROM grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stripe_checkout_postpayment(
  text, bigint, text
) TO grainline_app_runtime;
