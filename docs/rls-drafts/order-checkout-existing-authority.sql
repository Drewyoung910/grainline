-- Audited exact-session idempotency candidate. This is not a migration.

CREATE OR REPLACE FUNCTION public.grainline_stripe_checkout_order_existing(
  p_event_id text,
  p_claim_generation bigint,
  p_session_id text
)
RETURNS TABLE(
  outcome text,
  order_id text,
  retry_reason text,
  seller_user_ids text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  source_marker_position integer;
  source_retry_reason text;
  source_seller_user_id text;
  source_refund_lock_stale boolean;
BEGIN
  IF p_event_id IS NULL OR p_event_id = '' OR pg_catalog.length(p_event_id) > 255
     OR p_claim_generation IS NULL OR p_claim_generation <= 0
     OR p_session_id IS NULL OR p_session_id = '' OR pg_catalog.length(p_session_id) > 255 THEN
    RAISE EXCEPTION 'Checkout existing identity is invalid' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Checkout existing event authority is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT source.*
    INTO source_order
    FROM public."Order" AS source
   WHERE source."stripeSessionId" = p_session_id
   FOR SHARE;
  IF NOT FOUND THEN
    outcome := 'absent';
    order_id := NULL;
    retry_reason := NULL;
    seller_user_ids := ARRAY[]::text[];
    RETURN NEXT;
    RETURN;
  END IF;

  order_id := source_order.id;
  retry_reason := NULL;
  seller_user_ids := ARRAY[]::text[];
  source_marker_position := pg_catalog.strpos(
    COALESCE(source_order."reviewNote", ''),
    'Order was held for staff review.'
  );
  IF source_order."reviewNeeded" AND source_marker_position > 0 THEN
    source_retry_reason := NULLIF(
      pg_catalog.btrim(
        pg_catalog.substr(source_order."reviewNote", 1, source_marker_position - 1)
      ),
      ''
    );
  END IF;

  IF source_retry_reason IS NOT NULL AND NOT source_order."paymentRefundBlocked" THEN
    source_refund_lock_stale := source_order."sellerRefundId" = 'pending'
      AND (
        source_order."sellerRefundLockedAt" IS NULL
        OR source_order."sellerRefundLockedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
      );
    IF source_order."refundClaimId" IS NOT NULL THEN
      IF source_order."sellerRefundId" = 'pending'
         AND source_order."refundClaimSource" = 'BLOCKED_CHECKOUT'
         AND source_order."refundClaimSourceId" = p_event_id THEN
        outcome := 'retry';
      ELSE
        outcome := 'processing';
      END IF;
    ELSIF source_order."sellerRefundId" IS NULL OR source_refund_lock_stale THEN
      outcome := 'retry';
    ELSIF source_order."sellerRefundId" = 'pending' THEN
      outcome := 'processing';
    ELSE
      outcome := 'complete';
    END IF;
  ELSE
    outcome := 'complete';
  END IF;

  IF outcome = 'retry' THEN
    retry_reason := source_retry_reason;
    SELECT seller."userId"
      INTO source_seller_user_id
      FROM public."SellerProfile" AS seller
     WHERE seller.id = source_order."sellerProfileId";
    seller_user_ids := CASE
      WHEN source_seller_user_id IS NULL THEN ARRAY[]::text[]
      ELSE ARRAY[source_seller_user_id]
    END;
  END IF;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_order_existing(
  text, bigint, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_order_existing(
  text, bigint, text
) FROM grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stripe_checkout_order_existing(
  text, bigint, text
) TO grainline_app_runtime;
