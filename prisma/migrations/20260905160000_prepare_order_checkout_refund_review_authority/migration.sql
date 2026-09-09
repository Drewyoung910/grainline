-- Compatible blocked-checkout refund review authority.
-- The operation can update only the Order bound to an active signed Checkout
-- event generation and derives every persisted review message in PostgreSQL.

CREATE OR REPLACE FUNCTION public.grainline_stripe_checkout_refund_review(
  p_event_id text,
  p_claim_generation bigint,
  p_session_id text,
  p_order_id text,
  p_action text
)
RETURNS TABLE(outcome text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  source_marker_position integer;
  source_review_prefix text;
  source_has_refund boolean;
  source_has_open_dispute boolean;
  source_note text;
BEGIN
  IF p_event_id IS NULL OR p_event_id = '' OR pg_catalog.length(p_event_id) > 255
     OR p_claim_generation IS NULL OR p_claim_generation <= 0
     OR p_session_id IS NULL OR p_session_id = '' OR pg_catalog.length(p_session_id) > 255
     OR p_order_id IS NULL OR p_order_id = '' OR pg_catalog.length(p_order_id) > 191
     OR p_action IS NULL
     OR p_action NOT IN ('missing_payment_intent', 'claim_conflict', 'provider_failure') THEN
    RAISE EXCEPTION 'Checkout refund review identity is invalid' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Checkout refund review event authority is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT source.*
    INTO source_order
    FROM public."Order" AS source
   WHERE source.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND OR source_order."stripeSessionId" IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'Checkout refund review Order authority is invalid' USING ERRCODE = '42501';
  END IF;

  source_marker_position := pg_catalog.strpos(
    COALESCE(source_order."reviewNote", ''),
    'Order was held for staff review.'
  );
  IF NOT source_order."reviewNeeded" OR source_marker_position <= 0 THEN
    RAISE EXCEPTION 'Checkout refund review source state is invalid' USING ERRCODE = '42501';
  END IF;
  source_review_prefix := pg_catalog.btrim(pg_catalog.substr(
    source_order."reviewNote",
    1,
    source_marker_position + pg_catalog.length('Order was held for staff review.') - 1
  ));

  SELECT EXISTS (
    SELECT 1
      FROM public."OrderPaymentEvent" AS payment_event
     WHERE payment_event."orderId" = source_order.id
       AND payment_event."eventType" = 'REFUND'
       AND (
         payment_event.status IS NULL
         OR pg_catalog.lower(payment_event.status) NOT IN ('failed', 'canceled', 'cancelled')
       )
  ) INTO source_has_refund;
  source_has_refund := source_has_refund
    OR source_order."sellerRefundId" IS NOT NULL
    OR source_order."paymentRefundBlocked";

  SELECT EXISTS (
    SELECT 1
      FROM (
        SELECT DISTINCT ON (COALESCE(dispute_event."stripeObjectId", dispute_event.id))
               dispute_event.status
          FROM public."OrderPaymentEvent" AS dispute_event
         WHERE dispute_event."orderId" = source_order.id
           AND dispute_event."eventType" = 'DISPUTE'
         ORDER BY
           COALESCE(dispute_event."stripeObjectId", dispute_event.id),
           COALESCE(
             CASE
               WHEN dispute_event.metadata->>'stripeEventCreated' ~ '^[0-9]+$'
               THEN (dispute_event.metadata->>'stripeEventCreated')::bigint
               ELSE NULL
             END,
             EXTRACT(EPOCH FROM dispute_event."createdAt")::bigint
           ) DESC,
           dispute_event."createdAt" DESC,
           dispute_event.id DESC
      ) AS latest_dispute
     WHERE latest_dispute.status IS NULL
        OR pg_catalog.lower(latest_dispute.status)
          NOT IN ('won', 'lost', 'prevented', 'warning_closed')
  ) INTO source_has_open_dispute;
  source_has_open_dispute := source_has_open_dispute
    OR source_order."paymentOpenDisputeBlocked";

  IF p_action = 'missing_payment_intent' THEN
    IF source_order."stripePaymentIntentId" IS NOT NULL THEN
      RAISE EXCEPTION 'Checkout refund review payment identity drifted' USING ERRCODE = '42501';
    END IF;
    outcome := 'missing_payment_intent';
    source_note := source_review_prefix
      || ' Automatic refund could not be issued because the PaymentIntent ID was unavailable.';
  ELSIF p_action = 'claim_conflict' THEN
    IF source_has_refund THEN
      outcome := 'refund_exists';
      source_note := source_review_prefix
        || ' Automatic refund was skipped because another refund is already being processed or recorded for this order.';
    ELSIF source_has_open_dispute THEN
      outcome := 'open_dispute';
      source_note := source_review_prefix
        || ' Automatic refund was skipped because a Stripe dispute is still open; staff must reconcile this payment manually.';
    ELSE
      outcome := 'state_changed';
      source_note := source_review_prefix
        || ' Automatic refund was skipped because refund or dispute state changed while processing; staff must reconcile this payment manually.';
    END IF;
  ELSIF source_has_refund THEN
    outcome := 'refund_exists';
    source_note := source_review_prefix
      || ' Automatic refund was skipped because another refund is already being processed or recorded for this order.';
  ELSIF source_has_open_dispute THEN
    outcome := 'open_dispute';
    source_note := source_review_prefix
      || ' Automatic refund was skipped because a Stripe dispute is still open; staff must reconcile this payment manually.';
  ELSE
    outcome := 'provider_failure';
    source_note := source_review_prefix
      || ' Automatic refund failed; staff must reconcile this payment manually.';
  END IF;

  UPDATE public."Order" AS target
     SET "reviewNeeded" = true,
         "reviewNote" = pg_catalog.left(source_note, 10000)
   WHERE target.id = source_order.id
     AND target."stripeSessionId" = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout refund review update raced' USING ERRCODE = '40001';
  END IF;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_refund_review(
  text, bigint, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_refund_review(
  text, bigint, text, text, text
) FROM grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stripe_checkout_refund_review(
  text, bigint, text, text, text
) TO grainline_app_runtime;
