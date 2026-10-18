-- Audit #662: preserve the seller Case and alert when a signed Stripe
-- dispute event arrives before charge.dispute.created. A first nonterminal signed
-- observation now opens or reopens the Case. A terminal-first observation remains
-- ledger-only; only a later created delivery retains predecessor recovery behavior.
-- Event type is not provider state, so
-- it no longer makes otherwise identical same-second observations conflict.

BEGIN;

CREATE TEMP TABLE
  grainline_dispute_first_event_case_catalog_before
ON COMMIT DROP
AS
SELECT
  routine.oid,
  routine.proowner,
  routine.prosecdef,
  routine.provolatile,
  routine.proparallel,
  routine.proconfig,
  routine.proacl
FROM pg_catalog.pg_proc AS routine
WHERE routine.oid IN (
  pg_catalog.to_regprocedure('public.grainline_case_relationship_valid()'),
  pg_catalog.to_regprocedure('public.grainline_case_stripe_dispute_apply(text)'),
  pg_catalog.to_regprocedure(
    'public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)'
  ),
  pg_catalog.to_regprocedure(
    'public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)'
  )
);

DO $grainline_dispute_first_event_case_catalog_preflight$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
      FROM grainline_dispute_first_event_case_catalog_before
  ) <> 4 THEN
    RAISE EXCEPTION 'Dispute first-event predecessor catalog is incomplete';
  END IF;
END;
$grainline_dispute_first_event_case_catalog_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_case_relationship_valid()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_relationship_valid$
DECLARE
  order_buyer_id text;
  order_stripe_charge_id text;
  seller_count integer;
  only_seller_user_id text;
  dispute_event record;
BEGIN
  SELECT orders."buyerId", orders."stripeChargeId"
    INTO order_buyer_id, order_stripe_charge_id
    FROM public."Order" AS orders
   WHERE orders.id = NEW."orderId"
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  -- Lock every retained Order/seller relationship in a stable order before
  -- deriving the one exact seller. The outer aggregate cannot carry a row
  -- locking clause, so the non-aggregate inner query owns the locks.
  SELECT
    pg_catalog.count(DISTINCT locked_seller.seller_user_id)::integer,
    pg_catalog.min(locked_seller.seller_user_id)
    INTO seller_count, only_seller_user_id
    FROM (
      SELECT seller."userId" AS seller_user_id
        FROM public."OrderItem" AS item
        JOIN public."Listing" AS listing ON listing.id = item."listingId"
        JOIN public."SellerProfile" AS seller
          ON seller.id = listing."sellerId"
       WHERE item."orderId" = NEW."orderId"
       ORDER BY item.id, listing.id, seller.id
       FOR SHARE OF item, listing, seller
    ) AS locked_seller;

  IF seller_count <> 1
     OR NEW."sellerId" IS DISTINCT FROM only_seller_user_id
     OR (
       NEW."buyerId" IS NOT NULL
       AND NEW."buyerId" IS DISTINCT FROM order_buyer_id
     )
     OR (
       NEW."buyerId" IS NOT NULL
       AND NEW."buyerId" = NEW."sellerId"
     ) THEN
    RAISE EXCEPTION 'Case parties do not match one exact Order seller'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."openedByPaymentEventId" IS NOT NULL THEN
    SELECT
      event.id,
      event."eventType",
      event."stripeEventId",
      event."stripeObjectType",
      event."stripeObjectId",
      event.status,
      event.currency,
      event.metadata
      INTO dispute_event
      FROM public."OrderPaymentEvent" AS event
     WHERE event.id = NEW."openedByPaymentEventId"
       AND event."orderId" = NEW."orderId"
     FOR SHARE;
    IF NOT FOUND
       OR dispute_event."eventType" <> 'DISPUTE'
       OR dispute_event."stripeEventId" IS NULL
       OR pg_catalog.btrim(dispute_event."stripeEventId") = ''
       OR dispute_event."stripeObjectType" IS DISTINCT FROM 'dispute'
       OR dispute_event."stripeObjectId" IS NULL
       OR pg_catalog.btrim(dispute_event."stripeObjectId") = ''
       OR pg_catalog.jsonb_typeof(dispute_event.metadata) <> 'object'
       OR dispute_event.metadata->>'stripeEventType' IS NULL
       OR dispute_event.metadata->>'stripeEventType' NOT IN (
            'charge.dispute.created',
            'charge.dispute.updated',
            'charge.dispute.closed',
            'charge.dispute.funds_withdrawn',
            'charge.dispute.funds_reinstated'
          )
       OR dispute_event.metadata->>'orderingAction'
            IS DISTINCT FROM 'applied'
       OR (
         NOT EXISTS (
           SELECT 1
             FROM public."CaseStripeDisputeApplication" AS exact_application
            WHERE exact_application."paymentEventId"
                    = NEW."openedByPaymentEventId"
              AND exact_application."caseId" = NEW.id
              AND exact_application."orderId" = NEW."orderId"
              AND exact_application.action IN ('create', 'reopen')
         )
         AND EXISTS (
           SELECT 1
             FROM public."CaseStripeDisputeApplication" AS prior_application
             JOIN public."OrderPaymentEvent" AS applied_event
               ON applied_event.id = prior_application."paymentEventId"
            WHERE prior_application."orderId" = NEW."orderId"
              AND applied_event."orderId" = NEW."orderId"
              AND applied_event."eventType" = 'DISPUTE'
              AND applied_event."stripeObjectType" = 'dispute'
              AND applied_event."stripeObjectId"
                    IS NOT DISTINCT FROM dispute_event."stripeObjectId"
         )
       )
       OR order_stripe_charge_id IS NULL
       OR pg_catalog.btrim(order_stripe_charge_id) = ''
       OR dispute_event.metadata->>'chargeId'
            IS DISTINCT FROM order_stripe_charge_id
       OR dispute_event.metadata->>'disputeId'
            IS DISTINCT FROM dispute_event."stripeObjectId"
       OR dispute_event.metadata->>'stripeEventCreated' IS NULL
       OR dispute_event.metadata->>'stripeEventCreated'
            !~ '^[0-9]{1,12}$'
       OR pg_catalog.lower(COALESCE(dispute_event.status, '')) IN (
            'won',
            'lost',
            'prevented',
            'warning_closed'
          )
       OR dispute_event.currency !~ '^[a-z]{3}$'
       OR NEW.reason <> 'OTHER'::public."CaseReason" THEN
      RAISE EXCEPTION 'Case webhook opening source is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$grainline_case_relationship_valid$;

CREATE OR REPLACE FUNCTION public.grainline_case_stripe_dispute_apply(
  p_order_payment_event_id text
)
RETURNS TABLE (
  "caseId" text,
  "orderId" text,
  "sellerUserId" text,
  "buyerUserId" text,
  "paymentEventId" text,
  action text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_stripe_dispute_apply$
DECLARE
  source_order_id text;
  source_event record;
  latest_event record;
  locked_order record;
  existing_case record;
  existing_application record;
  seller_count integer;
  only_seller_user_id text;
  target_case_id text;
  target_action text;
  audit_id text;
  source_event_created bigint;
  transition_at timestamp(3);
  opening_description text;
BEGIN
  IF p_order_payment_event_id IS NULL
     OR pg_catalog.btrim(p_order_payment_event_id) = ''
     OR pg_catalog.char_length(p_order_payment_event_id) > 191 THEN
    RAISE EXCEPTION 'Case Stripe dispute source id is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- The source row reveals only the Order identity needed to acquire the
  -- canonical Order lock. Re-read and lock the source after the Order lock so
  -- a mutable predecessor cannot switch the relationship between reads.
  SELECT payment_event."orderId"
    INTO source_order_id
    FROM public."OrderPaymentEvent" AS payment_event
   WHERE payment_event.id = p_order_payment_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case Stripe dispute source does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."buyerId",
    orders."stripeChargeId"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case Stripe dispute Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    payment_event.id,
    payment_event."orderId",
    payment_event."stripeEventId",
    payment_event."stripeObjectId",
    payment_event."stripeObjectType",
    payment_event."eventType",
    payment_event.currency,
    payment_event.status,
    payment_event.reason,
    payment_event.description,
    payment_event.metadata
    INTO source_event
    FROM public."OrderPaymentEvent" AS payment_event
   WHERE payment_event.id = p_order_payment_event_id
     AND payment_event."orderId" = locked_order.id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case Stripe dispute source changed Order'
      USING ERRCODE = '40001';
  END IF;

  IF source_event."eventType" <> 'DISPUTE'
     OR source_event."stripeObjectType" IS DISTINCT FROM 'dispute'
     OR source_event."stripeEventId" IS NULL
     OR pg_catalog.btrim(source_event."stripeEventId") = ''
     OR source_event."stripeObjectId" IS NULL
     OR pg_catalog.btrim(source_event."stripeObjectId") = ''
     OR pg_catalog.jsonb_typeof(source_event.metadata) <> 'object'
     OR source_event.metadata->>'stripeEventType' IS NULL
     OR source_event.metadata->>'stripeEventType' NOT IN (
          'charge.dispute.created',
          'charge.dispute.updated',
          'charge.dispute.closed',
          'charge.dispute.funds_withdrawn',
          'charge.dispute.funds_reinstated'
        )
     OR source_event.metadata->>'orderingAction'
          IS DISTINCT FROM 'applied'
     OR (
       NOT EXISTS (
         SELECT 1
           FROM public."CaseStripeDisputeApplication" AS exact_application
          WHERE exact_application."paymentEventId" = source_event.id
            AND exact_application."orderId" = locked_order.id
            AND exact_application.action IN ('create', 'reopen')
       )
       AND EXISTS (
         SELECT 1
           FROM public."CaseStripeDisputeApplication" AS prior_application
           JOIN public."OrderPaymentEvent" AS applied_event
             ON applied_event.id = prior_application."paymentEventId"
          WHERE prior_application."orderId" = locked_order.id
            AND applied_event."orderId" = locked_order.id
            AND applied_event."eventType" = 'DISPUTE'
            AND applied_event."stripeObjectType" = 'dispute'
            AND applied_event."stripeObjectId"
                  IS NOT DISTINCT FROM source_event."stripeObjectId"
       )
     )
     OR source_event.metadata->>'chargeId'
          IS DISTINCT FROM locked_order."stripeChargeId"
     OR source_event.metadata->>'disputeId'
          IS DISTINCT FROM source_event."stripeObjectId"
     OR source_event.metadata->>'stripeEventCreated' IS NULL
     OR source_event.metadata->>'stripeEventCreated'
          !~ '^[0-9]{1,12}$'
     OR pg_catalog.lower(COALESCE(source_event.status, '')) IN (
          'won',
          'lost',
          'prevented',
          'warning_closed'
        )
     OR source_event.currency !~ '^[a-z]{3}$' THEN
    RAISE EXCEPTION 'Case Stripe dispute source is invalid'
      USING ERRCODE = '23514';
  END IF;

  source_event_created :=
    (source_event.metadata->>'stripeEventCreated')::bigint;

  -- Preserve the webhook handler's event-time ordering inside the authority
  -- boundary. A valid but older charge.dispute.created event must not reopen
  -- a Case after a newer update or terminal dispute event has been recorded.
  SELECT
    payment_event.id,
    payment_event.status,
    (payment_event.metadata->>'stripeEventCreated')::bigint
      AS stripe_event_created
    INTO latest_event
    FROM public."OrderPaymentEvent" AS payment_event
   WHERE payment_event."orderId" = locked_order.id
     AND payment_event."eventType" = 'DISPUTE'
     AND payment_event."stripeObjectType" = 'dispute'
     AND payment_event."stripeObjectId" = source_event."stripeObjectId"
     AND pg_catalog.jsonb_typeof(payment_event.metadata) = 'object'
     AND payment_event.metadata->>'chargeId'
          IS NOT DISTINCT FROM locked_order."stripeChargeId"
     AND payment_event.metadata->>'disputeId'
          IS NOT DISTINCT FROM source_event."stripeObjectId"
     AND payment_event.metadata->>'stripeEventCreated'
          ~ '^[0-9]{1,12}$'
   ORDER BY
     (payment_event.metadata->>'stripeEventCreated')::bigint DESC,
     CASE
       WHEN pg_catalog.lower(COALESCE(payment_event.status, '')) IN (
         'won',
         'lost',
         'prevented',
         'warning_closed'
       )
       THEN 1
       ELSE 0
     END DESC,
     payment_event."createdAt" DESC,
     payment_event.id DESC
   LIMIT 1
   FOR SHARE;

  IF locked_order."buyerId" IS NULL
     OR locked_order."stripeChargeId" IS NULL
     OR pg_catalog.btrim(locked_order."stripeChargeId") = '' THEN
    RAISE EXCEPTION 'Case Stripe dispute Order lacks retained authority'
      USING ERRCODE = '23514';
  END IF;

  -- Lock the complete retained Order/seller relationship in a stable order
  -- before deriving the one exact seller.
  SELECT
    pg_catalog.count(DISTINCT locked_seller.seller_user_id)::integer,
    pg_catalog.min(locked_seller.seller_user_id)
    INTO seller_count, only_seller_user_id
    FROM (
      SELECT seller."userId" AS seller_user_id
        FROM public."OrderItem" AS item
        JOIN public."Listing" AS listing ON listing.id = item."listingId"
        JOIN public."SellerProfile" AS seller
          ON seller.id = listing."sellerId"
       WHERE item."orderId" = locked_order.id
       ORDER BY item.id, listing.id, seller.id
       FOR SHARE OF item, listing, seller
    ) AS locked_seller;

  IF seller_count <> 1
     OR only_seller_user_id IS NULL
     OR locked_order."buyerId" = only_seller_user_id THEN
    RAISE EXCEPTION 'Case Stripe dispute Order has invalid participants'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    case_row.id,
    case_row.status
    INTO existing_case
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = locked_order.id
   FOR UPDATE;

  IF FOUND THEN
    target_case_id := existing_case.id;
    target_action := 'reopen';
  ELSE
    target_case_id := pg_catalog.gen_random_uuid()::text;
    target_action := 'create';
  END IF;

  SELECT
    application."caseId",
    application."orderId",
    application.action
    INTO existing_application
    FROM public."CaseStripeDisputeApplication" AS application
   WHERE application."paymentEventId" = source_event.id
   FOR SHARE;

  IF FOUND THEN
    IF existing_application."caseId" IS DISTINCT FROM target_case_id
       OR existing_application."orderId" IS DISTINCT FROM locked_order.id
       OR existing_application.action NOT IN ('create', 'reopen') THEN
      RAISE EXCEPTION 'Case Stripe dispute replay authority is invalid'
        USING ERRCODE = '23514';
    END IF;

    RETURN QUERY SELECT
      existing_application."caseId"::text,
      existing_application."orderId"::text,
      only_seller_user_id,
      locked_order."buyerId"::text,
      source_event.id::text,
      'replay'::text;
    RETURN;
  END IF;

  IF latest_event.stripe_event_created > source_event_created
     OR (
       latest_event.stripe_event_created = source_event_created
       AND pg_catalog.lower(COALESCE(latest_event.status, '')) IN (
         'won',
         'lost',
         'prevented',
         'warning_closed'
       )
     ) THEN
    RAISE EXCEPTION 'Case Stripe dispute source is superseded'
      USING ERRCODE = '23514';
  END IF;

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
  opening_description := pg_catalog.left(
    'Stripe payment dispute '
      || source_event."stripeObjectId"
      || CASE
           WHEN source_event.reason IS NULL
             OR pg_catalog.btrim(source_event.reason) = ''
           THEN ''
           ELSE ': ' || source_event.reason
         END,
    5000
  );

  IF target_action = 'create' THEN
    INSERT INTO public."Case" (
      id,
      "orderId",
      "buyerId",
      "sellerId",
      reason,
      description,
      status,
      "sellerRespondBy",
      "openedByPaymentEventId",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      target_case_id,
      locked_order.id,
      locked_order."buyerId",
      only_seller_user_id,
      'OTHER'::public."CaseReason",
      opening_description,
      'UNDER_REVIEW'::public."CaseStatus",
      transition_at + INTERVAL '48 hours',
      source_event.id,
      transition_at,
      transition_at
    );
  ELSE
    UPDATE public."Case" AS case_row
       SET status = 'UNDER_REVIEW'::public."CaseStatus",
           resolution = NULL,
           "refundAmountCents" = NULL,
           "stripeRefundId" = NULL,
           "resolvedAt" = NULL,
           "resolvedById" = NULL,
           "buyerMarkedResolved" = false,
           "sellerMarkedResolved" = false,
           "updatedAt" = transition_at
     WHERE case_row.id = target_case_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case Stripe dispute target disappeared'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  INSERT INTO public."CaseStripeDisputeApplication" (
    "paymentEventId",
    "caseId",
    "orderId",
    action,
    "createdAt"
  )
  VALUES (
    source_event.id,
    target_case_id,
    locked_order.id,
    target_action,
    transition_at
  );

  audit_id :=
    'case-stripe-dispute-audit:' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."SystemAuditLog" (
    id,
    "actorType",
    "actorId",
    action,
    "targetType",
    "targetId",
    reason,
    metadata,
    "createdAt"
  )
  VALUES (
    audit_id,
    'webhook',
    source_event."stripeEventId",
    'CASE_STRIPE_DISPUTE_APPLIED',
    'CASE',
    target_case_id,
    source_event.reason,
    pg_catalog.jsonb_build_object(
      'orderPaymentEventId', source_event.id,
      'orderId', locked_order.id,
      'stripeEventId', source_event."stripeEventId",
      'stripeDisputeId', source_event."stripeObjectId",
      'caseAction', target_action
    ),
    transition_at
  );

  RETURN QUERY SELECT
    target_case_id,
    locked_order.id::text,
    only_seller_user_id,
    locked_order."buyerId"::text,
    source_event.id::text,
    target_action;
END
$grainline_case_stripe_dispute_apply$;

CREATE OR REPLACE FUNCTION public.grainline_order_payment_signed_dispute_apply(
  p_event_id text,
  p_claim_generation bigint,
  p_charge_id text,
  p_dispute_id text,
  p_event_created_seconds bigint,
  p_amount_cents integer,
  p_currency text,
  p_reason text,
  p_status text
)
RETURNS TABLE (
  action text,
  "paymentEventId" text,
  "orderId" text,
  "sellerUserId" text,
  "buyerUserId" text,
  "caseId" text,
  "caseAction" text,
  "notificationAuthorized" boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_signed_dispute_apply$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  source_seller_user_id text;
  existing_payment public."OrderPaymentEvent"%ROWTYPE;
  latest_payment record;
  case_result record;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  source_now_seconds bigint :=
    pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::bigint;
  payment_event_id text;
  normalized_currency text := pg_catalog.lower(pg_catalog.btrim(p_currency));
  normalized_reason text := NULLIF(pg_catalog.btrim(p_reason), '');
  normalized_status text := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_status)), '');
  event_description text;
  event_metadata jsonb;
  result_action text;
  should_apply boolean := false;
  is_first_dispute_event boolean := false;
  is_terminal boolean;
  case_id text;
  case_action text;
  notification_authorized boolean := false;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_charge_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_charge_id)) NOT BETWEEN 1 AND 255
     OR p_dispute_id IS NULL
     OR p_dispute_id !~ '^du_[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_dispute_id) > 220
     OR p_event_created_seconds IS NULL
     OR p_event_created_seconds < source_now_seconds - (31 * 24 * 60 * 60)
     OR p_event_created_seconds > source_now_seconds + (10 * 60)
     OR p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_currency IS NULL OR normalized_currency !~ '^[a-z]{3}$'
     OR (p_reason IS NOT NULL AND pg_catalog.char_length(p_reason) > 255)
     OR normalized_status IS NULL
     OR pg_catalog.char_length(normalized_status) > 100 THEN
    RAISE EXCEPTION 'Signed dispute input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type NOT IN (
       'charge.dispute.created',
       'charge.dispute.updated',
       'charge.dispute.closed',
       'charge.dispute.funds_withdrawn',
       'charge.dispute.funds_reinstated'
     )
     OR source_event."sourceObjectId" IS DISTINCT FROM p_dispute_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Signed dispute source lease is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(p_charge_id));

  SELECT orders.*
    INTO source_order
    FROM public."Order" AS orders
   WHERE orders."stripeChargeId" = p_charge_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_order."buyerId" IS NULL
     OR source_order."sellerProfileId" IS NULL
     OR source_order.currency IS NULL
     OR pg_catalog.lower(source_order.currency) IS DISTINCT FROM normalized_currency THEN
    RAISE EXCEPTION 'Signed dispute Order source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT seller."userId"
    INTO source_seller_user_id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = source_order."sellerProfileId"
   FOR SHARE;
  IF NOT FOUND
     OR source_seller_user_id IS NULL
     OR source_seller_user_id = source_order."buyerId" THEN
    RAISE EXCEPTION 'Signed dispute participant source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_dispute_id, 824030003)
  );

  SELECT payment.*
    INTO existing_payment
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."stripeEventId" = p_event_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_payment."orderId" IS DISTINCT FROM source_order.id
       OR existing_payment."stripeObjectId" IS DISTINCT FROM p_dispute_id
       OR existing_payment."stripeObjectType" IS DISTINCT FROM 'dispute'
       OR existing_payment."eventType" IS DISTINCT FROM 'DISPUTE'
       OR existing_payment."amountCents" IS DISTINCT FROM p_amount_cents
       OR existing_payment.currency IS DISTINCT FROM normalized_currency
       OR existing_payment.status IS DISTINCT FROM normalized_status
       OR existing_payment.reason IS DISTINCT FROM normalized_reason
       OR existing_payment."stripeEventCreatedSeconds"
            IS DISTINCT FROM p_event_created_seconds
       OR existing_payment.metadata->>'chargeId' IS DISTINCT FROM p_charge_id
       OR existing_payment.metadata->>'disputeId' IS DISTINCT FROM p_dispute_id
       OR existing_payment.metadata->>'stripeEventType'
            IS DISTINCT FROM source_event.type
       OR existing_payment.metadata->>'stripeEventCreated'
            IS DISTINCT FROM p_event_created_seconds::text THEN
      RAISE EXCEPTION 'Signed dispute replay payload is inconsistent'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY SELECT
      'replay'::text,
      existing_payment.id::text,
      source_order.id::text,
      source_seller_user_id,
      source_order."buyerId"::text,
      NULL::text,
      NULL::text,
      false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."OrderPaymentEvent" AS legacy_payment
     WHERE legacy_payment."orderId" = source_order.id
       AND legacy_payment."eventType" = 'DISPUTE'
       AND legacy_payment."stripeObjectId" = p_dispute_id
       AND legacy_payment."stripeEventCreatedSeconds" IS NULL
       AND (
         pg_catalog.jsonb_typeof(legacy_payment.metadata) IS DISTINCT FROM 'object'
         OR legacy_payment.metadata->>'stripeEventCreated' IS NULL
         OR legacy_payment.metadata->>'stripeEventCreated' !~ '^[0-9]{1,12}$'
       )
  ) THEN
    RAISE EXCEPTION 'Signed dispute legacy ordering requires reconciliation'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT
    payment."stripeEventId",
    payment."amountCents",
    payment.currency,
    payment.status,
    payment.reason,
    payment.metadata->>'stripeEventType' AS stripe_event_type,
    COALESCE(
      payment."stripeEventCreatedSeconds",
      CASE
        WHEN payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
        THEN (payment.metadata->>'stripeEventCreated')::bigint
        ELSE NULL
      END
    ) AS stripe_event_created
    INTO latest_payment
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."orderId" = source_order.id
     AND payment."eventType" = 'DISPUTE'
     AND payment."stripeObjectType" = 'dispute'
     AND payment."stripeObjectId" = p_dispute_id
   ORDER BY
     COALESCE(
       payment."stripeEventCreatedSeconds",
       CASE
         WHEN payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
         THEN (payment.metadata->>'stripeEventCreated')::bigint
         ELSE NULL
       END
     ) DESC NULLS LAST,
     payment.id DESC
   LIMIT 1
   FOR SHARE;

  IF NOT FOUND THEN
    result_action := 'applied';
    should_apply := true;
    is_first_dispute_event := true;
  ELSIF p_event_created_seconds > latest_payment.stripe_event_created THEN
    result_action := 'applied';
    should_apply := true;
  ELSIF p_event_created_seconds < latest_payment.stripe_event_created THEN
    result_action := 'stale_recorded';
  ELSIF EXISTS (
    SELECT 1
      FROM public."OrderPaymentEvent" AS equal_payment
     WHERE equal_payment."orderId" = source_order.id
       AND equal_payment."eventType" = 'DISPUTE'
       AND equal_payment."stripeObjectType" = 'dispute'
       AND equal_payment."stripeObjectId" = p_dispute_id
       AND COALESCE(
             equal_payment."stripeEventCreatedSeconds",
             CASE
               WHEN equal_payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
               THEN (equal_payment.metadata->>'stripeEventCreated')::bigint
               ELSE NULL
             END
           ) = p_event_created_seconds
       AND (
         equal_payment."amountCents" IS DISTINCT FROM p_amount_cents
         OR equal_payment.currency IS DISTINCT FROM normalized_currency
         OR equal_payment.status IS DISTINCT FROM normalized_status
         OR equal_payment.reason IS DISTINCT FROM normalized_reason
       )
  ) THEN
    result_action := 'conflict_recorded';
  ELSE
    result_action := 'same_second_recorded';
  END IF;

  event_description := pg_catalog.left(
    'Stripe dispute '
      || source_event.type
      || CASE
           WHEN normalized_reason IS NULL THEN ''
           ELSE ': ' || normalized_reason
         END,
    5000
  );
  event_metadata := pg_catalog.jsonb_build_object(
    'chargeId', p_charge_id,
    'disputeId', p_dispute_id,
    'stripeEventType', source_event.type,
    'stripeEventCreated', p_event_created_seconds,
    'orderingAction', result_action
  );

  payment_event_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."OrderPaymentEvent" (
    id,
    "orderId",
    "stripeEventId",
    "stripeObjectId",
    "stripeObjectType",
    "eventType",
    "amountCents",
    currency,
    status,
    reason,
    description,
    metadata,
    "stripeEventCreatedSeconds",
    "createdAt",
    "updatedAt"
  ) VALUES (
    payment_event_id,
    source_order.id,
    p_event_id,
    p_dispute_id,
    'dispute',
    'DISPUTE',
    p_amount_cents,
    normalized_currency,
    normalized_status,
    normalized_reason,
    event_description,
    event_metadata,
    p_event_created_seconds,
    source_now,
    source_now
  );

  is_terminal := normalized_status IN (
    'won',
    'lost',
    'prevented',
    'warning_closed'
  );
  IF result_action = 'conflict_recorded' THEN
    UPDATE public."Order" AS orders
       SET "reviewNeeded" = true,
           "reviewNote" =
             'Stripe reported conflicting dispute states at the same provider second; staff must reconcile before further automated dispute actions.'
     WHERE orders.id = source_order.id;
  ELSIF should_apply THEN
    UPDATE public."Order" AS orders
       SET "reviewNeeded" = true,
           "reviewNote" = event_description,
           "sellerRefundLockedAt" = CASE
             WHEN is_terminal
              AND orders."sellerRefundId" = 'pending'
              AND orders."refundClaimId" IS NULL
              AND orders."caseResolutionClaimId" IS NULL
              AND (
                orders."sellerRefundLockedAt" IS NULL
                OR orders."sellerRefundLockedAt" < source_now - INTERVAL '15 minutes'
              )
             THEN NULL
             ELSE orders."sellerRefundLockedAt"
           END
     WHERE orders.id = source_order.id;

    IF (
         source_event.type = 'charge.dispute.created'
         OR (is_first_dispute_event AND NOT is_terminal)
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public."CaseStripeDisputeApplication" AS prior_application
           JOIN public."OrderPaymentEvent" AS applied_event
             ON applied_event.id = prior_application."paymentEventId"
          WHERE prior_application."orderId" = source_order.id
            AND applied_event."orderId" = source_order.id
            AND applied_event."eventType" = 'DISPUTE'
            AND applied_event."stripeObjectType" = 'dispute'
            AND applied_event."stripeObjectId" = p_dispute_id
       ) THEN
      SELECT application.*
        INTO case_result
        FROM public.grainline_case_stripe_dispute_apply(payment_event_id)
          AS application;
      IF NOT FOUND
         OR case_result."orderId" IS DISTINCT FROM source_order.id
         OR case_result."sellerUserId" IS DISTINCT FROM source_seller_user_id
         OR case_result."buyerUserId" IS DISTINCT FROM source_order."buyerId"
         OR case_result."paymentEventId" IS DISTINCT FROM payment_event_id
         OR case_result.action NOT IN ('create', 'reopen', 'replay') THEN
        RAISE EXCEPTION 'Signed dispute Case result is invalid'
          USING ERRCODE = 'check_violation';
      END IF;
      case_id := case_result."caseId";
      case_action := case_result.action;
      notification_authorized := case_result.action IN ('create', 'reopen');
    END IF;
  END IF;

  INSERT INTO public."SystemAuditLog" (
    id,
    "actorType",
    "actorId",
    action,
    "targetType",
    "targetId",
    reason,
    metadata,
    "createdAt"
  ) VALUES (
    'signed-dispute-audit:' || pg_catalog.gen_random_uuid()::text,
    'webhook',
    p_event_id,
    'STRIPE_DISPUTE_RECORDED',
    'ORDER',
    source_order.id,
    normalized_reason,
    pg_catalog.jsonb_build_object(
      'orderPaymentEventId', payment_event_id,
      'stripeEventType', source_event.type,
      'stripeChargeId', p_charge_id,
      'stripeDisputeId', p_dispute_id,
      'amountCents', p_amount_cents,
      'currency', normalized_currency,
      'status', normalized_status,
      'caseAction', COALESCE(case_action, 'none'),
      'hasOrderUpdate', should_apply OR result_action = 'conflict_recorded',
      'disputeSideEffectsApplied', should_apply,
      'orderingAction', result_action,
      'latestRecordedStripeEventId', latest_payment."stripeEventId",
      'latestRecordedStripeEventCreated', latest_payment.stripe_event_created
    ),
    source_now
  );

  RETURN QUERY SELECT
    result_action,
    payment_event_id,
    source_order.id::text,
    source_seller_user_id,
    source_order."buyerId"::text,
    case_id,
    case_action,
    notification_authorized;
END
$grainline_order_payment_signed_dispute_apply$;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_core(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
  p_source_type text,
  p_source_id text,
  p_related_user_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_create_core$
DECLARE
  recipient_preferences jsonb;
  notification_id text;
  notification_title text;
  notification_body text;
  notification_link text;
  notification_dedup_key text;
  replay_material text;
BEGIN
  -- The block/source lifecycle protocol depends on each statement observing a
  -- fresh snapshot after a conflicting row lock waits. Reject stale-snapshot
  -- isolation rather than letting a caller weaken those absence checks.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'notification creation requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;

  IF p_notification_id IS NULL
     OR p_notification_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'notification id is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191 THEN
    RAISE EXCEPTION 'notification recipient is invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_source_type IS NULL) <> (p_source_id IS NULL) THEN
    RAISE EXCEPTION 'notification source metadata must be paired' USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS NOT NULL AND (
    p_source_type NOT IN (
      'blog_comment',
      'case',
      'case_message',
      'case_resolution_mark',
      'case_system_action',
      'commission_interest',
      'commission_request',
      'checkout_low_stock',
      'manual_low_stock',
      'guild_admin_action',
      'guild_system_action',
      'listing_admin_review',
      'listing_user_report',
      'admin_account_message',
      'banned_seller_order',
      'order_checkout',
      'order_fulfillment',
      'order_payment',
      'stripe_payout_failure',
      'favorite',
      'followed_maker_new_blog',
      'followed_maker_new_listing',
      'follow',
      'message',
      'review',
      'seller_broadcast'
    )
    OR pg_catalog.char_length(p_source_type) > 80
    OR p_source_id = ''
    OR pg_catalog.char_length(p_source_id) > 191
  ) THEN
    RAISE EXCEPTION 'notification source metadata is invalid' USING ERRCODE = '22023';
  END IF;

  -- The predecessor application mislabeled blocked-checkout refunds as
  -- NEW_ORDER. Normalize that one legacy input before recipient preferences,
  -- replay identity and storage so an old/new deployment retry cannot create
  -- two rows for one durable refund source. The order_payment source branch
  -- below still proves that only BLOCKED_CHECKOUT_REFUND_RECORDED can use it.
  IF p_source_type = 'order_payment'
     AND p_type = 'NEW_ORDER'::public."NotificationType" THEN
    p_type := 'REFUND_ISSUED'::public."NotificationType";
  END IF;

  IF p_type IS NULL OR (p_source_type = 'blog_comment'
      AND p_type NOT IN ('NEW_BLOG_COMMENT', 'BLOG_COMMENT_REPLY'))
     OR (p_source_type = 'case'
         AND p_type NOT IN ('CASE_OPENED', 'CASE_RESOLVED', 'REFUND_ISSUED'))
     OR (p_source_type = 'case_message'
         AND p_type <> 'CASE_MESSAGE')
     OR (p_source_type IN ('case_resolution_mark', 'case_system_action')
         AND p_type NOT IN ('CASE_MESSAGE', 'CASE_RESOLVED'))
     OR (p_source_type IN ('commission_interest', 'commission_request')
         AND p_type <> 'COMMISSION_INTEREST')
     OR (p_source_type = 'checkout_low_stock'
         AND p_type <> 'LOW_STOCK')
     OR (p_source_type = 'manual_low_stock'
         AND p_type <> 'LOW_STOCK')
     OR (p_source_type IN ('guild_admin_action', 'guild_system_action')
         AND p_type NOT IN ('VERIFICATION_APPROVED', 'VERIFICATION_REJECTED'))
     OR (p_source_type = 'listing_admin_review'
         AND p_type NOT IN ('LISTING_APPROVED', 'LISTING_REJECTED'))
     OR (p_source_type = 'listing_user_report'
         AND p_type <> 'LISTING_FLAGGED_BY_USER')
     OR (p_source_type IN ('admin_account_message', 'banned_seller_order')
         AND p_type <> 'ACCOUNT_WARNING')
     OR (p_source_type = 'order_checkout'
         AND p_type <> 'NEW_ORDER')
     OR (p_source_type = 'order_fulfillment'
         AND p_type NOT IN ('ORDER_SHIPPED', 'ORDER_DELIVERED'))
     OR (p_source_type = 'order_payment'
         AND p_type NOT IN ('NEW_ORDER', 'REFUND_ISSUED', 'PAYMENT_DISPUTE'))
     OR (p_source_type = 'stripe_payout_failure'
         AND p_type <> 'PAYOUT_FAILED')
     OR (p_source_type = 'favorite'
         AND p_type <> 'NEW_FAVORITE')
     OR (p_source_type = 'followed_maker_new_blog'
         AND p_type <> 'FOLLOWED_MAKER_NEW_BLOG')
     OR (p_source_type = 'followed_maker_new_listing'
         AND p_type <> 'FOLLOWED_MAKER_NEW_LISTING')
     OR (p_source_type = 'follow'
         AND p_type <> 'NEW_FOLLOWER')
     OR (p_source_type = 'message'
         AND p_type NOT IN ('NEW_MESSAGE', 'CUSTOM_ORDER_REQUEST', 'CUSTOM_ORDER_LINK'))
     OR (p_source_type = 'review'
         AND p_type <> 'NEW_REVIEW')
     OR (p_source_type = 'seller_broadcast'
         AND p_type <> 'SELLER_BROADCAST') THEN
    RAISE EXCEPTION 'notification source does not match notification type' USING ERRCODE = '22023';
  END IF;
  IF p_related_user_id IS NOT NULL AND (
    p_related_user_id = '' OR pg_catalog.char_length(p_related_user_id) > 191
  ) THEN
    RAISE EXCEPTION 'notification related user is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS NOT NULL
     AND p_source_type NOT IN (
       'case_system_action',
       'commission_request',
       'checkout_low_stock',
       'manual_low_stock',
       'guild_admin_action',
       'guild_system_action',
       'listing_admin_review',
       'admin_account_message',
       'order_payment',
       'stripe_payout_failure'
     )
     AND (p_related_user_id IS NULL OR p_related_user_id = p_user_id) THEN
    RAISE EXCEPTION 'notification source requires a distinct related user' USING ERRCODE = '22023';
  END IF;

  -- Block and unblock writers take FOR UPDATE on this same sorted User pair.
  -- These compatible FOR SHARE locks serialize the later reciprocal Block
  -- absence checks without deadlocking reverse-direction notification work.
  -- Account deletion also takes a conflicting User lock before notification
  -- cleanup, so its existing lifecycle ordering participates in the protocol.
  PERFORM 1
    FROM public."User" AS notification_user_lock
   WHERE notification_user_lock.id = p_user_id
      OR (
        p_related_user_id IS NOT NULL
        AND p_related_user_id <> p_user_id
        AND p_source_type IS DISTINCT FROM 'banned_seller_order'
        AND notification_user_lock.id = p_related_user_id
      )
   ORDER BY notification_user_lock.id
   FOR SHARE;

  SELECT recipient."notificationPreferences"
    INTO recipient_preferences
    FROM public."User" AS recipient
   WHERE recipient.id = p_user_id
     AND recipient.banned = false
     AND recipient."deletedAt" IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF recipient_preferences -> (p_type::text) = 'false'::jsonb THEN
    RETURN NULL;
  END IF;

  IF p_related_user_id IS NOT NULL
     AND p_related_user_id <> p_user_id
     AND p_source_type <> 'banned_seller_order' THEN
    PERFORM 1
      FROM public."User" AS related_user
     WHERE related_user.id = p_related_user_id
       AND related_user.banned = false
       AND related_user."deletedAt" IS NULL;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Social/content/message/commission notifications honor reciprocal blocks
  -- inside the owner operation. Case, order, payment, inventory, moderation,
  -- and account-safety notices are intentionally excluded because blocking
  -- must not hide transactional, dispute, or safety state.
  IF p_related_user_id IS NOT NULL
     AND p_related_user_id <> p_user_id
     AND p_source_type IN (
       'blog_comment',
       'commission_interest',
       'commission_request',
       'favorite',
       'follow',
       'followed_maker_new_blog',
       'followed_maker_new_listing',
       'message',
       'review',
       'seller_broadcast'
     )
     AND EXISTS (
       SELECT 1
         FROM public."Block" AS source_block
        WHERE (source_block."blockerId" = p_user_id
               AND source_block."blockedId" = p_related_user_id)
           OR (source_block."blockerId" = p_related_user_id
               AND source_block."blockedId" = p_user_id)
     ) THEN
    RETURN NULL;
  END IF;

  -- Source-tagged operations must prove the domain object, actor, recipient,
  -- and public/follower relationship in the same owner-backed operation. The
  -- row locks serialize source deletion or visibility changes with creation.
  IF p_source_type = 'blog_comment' THEN
    -- PostgreSQL cannot lock the nullable side of the LEFT JOIN below. Lock a
    -- reply and its parent explicitly first so parent deletion/SetNull cannot
    -- invalidate the recipient relationship between validation and insert.
    IF p_type = 'BLOG_COMMENT_REPLY' THEN
      PERFORM 1
        FROM public."BlogComment" AS reply_comment
        JOIN public."BlogComment" AS reply_parent
          ON reply_parent.id = reply_comment."parentId"
       WHERE reply_comment.id = p_source_id
         AND reply_comment.approved = true
         AND reply_comment."authorId" = p_related_user_id
         AND reply_parent."authorId" = p_user_id
       FOR SHARE OF reply_comment, reply_parent;
      IF NOT FOUND THEN
        RETURN NULL;
      END IF;
    END IF;

    SELECT
      '/blog/' || source_post.slug || '#comment-' || source_comment.id,
      pg_catalog.left(
        COALESCE(NULLIF(source_author.name, ''), 'Someone')
        || CASE
          WHEN p_type = 'BLOG_COMMENT_REPLY' THEN ' replied to your comment'
          ELSE ' commented on your post'
        END,
        200
      ),
      pg_catalog.left(source_comment.body, 60)
      INTO notification_link, notification_title, notification_body
      FROM public."BlogComment" AS source_comment
      JOIN public."BlogPost" AS source_post
        ON source_post.id = source_comment."postId"
      JOIN public."User" AS source_author
        ON source_author.id = source_comment."authorId"
      LEFT JOIN public."BlogComment" AS parent_comment
        ON parent_comment.id = source_comment."parentId"
     WHERE source_comment.id = p_source_id
       AND source_comment.approved = true
       AND source_comment."authorId" = p_related_user_id
       AND (
         (p_type = 'BLOG_COMMENT_REPLY'
          AND source_comment."parentId" IS NOT NULL
          AND parent_comment."authorId" = p_user_id)
         OR
         (p_type = 'NEW_BLOG_COMMENT'
          AND source_comment."parentId" IS NULL
          AND source_post."authorId" = p_user_id)
       )
     FOR SHARE OF source_comment, source_post, source_author;
  ELSIF p_source_type = 'case' THEN
    SELECT
      CASE
        WHEN p_user_id = source_case."buyerId"
          THEN '/dashboard/orders/' || source_case."orderId"
        ELSE '/dashboard/sales/' || source_case."orderId"
      END,
      CASE
        WHEN p_type = 'CASE_OPENED'
          THEN pg_catalog.left(
            COALESCE(NULLIF(source_actor.name, ''), 'A buyer') || ' opened a case',
            200
          )
        WHEN source_case.resolution = 'REFUND_FULL' THEN 'Full refund issued'
        WHEN source_case.resolution = 'REFUND_PARTIAL' THEN 'Partial refund issued'
        ELSE 'Case dismissed'
      END,
      CASE
        WHEN p_type = 'CASE_OPENED'
          THEN pg_catalog.left(source_case.description, 60)
        WHEN source_case.resolution = 'REFUND_FULL'
          THEN 'A full refund has been issued to your original payment method.'
        WHEN source_case.resolution = 'REFUND_PARTIAL'
             AND source_case."refundAmountCents" IS NOT NULL
             AND source_case."refundAmountCents" > 0
          THEN 'A partial refund of '
            || CASE
              WHEN pg_catalog.lower(source_order.currency) = 'usd' THEN '$'
              ELSE pg_catalog.upper(source_order.currency) || ' '
            END
            || pg_catalog.to_char(
              source_case."refundAmountCents"::numeric / 100,
              'FM999999999990.00'
            )
            || ' has been issued to your original payment method.'
        WHEN source_case.resolution = 'REFUND_PARTIAL'
          THEN 'A partial refund has been issued to your original payment method.'
        ELSE 'The case has been reviewed and dismissed.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."Case" AS source_case
      JOIN public."Order" AS source_order
        ON source_order.id = source_case."orderId"
      JOIN public."User" AS source_actor
        ON source_actor.id = p_related_user_id
     WHERE source_case.id = p_source_id
       AND (
         (p_type = 'CASE_OPENED'
          AND source_case."buyerId" = p_related_user_id
          AND source_case."sellerId" = p_user_id)
         OR
         (p_type IN ('CASE_RESOLVED', 'REFUND_ISSUED')
          AND source_case.status = 'RESOLVED'
          AND source_case."buyerId" = p_user_id
          AND source_case."resolvedById" = p_related_user_id
          AND source_actor.role IN ('EMPLOYEE', 'ADMIN')
          AND (
            (p_type = 'REFUND_ISSUED'
             AND source_case.resolution IN ('REFUND_FULL', 'REFUND_PARTIAL'))
            OR
            (p_type = 'CASE_RESOLVED'
             AND source_case.resolution = 'DISMISSED')
          ))
       )
     FOR SHARE OF source_case, source_order, source_actor;
  ELSIF p_source_type = 'case_message' THEN
    SELECT
      CASE
        WHEN p_user_id = source_case."buyerId"
          THEN '/dashboard/orders/' || source_case."orderId"
        ELSE '/dashboard/sales/' || source_case."orderId"
      END,
      pg_catalog.left(
        CASE
          WHEN source_author.role IN ('EMPLOYEE', 'ADMIN')
            AND source_message."authorId" <> source_case."sellerId"
            AND (source_case."buyerId" IS NULL
                 OR source_message."authorId" <> source_case."buyerId")
            THEN 'Grainline Staff sent a message in your case'
          ELSE COALESCE(
            NULLIF(source_author.name, ''),
            CASE
              WHEN source_message."authorId" = source_case."buyerId" THEN 'A buyer'
              WHEN source_message."authorId" = source_case."sellerId" THEN 'The seller'
              ELSE 'Someone'
            END
          ) || ' sent a message in your case'
        END,
        200
      ),
      pg_catalog.left(source_message.body, 60)
      INTO notification_link, notification_title, notification_body
      FROM public."CaseMessage" AS source_message
      JOIN public."Case" AS source_case
        ON source_case.id = source_message."caseId"
      JOIN public."User" AS source_author
        ON source_author.id = source_message."authorId"
     WHERE source_message.id = p_source_id
       AND source_message."authorId" = p_related_user_id
       AND (
         (source_message."authorId" = source_case."buyerId"
          AND p_user_id = source_case."sellerId")
         OR
         (source_message."authorId" = source_case."sellerId"
          AND p_user_id = source_case."buyerId")
         OR
         (source_message."authorId" <> source_case."sellerId"
          AND (source_case."buyerId" IS NULL
               OR source_message."authorId" <> source_case."buyerId")
          AND source_author.role IN ('EMPLOYEE', 'ADMIN')
          AND p_user_id IN (source_case."buyerId", source_case."sellerId"))
       )
     FOR SHARE OF source_message, source_case, source_author;
  ELSIF p_source_type = 'case_resolution_mark' THEN
    SELECT
      CASE
        WHEN p_user_id = source_case."buyerId"
          THEN '/dashboard/orders/' || source_case."orderId"
        ELSE '/dashboard/sales/' || source_case."orderId"
      END,
      CASE
        WHEN source_audit.metadata ->> 'status' = 'RESOLVED' THEN 'Case resolved'
        ELSE 'Case marked resolved'
      END,
      CASE
        WHEN source_audit.metadata ->> 'status' = 'RESOLVED'
          THEN 'The case was resolved after both parties confirmed.'
        ELSE 'The other party marked this case resolved. Confirm resolution or continue the discussion.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."AdminAuditLog" AS source_audit
      JOIN public."Case" AS source_case
        ON source_case.id = source_audit."targetId"
     WHERE source_audit.id = p_source_id
       AND source_audit.action = 'MARK_CASE_RESOLVED'
       AND source_audit."targetType" = 'CASE'
       AND source_audit."adminId" = p_related_user_id
       AND source_audit.undone = false
       AND source_audit.metadata ->> 'actorKind' = 'user'
       AND source_audit.metadata ->> 'orderId' = source_case."orderId"
       AND source_audit.metadata ->> 'status' IN ('PENDING_CLOSE', 'RESOLVED')
       AND p_type = CASE
         WHEN source_audit.metadata ->> 'status' = 'RESOLVED'
           THEN 'CASE_RESOLVED'::public."NotificationType"
         ELSE 'CASE_MESSAGE'::public."NotificationType"
       END
       AND (
         (source_audit."adminId" = source_case."buyerId"
          AND p_user_id = source_case."sellerId")
         OR
         (source_audit."adminId" = source_case."sellerId"
          AND p_user_id = source_case."buyerId")
       )
     FOR SHARE OF source_audit, source_case;
  ELSIF p_source_type = 'case_system_action' THEN
    SELECT
      CASE
        WHEN p_user_id = source_case."buyerId"
          THEN '/dashboard/orders/' || source_case."orderId"
        ELSE '/dashboard/sales/' || source_case."orderId"
      END,
      CASE
        WHEN source_audit.action = 'AUTO_CLOSE_CASE' THEN 'Case closed'
        WHEN p_user_id = source_case."buyerId" THEN 'Case under review'
        ELSE 'Case escalated'
      END,
      CASE
        WHEN source_audit.action = 'AUTO_CLOSE_CASE'
          THEN 'This case was closed automatically after the resolution window expired.'
        WHEN source_audit.metadata ->> 'previousStatus' = 'OPEN'
             AND p_user_id = source_case."buyerId"
          THEN 'The seller did not respond in time, so Grainline staff will review this case.'
        WHEN source_audit.metadata ->> 'previousStatus' = 'OPEN'
          THEN 'This case was escalated to Grainline staff because the response window expired.'
        WHEN p_user_id = source_case."buyerId"
          THEN 'This case has been inactive, so Grainline staff will review it.'
        ELSE 'This case was escalated to Grainline staff after the discussion stalled.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."SystemAuditLog" AS source_audit
      JOIN public."Case" AS source_case
        ON source_case.id = source_audit."targetId"
     WHERE source_audit.id = p_source_id
       AND source_audit."actorType" = 'cron'
       AND source_audit."actorId" = 'case-auto-close'
       AND source_audit."targetType" = 'CASE'
       AND source_audit.metadata ->> 'orderId' = source_case."orderId"
       AND p_related_user_id IS NULL
       AND p_user_id IN (source_case."buyerId", source_case."sellerId")
       AND (
         (source_audit.action = 'AUTO_CLOSE_CASE'
          AND source_audit.metadata ->> 'previousStatus' = 'PENDING_CLOSE'
          AND source_audit.metadata ->> 'newStatus' = 'RESOLVED'
          AND p_type = 'CASE_RESOLVED')
         OR
         (source_audit.action = 'AUTO_ESCALATE_CASE'
          AND source_audit.metadata ->> 'previousStatus' IN ('OPEN', 'IN_DISCUSSION')
          AND source_audit.metadata ->> 'newStatus' = 'UNDER_REVIEW'
          AND p_type = 'CASE_MESSAGE')
       )
     FOR SHARE OF source_audit, source_case;
  ELSIF p_source_type = 'commission_interest' THEN
    SELECT
      '/messages/' || source_conversation.id,
      pg_catalog.left(
        COALESCE(NULLIF(source_seller."displayName", ''), 'A maker')
        || ' is interested in your commission',
        200
      ),
      pg_catalog.left('"' || source_request.title || '" — view the conversation', 1000)
      INTO notification_link, notification_title, notification_body
      FROM public."CommissionInterest" AS source_interest
      JOIN public."CommissionRequest" AS source_request
        ON source_request.id = source_interest."commissionRequestId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_interest."sellerProfileId"
      JOIN public."Conversation" AS source_conversation
        ON source_conversation.id = source_interest."conversationId"
     WHERE source_interest.id = p_source_id
       AND source_request."buyerId" = p_user_id
       AND source_seller."userId" = p_related_user_id
       AND (
         (source_conversation."userAId" = p_user_id
          AND source_conversation."userBId" = p_related_user_id)
         OR
         (source_conversation."userBId" = p_user_id
          AND source_conversation."userAId" = p_related_user_id)
       )
     FOR SHARE OF source_interest, source_request, source_seller, source_conversation;
  ELSIF p_source_type = 'commission_request' THEN
    -- Seller notifications depend on an exact interest/profile relationship.
    -- Lock that evidence rather than relying on an unlocked EXISTS check that
    -- account cleanup could delete concurrently.
    IF p_related_user_id IS NOT NULL THEN
      PERFORM 1
        FROM public."CommissionRequest" AS locked_request
        JOIN public."CommissionInterest" AS locked_interest
          ON locked_interest."commissionRequestId" = locked_request.id
        JOIN public."SellerProfile" AS locked_seller
          ON locked_seller.id = locked_interest."sellerProfileId"
       WHERE locked_request.id = p_source_id
         AND locked_request."buyerId" = p_related_user_id
         AND locked_seller."userId" = p_user_id
       FOR SHARE OF locked_request, locked_interest, locked_seller;
      IF NOT FOUND THEN
        RETURN NULL;
      END IF;
    END IF;

    SELECT
      CASE
        WHEN source_request.status = 'CLOSED' THEN '/commission'
        ELSE '/commission/' || source_request.id
      END,
      CASE source_request.status
        WHEN 'FULFILLED' THEN 'Commission request fulfilled'
        WHEN 'CLOSED' THEN 'Commission request closed'
        ELSE 'Commission request expired'
      END,
      CASE
        WHEN source_request.status = 'FULFILLED'
          THEN 'The request "' || source_request.title || '" has been fulfilled. Thanks for your interest!'
        WHEN source_request.status = 'CLOSED'
          THEN 'The request "' || source_request.title || '" has been closed by the buyer.'
        WHEN p_related_user_id IS NULL
          THEN '"' || pg_catalog.left(source_request.title, 80) || '" is now closed to new maker interest.'
        ELSE '"' || pg_catalog.left(source_request.title, 80) || '" is no longer accepting interest.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."CommissionRequest" AS source_request
     WHERE source_request.id = p_source_id
       AND (
         (source_request.status = 'EXPIRED'
          AND p_user_id = source_request."buyerId"
          AND p_related_user_id IS NULL)
         OR
         (source_request.status IN ('CLOSED', 'FULFILLED', 'EXPIRED')
          AND p_related_user_id = source_request."buyerId"
          AND EXISTS (
            SELECT 1
              FROM public."CommissionInterest" AS source_interest
              JOIN public."SellerProfile" AS source_seller
                ON source_seller.id = source_interest."sellerProfileId"
             WHERE source_interest."commissionRequestId" = source_request.id
               AND source_seller."userId" = p_user_id
          ))
       )
     FOR SHARE OF source_request;
  ELSIF p_source_type = 'checkout_low_stock' THEN
    SELECT
      '/dashboard/inventory',
      pg_catalog.left(source_listing.title || ' is running low', 200),
      'Only ' || source_listing."stockQuantity"::text || ' left in stock'
      INTO notification_link, notification_title, notification_body
      FROM public."OrderItem" AS source_item
      JOIN public."Order" AS source_order
        ON source_order.id = source_item."orderId"
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_item."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
      JOIN public."CheckoutStockReservation" AS source_reservation
        ON source_reservation."stripeSessionId" = source_order."stripeSessionId"
     WHERE source_item.id = p_source_id
       AND p_related_user_id IS NULL
       AND source_seller."userId" = p_user_id
       AND source_listing."listingType" = 'IN_STOCK'
       AND source_listing."stockQuantity" > 0
       AND source_listing."stockQuantity" <= 2
       AND source_order."paidAt" IS NOT NULL
       AND source_reservation.status = 'COMPLETED'
       AND source_reservation."reservedItems" @> pg_catalog.jsonb_build_array(
         pg_catalog.jsonb_build_object('listingId', source_listing.id)
       )
     FOR SHARE OF source_item, source_order, source_listing, source_seller, source_reservation;
  ELSIF p_source_type = 'manual_low_stock' THEN
    SELECT
      '/dashboard/listings/' || source_listing.id || '/edit',
      pg_catalog.left(source_audit.metadata ->> 'listingTitle' || ' is running low', 200),
      'Only ' || (source_audit.metadata ->> 'newQuantity') ||
        ' left in stock — consider restocking soon'
      INTO notification_link, notification_title, notification_body
      FROM public."SystemAuditLog" AS source_audit
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_audit."targetId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
     WHERE source_audit.id = p_source_id
       AND source_audit."actorType" = 'user'
       AND source_audit."actorId" = p_user_id
       AND source_audit.action = 'MANUAL_LISTING_STOCK_LOW'
       AND source_audit."targetType" = 'LISTING'
       AND source_audit.metadata ->> 'listingId' = source_listing.id
       AND source_audit.metadata ->> 'listingTitle' <> ''
       AND source_audit.metadata ->> 'newQuantity' IN ('1', '2')
       AND source_audit.metadata ->> 'mutationKind' IN ('delta', 'absolute')
       AND p_related_user_id IS NULL
       AND source_seller."userId" = p_user_id
     FOR SHARE OF source_audit, source_listing, source_seller;
  ELSIF p_source_type = 'guild_admin_action' THEN
    SELECT
      CASE
        WHEN source_audit.action IN (
          'APPROVE_GUILD_MEMBER',
          'APPROVE_GUILD_MASTER',
          'REINSTATE_GUILD_MEMBER'
        ) THEN '/seller/' || source_seller.id
        ELSE '/dashboard/verification'
      END,
      CASE source_audit.action
        WHEN 'APPROVE_GUILD_MEMBER' THEN 'You are now a Guild Member!'
        WHEN 'REJECT_GUILD_MEMBER' THEN 'Guild Member application update'
        WHEN 'REVOKE_GUILD_MEMBER' THEN 'Guild Member badge revoked'
        WHEN 'APPROVE_GUILD_MASTER' THEN 'You are now a Guild Master!'
        WHEN 'REJECT_GUILD_MASTER' THEN 'Guild Master application update'
        WHEN 'REVOKE_GUILD_MASTER' THEN 'Guild Master badge revoked'
        WHEN 'REINSTATE_GUILD_MEMBER' THEN 'Guild Member badge reinstated'
      END,
      CASE source_audit.action
        WHEN 'APPROVE_GUILD_MEMBER' THEN 'Your Guild Member badge is now live on your profile'
        WHEN 'REJECT_GUILD_MEMBER' THEN COALESCE(source_audit.reason, 'Please review your application')
        WHEN 'REVOKE_GUILD_MEMBER' THEN 'Your Guild Member badge was revoked by Grainline staff.'
        WHEN 'APPROVE_GUILD_MASTER' THEN 'Your Guild Master badge is now live on your profile'
        WHEN 'REJECT_GUILD_MASTER' THEN COALESCE(source_audit.reason, 'Please review your application')
        WHEN 'REVOKE_GUILD_MASTER' THEN 'Your Guild Master badge was revoked. Your Guild Member badge remains active.'
        WHEN 'REINSTATE_GUILD_MEMBER' THEN 'Your Guild Member badge is live again on your profile.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."AdminAuditLog" AS source_audit
      JOIN public."User" AS source_staff
        ON source_staff.id = source_audit."adminId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_audit."targetId"
      JOIN public."MakerVerification" AS source_verification
        ON source_verification."sellerProfileId" = source_seller.id
     WHERE source_audit.id = p_source_id
       AND source_audit."targetType" = 'SELLER_PROFILE'
       AND source_audit.undone = false
       AND source_audit.action IN (
         'APPROVE_GUILD_MEMBER',
         'REJECT_GUILD_MEMBER',
         'REVOKE_GUILD_MEMBER',
         'APPROVE_GUILD_MASTER',
         'REJECT_GUILD_MASTER',
         'REVOKE_GUILD_MASTER',
         'REINSTATE_GUILD_MEMBER'
       )
       AND source_seller."userId" = p_user_id
       AND p_related_user_id IS NULL
       AND source_staff.banned = false
       AND source_staff."deletedAt" IS NULL
       AND source_staff.role IN ('EMPLOYEE', 'ADMIN')
       AND (source_audit.action <> 'REINSTATE_GUILD_MEMBER' OR source_staff.role = 'ADMIN')
       AND source_verification."reviewedById" = source_audit."adminId"
       AND (
         (source_audit.action IN ('APPROVE_GUILD_MEMBER', 'REINSTATE_GUILD_MEMBER')
          AND source_verification.status = 'APPROVED'
          AND source_seller."guildLevel" = 'GUILD_MEMBER')
         OR
         (source_audit.action IN ('REJECT_GUILD_MEMBER', 'REVOKE_GUILD_MEMBER')
          AND source_verification.status = 'REJECTED'
          AND source_seller."guildLevel" = 'NONE')
         OR
         (source_audit.action = 'APPROVE_GUILD_MASTER'
          AND source_verification.status = 'GUILD_MASTER_APPROVED'
          AND source_seller."guildLevel" = 'GUILD_MASTER')
         OR
         (source_audit.action IN ('REJECT_GUILD_MASTER', 'REVOKE_GUILD_MASTER')
          AND source_verification.status = 'GUILD_MASTER_REJECTED'
          AND source_seller."guildLevel" = 'GUILD_MEMBER')
       )
       AND p_type = CASE
         WHEN source_audit.action IN (
           'APPROVE_GUILD_MEMBER',
           'APPROVE_GUILD_MASTER',
           'REINSTATE_GUILD_MEMBER'
         ) THEN 'VERIFICATION_APPROVED'::public."NotificationType"
         ELSE 'VERIFICATION_REJECTED'::public."NotificationType"
       END
     FOR SHARE OF source_audit, source_staff, source_seller, source_verification;
  ELSIF p_source_type = 'guild_system_action' THEN
    SELECT
      '/dashboard/verification',
      CASE source_audit.action
        WHEN 'WARN_GUILD_MASTER_METRICS' THEN 'Guild Master status at risk'
        WHEN 'AUTO_REVOKE_GUILD_MEMBER' THEN 'Guild Member badge revoked'
        WHEN 'AUTO_REVOKE_GUILD_MASTER' THEN 'Guild Master badge revoked'
      END,
      CASE source_audit.action
        WHEN 'WARN_GUILD_MASTER_METRICS' THEN
          'Your metrics have fallen below Guild Master requirements. You have 30 days to improve before your badge is reviewed. Check your dashboard for details.'
        WHEN 'AUTO_REVOKE_GUILD_MEMBER' THEN source_audit.reason
        WHEN 'AUTO_REVOKE_GUILD_MASTER' THEN
          'Your metrics fell below requirements for two consecutive months. Your Guild Member badge remains active.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."SystemAuditLog" AS source_audit
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_audit."targetId"
      JOIN public."SellerProfilePrivate" AS source_seller_private
        ON source_seller_private."sellerProfileId" = source_seller.id
      JOIN public."MakerVerification" AS source_verification
        ON source_verification."sellerProfileId" = source_seller.id
     WHERE source_audit.id = p_source_id
       AND source_audit."actorType" = 'cron'
       AND source_audit."targetType" = 'SELLER_PROFILE'
       AND source_audit.action IN (
         'WARN_GUILD_MASTER_METRICS',
         'AUTO_REVOKE_GUILD_MEMBER',
         'AUTO_REVOKE_GUILD_MASTER'
       )
       AND source_audit."actorId" = CASE
         WHEN source_audit.action = 'AUTO_REVOKE_GUILD_MEMBER'
           THEN 'guild-member-check'
         ELSE 'guild-metrics'
       END
       AND source_audit.metadata ->> 'jobName' = source_audit."actorId"
       AND source_audit.metadata ->> 'sellerUserId' = source_seller."userId"
       AND source_seller."userId" = p_user_id
       AND p_related_user_id IS NULL
       AND p_type = 'VERIFICATION_REJECTED'::public."NotificationType"
       AND (source_audit.action <> 'AUTO_REVOKE_GUILD_MEMBER' OR source_audit.reason IS NOT NULL)
       AND (
         (source_audit.action = 'WARN_GUILD_MASTER_METRICS'
          AND source_seller."guildLevel" = 'GUILD_MASTER'
          AND source_verification.status = 'GUILD_MASTER_APPROVED'
          AND source_seller_private."consecutiveMetricFailures" > 0
          AND source_seller_private."metricWarningSentAt" IS NOT NULL)
         OR
         (source_audit.action = 'AUTO_REVOKE_GUILD_MEMBER'
          AND source_seller."guildLevel" = 'NONE'
          AND source_verification.status = 'REJECTED')
         OR
         (source_audit.action = 'AUTO_REVOKE_GUILD_MASTER'
          AND source_seller."guildLevel" = 'GUILD_MEMBER'
          AND source_verification.status = 'GUILD_MASTER_REJECTED')
       )
     FOR SHARE OF source_audit, source_seller, source_seller_private, source_verification;
  ELSIF p_source_type = 'listing_admin_review' THEN
    SELECT
      CASE source_audit.action
        WHEN 'APPROVE_LISTING' THEN '/listing/' || source_listing.id
        WHEN 'REJECT_LISTING' THEN '/dashboard/listings/' || source_listing.id || '/edit'
      END,
      CASE source_audit.action
        WHEN 'APPROVE_LISTING' THEN 'Listing approved'
        WHEN 'REJECT_LISTING' THEN 'Listing needs changes'
      END,
      CASE source_audit.action
        WHEN 'APPROVE_LISTING' THEN
          CASE source_audit.metadata ->> 'finalStatus'
            WHEN 'SOLD_OUT' THEN 'Your listing "' || source_listing.title
              || '" has been approved. Add stock to make it available to buyers.'
            ELSE 'Your listing "' || source_listing.title
              || '" has been approved and is now live!'
          END
        WHEN 'REJECT_LISTING' THEN 'Your listing "' || source_listing.title
          || '" was not approved. Reason: ' || source_audit.reason
          || '. Please edit and resubmit.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."AdminAuditLog" AS source_audit
      JOIN public."User" AS source_staff
        ON source_staff.id = source_audit."adminId"
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_audit."targetId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
     WHERE source_audit.id = p_source_id
       AND source_audit."targetType" = 'LISTING'
       AND source_audit.undone = false
       AND source_audit.action IN ('APPROVE_LISTING', 'REJECT_LISTING')
       AND source_staff.role IN ('EMPLOYEE', 'ADMIN')
       AND source_staff.banned = false
       AND source_staff."deletedAt" IS NULL
       AND source_seller."userId" = p_user_id
       AND p_related_user_id IS NULL
       AND source_listing."reviewedByAdmin" = true
       AND source_listing."reviewedAt" IS NOT NULL
       AND (
         (source_audit.action = 'APPROVE_LISTING'
          AND source_audit.metadata ->> 'finalStatus' IN ('ACTIVE', 'SOLD_OUT')
          AND p_type = 'LISTING_APPROVED'::public."NotificationType")
         OR
         (source_audit.action = 'REJECT_LISTING'
          AND source_audit.reason IS NOT NULL
          AND source_audit.reason <> ''
          AND p_type = 'LISTING_REJECTED'::public."NotificationType")
       )
     FOR SHARE OF source_audit, source_staff, source_listing, source_seller;
  ELSIF p_source_type = 'listing_user_report' THEN
    SELECT
      '/dashboard/listings/' || source_listing.id || '/edit',
      'Listing report received',
      'A report about one of your listings was received and will be reviewed by Grainline staff.'
      INTO notification_link, notification_title, notification_body
      FROM public."UserReport" AS source_report
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_report."targetId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
     WHERE source_report.id = p_source_id
       AND source_report."targetType" = 'LISTING'
       AND source_report."reportedId" = source_seller."userId"
       AND source_report."reportedId" = p_user_id
       AND source_report."reporterId" = p_related_user_id
       AND source_report."reporterId" <> source_report."reportedId"
       AND p_type = 'LISTING_FLAGGED_BY_USER'::public."NotificationType"
     FOR SHARE OF source_report, source_listing, source_seller;
  ELSIF p_source_type = 'admin_account_message' THEN
    SELECT
      '/account',
      pg_catalog.left(source_audit.reason, 200),
      pg_catalog.left(source_audit.metadata ->> 'notificationBody', 1000)
      INTO notification_link, notification_title, notification_body
      FROM public."AdminAuditLog" AS source_audit
      JOIN public."User" AS source_staff
        ON source_staff.id = source_audit."adminId"
     WHERE source_audit.id = p_source_id
       AND source_audit.action = 'SEND_EMAIL'
       AND source_audit."targetType" = 'USER'
       AND source_audit."targetId" = p_user_id
       AND source_audit.undone = false
       AND source_staff.role = 'ADMIN'
       AND source_staff.banned = false
       AND source_staff."deletedAt" IS NULL
       AND source_audit.reason IS NOT NULL
       AND source_audit.reason <> ''
       AND pg_catalog.jsonb_typeof(source_audit.metadata -> 'notificationBody') = 'string'
       AND source_audit.metadata ->> 'notificationBody' <> ''
       AND p_related_user_id IS NULL
       AND p_type = 'ACCOUNT_WARNING'::public."NotificationType"
     FOR SHARE OF source_audit, source_staff;
  ELSIF p_source_type = 'banned_seller_order' THEN
    SELECT
      '/dashboard/orders/' || source_order.id,
      'Order under support review',
      'The maker is currently unavailable. Grainline staff will review the order and next steps.'
      INTO notification_link, notification_title, notification_body
      FROM public."AdminAuditLog" AS source_audit
      JOIN public."User" AS source_staff
        ON source_staff.id = source_audit."adminId"
      JOIN public."User" AS source_banned_seller
        ON source_banned_seller.id = source_audit."targetId"
      JOIN public."Order" AS source_order
        ON source_order.id = pg_catalog.split_part(p_source_id, ':', 2)
     WHERE source_audit.id = pg_catalog.split_part(p_source_id, ':', 1)
       AND p_source_id = source_audit.id || ':' || source_order.id
       AND source_audit.action = 'BAN_USER'
       AND source_audit."targetType" = 'USER'
       AND source_audit.undone = false
       AND source_staff.role IN ('EMPLOYEE', 'ADMIN')
       AND source_staff.banned = false
       AND source_staff."deletedAt" IS NULL
       AND source_banned_seller.banned = true
       AND source_banned_seller."deletedAt" IS NULL
       AND source_order."buyerId" = p_user_id
       AND p_related_user_id = source_banned_seller.id
       AND p_type = 'ACCOUNT_WARNING'::public."NotificationType"
       AND source_order."reviewNeeded" = true
       AND EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_array_elements(
             COALESCE(source_audit.metadata -> 'flaggedOpenOrders', '[]'::jsonb)
           ) AS flagged_order
          WHERE flagged_order ->> 'id' = source_order.id
            AND flagged_order ->> 'buyerId' = source_order."buyerId"
       )
       AND EXISTS (
         SELECT 1
           FROM public."OrderItem" AS source_item
           JOIN public."Listing" AS source_item_listing
             ON source_item_listing.id = source_item."listingId"
           JOIN public."SellerProfile" AS source_item_seller
             ON source_item_seller.id = source_item_listing."sellerId"
          WHERE source_item."orderId" = source_order.id
            AND source_item_seller."userId" = source_banned_seller.id
       )
     FOR SHARE OF source_audit, source_staff, source_banned_seller, source_order;
  ELSIF p_source_type = 'order_checkout' THEN
    SELECT
      CASE
        WHEN p_user_id = source_order."buyerId"
          THEN '/dashboard/orders/' || source_order.id
        ELSE '/dashboard/sales/' || source_order.id
      END,
      CASE
        WHEN p_user_id = source_order."buyerId" THEN 'Order confirmed!'
        ELSE 'New sale! Congrats!'
      END,
      CASE
        WHEN p_user_id = source_order."buyerId" THEN
          'Your order from ' || COALESCE(source_seller."displayName", 'Maker')
          || ' is being prepared'
        ELSE COALESCE(source_buyer.name, 'A buyer') || ' purchased '
          || COALESCE(source_listing.title, 'an item')
      END
      INTO notification_link, notification_title, notification_body
      FROM public."Order" AS source_order
      JOIN public."User" AS source_buyer
        ON source_buyer.id = source_order."buyerId"
      JOIN public."OrderItem" AS source_item
        ON source_item.id = (
          SELECT candidate_item.id
            FROM public."OrderItem" AS candidate_item
           WHERE candidate_item."orderId" = source_order.id
           ORDER BY candidate_item.id
           LIMIT 1
        )
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_item."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
      JOIN public."SystemAuditLog" AS source_audit
        ON source_audit."targetId" = source_order.id
       AND source_audit."targetType" = 'ORDER'
       AND source_audit.action = 'STRIPE_CHECKOUT_ORDER_CREATED'
     WHERE source_order.id = p_source_id
       AND source_order."paidAt" IS NOT NULL
       AND source_order."sellerRefundId" IS NULL
       AND source_audit."actorType" = 'webhook'
       AND source_audit."actorId" IS NOT NULL
       AND source_audit.metadata ->> 'stripeSessionId' = source_order."stripeSessionId"
       AND p_type = 'NEW_ORDER'::public."NotificationType"
       AND (
         (p_user_id = source_order."buyerId"
          AND p_related_user_id = source_seller."userId")
         OR
         (p_user_id = source_seller."userId"
          AND p_related_user_id = source_order."buyerId")
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public."OrderItem" AS other_item
           JOIN public."Listing" AS other_listing
             ON other_listing.id = other_item."listingId"
          WHERE other_item."orderId" = source_order.id
            AND other_listing."sellerId" <> source_seller.id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public."OrderPaymentEvent" AS refund_event
          WHERE refund_event."orderId" = source_order.id
            AND refund_event."eventType" = 'REFUND'
       )
     FOR SHARE OF source_order, source_buyer, source_item, source_listing, source_seller, source_audit;
  ELSIF p_source_type = 'order_fulfillment' THEN
    SELECT
      CASE
        WHEN source_audit."actorId" = source_order."buyerId"
          THEN '/dashboard/sales/' || source_order.id
        ELSE '/dashboard/orders/' || source_order.id
      END,
      CASE source_audit.metadata ->> 'action'
        WHEN 'shipped' THEN 'Your piece is on its way!'
        WHEN 'ready_for_pickup' THEN 'Ready for pickup!'
        WHEN 'delivered' THEN 'Buyer confirmed delivery'
        WHEN 'picked_up' THEN 'Buyer confirmed pickup'
      END,
      CASE source_audit.metadata ->> 'action'
        WHEN 'shipped' THEN CASE
          WHEN COALESCE(source_audit.metadata ->> 'trackingCarrier', '') <> ''
            THEN 'Shipped via ' || (source_audit.metadata ->> 'trackingCarrier')
          ELSE 'Your order has been shipped'
        END
        WHEN 'ready_for_pickup' THEN 'Your order is ready for pickup.'
        WHEN 'delivered' THEN 'The buyer confirmed delivery.'
        WHEN 'picked_up' THEN 'The buyer confirmed pickup.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."SystemAuditLog" AS source_audit
      JOIN public."Order" AS source_order
        ON source_order.id = source_audit."targetId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_order."sellerProfileId"
     WHERE source_audit.id = p_source_id
       AND source_audit.action = 'ORDER_FULFILLMENT_TRANSITION'
       AND source_audit."actorType" = 'user'
       AND source_audit."targetType" = 'ORDER'
       AND source_order."paidAt" IS NOT NULL
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
       AND source_order."paymentOpenDisputeBlocked" = false
       AND (
         (
           source_audit."actorId" = source_seller."userId"
           AND source_order."buyerId" = p_user_id
           AND p_related_user_id = source_seller."userId"
           AND source_audit.metadata ->> 'action' IN ('shipped', 'ready_for_pickup')
           AND source_audit.metadata ->> 'previousStatus' = 'PENDING'
           AND source_audit.metadata ->> 'newStatus' = CASE source_audit.metadata ->> 'action'
             WHEN 'shipped' THEN 'SHIPPED'
             WHEN 'ready_for_pickup' THEN 'READY_FOR_PICKUP'
           END
           AND p_type = 'ORDER_SHIPPED'::public."NotificationType"
         )
         OR
         (
           source_audit."actorId" = source_order."buyerId"
           AND source_seller."userId" = p_user_id
           AND p_related_user_id = source_order."buyerId"
           AND source_audit.metadata ->> 'action' IN ('delivered', 'picked_up')
           AND source_audit.metadata ->> 'fulfillmentMethod' = CASE source_audit.metadata ->> 'action'
             WHEN 'delivered' THEN 'SHIPPING'
             WHEN 'picked_up' THEN 'PICKUP'
           END
           AND source_audit.metadata ->> 'previousStatus' = CASE source_audit.metadata ->> 'action'
             WHEN 'delivered' THEN 'SHIPPED'
             WHEN 'picked_up' THEN 'READY_FOR_PICKUP'
           END
           AND source_audit.metadata ->> 'newStatus' = CASE source_audit.metadata ->> 'action'
             WHEN 'delivered' THEN 'DELIVERED'
             WHEN 'picked_up' THEN 'PICKED_UP'
           END
           AND source_order."fulfillmentMethod"::text = source_audit.metadata ->> 'fulfillmentMethod'
           AND source_order."fulfillmentStatus"::text = source_audit.metadata ->> 'newStatus'
           AND (
             (source_audit.metadata ->> 'action' = 'delivered' AND source_order."deliveredAt" IS NOT NULL)
             OR
             (source_audit.metadata ->> 'action' = 'picked_up' AND source_order."pickedUpAt" IS NOT NULL)
           )
           AND p_type = 'ORDER_DELIVERED'::public."NotificationType"
         )
       )
     FOR SHARE OF source_audit, source_order, source_seller;
  ELSIF p_source_type = 'order_payment' THEN
    SELECT
      CASE
        WHEN source_payment.metadata ->> 'localAction' = 'BLOCKED_CHECKOUT_REFUND_RECORDED'
          THEN '/dashboard/orders/' || source_order.id
        WHEN source_payment."eventType" = 'DISPUTE'
          THEN '/dashboard/sales/' || source_order.id
        ELSE '/dashboard/orders/' || source_order.id
      END,
      CASE
        WHEN source_payment.metadata ->> 'localAction' = 'SELLER_REFUND_RECORDED'
          THEN 'Refund from maker'
        WHEN source_payment.metadata ->> 'localAction' = 'BLOCKED_CHECKOUT_REFUND_RECORDED'
          THEN 'Payment refunded'
        WHEN source_payment."eventType" = 'DISPUTE'
          THEN 'Payment dispute opened'
      END,
      CASE
        WHEN source_payment.metadata ->> 'localAction' = 'SELLER_REFUND_RECORDED'
          THEN pg_catalog.left(source_payment.metadata ->> 'notificationBody', 1000)
        WHEN source_payment.metadata ->> 'localAction' = 'BLOCKED_CHECKOUT_REFUND_RECORDED'
          THEN 'This payment was refunded because the checkout was no longer eligible to complete.'
        WHEN source_payment."eventType" = 'DISPUTE'
          THEN 'Stripe reported a dispute for order ' || source_order.id || '.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."OrderPaymentEvent" AS source_payment
      JOIN public."Order" AS source_order
        ON source_order.id = source_payment."orderId"
      JOIN public."OrderItem" AS source_item
        ON source_item.id = (
          SELECT candidate_item.id
            FROM public."OrderItem" AS candidate_item
           WHERE candidate_item."orderId" = source_order.id
           ORDER BY candidate_item.id
           LIMIT 1
        )
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_item."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
     WHERE source_payment."stripeEventId" = p_source_id
       AND (
         (source_payment."eventType" = 'REFUND'
          AND source_payment.metadata ->> 'localAction' = 'SELLER_REFUND_RECORDED'
          AND pg_catalog.jsonb_typeof(source_payment.metadata -> 'notificationBody') = 'string'
          AND source_payment.metadata ->> 'notificationBody' <> ''
          AND source_order."buyerId" = p_user_id
          AND p_related_user_id = source_seller."userId"
          AND p_type = 'REFUND_ISSUED'::public."NotificationType")
         OR
         (source_payment."eventType" = 'REFUND'
          AND source_payment.metadata ->> 'localAction' = 'BLOCKED_CHECKOUT_REFUND_RECORDED'
          AND source_order."buyerId" = p_user_id
          AND p_related_user_id IS NULL
          -- Compatibility window: predecessor deployments still emit
          -- NEW_ORDER; the corrected application emits REFUND_ISSUED.
          AND p_type IN (
            'NEW_ORDER'::public."NotificationType",
            'REFUND_ISSUED'::public."NotificationType"
          ))
         OR
         (source_payment."eventType" = 'DISPUTE'
          AND source_payment.metadata ->> 'stripeEventType' IN (
            'charge.dispute.created',
            'charge.dispute.updated',
            'charge.dispute.closed',
            'charge.dispute.funds_withdrawn',
            'charge.dispute.funds_reinstated'
          )
          AND source_seller."userId" = p_user_id
          AND p_related_user_id IS NOT DISTINCT FROM source_order."buyerId"
          AND p_type = 'PAYMENT_DISPUTE'::public."NotificationType"
          AND EXISTS (
            SELECT 1
              FROM public."CaseStripeDisputeApplication" AS dispute_application
             WHERE dispute_application."paymentEventId" = source_payment.id
               AND dispute_application."orderId" = source_order.id
               AND dispute_application.action IN ('create', 'reopen')
          )
          AND EXISTS (
            SELECT 1
              FROM public."SystemAuditLog" AS dispute_audit
             WHERE dispute_audit."actorType" = 'webhook'
               AND dispute_audit."actorId" = source_payment."stripeEventId"
               AND dispute_audit.action = 'STRIPE_DISPUTE_RECORDED'
               AND dispute_audit."targetType" = 'ORDER'
               AND dispute_audit."targetId" = source_order.id
               AND dispute_audit.metadata ->> 'disputeSideEffectsApplied' = 'true'
          ))
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public."OrderItem" AS other_item
           JOIN public."Listing" AS other_listing
             ON other_listing.id = other_item."listingId"
          WHERE other_item."orderId" = source_order.id
            AND other_listing."sellerId" <> source_seller.id
       )
     FOR SHARE OF source_payment, source_order, source_item, source_listing, source_seller;
  ELSIF p_source_type = 'stripe_payout_failure' THEN
    SELECT
      '/dashboard/seller',
      'Payout failed',
      CASE
        WHEN COALESCE(source_payout."failureMessage", '') <> ''
          THEN 'Stripe could not complete a payout: '
            || pg_catalog.left(source_payout."failureMessage", 900)
        ELSE 'Stripe could not complete a payout. Review your Stripe account so the payout can be retried.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."SellerPayoutEvent" AS source_payout
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_payout."sellerProfileId"
     WHERE source_payout.id = p_source_id
       AND pg_catalog.lower(source_payout.status) = 'failed'
       AND source_payout."stripeEventId" IS NOT NULL
       AND source_seller."userId" = p_user_id
       AND p_related_user_id IS NULL
       AND p_type = 'PAYOUT_FAILED'::public."NotificationType"
     FOR SHARE OF source_payout, source_seller;
  ELSIF p_source_type = 'followed_maker_new_listing' THEN
    SELECT
      '/listing/' || source_listing.id,
      pg_catalog.left(
        'New listing from '
        || COALESCE(NULLIF(source_seller."displayName", ''), 'A maker you follow'),
        200
      ),
      pg_catalog.left(source_listing.title, 1000)
      INTO notification_link, notification_title, notification_body
      FROM public."Listing" AS source_listing
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
      JOIN public."User" AS source_seller_user
        ON source_seller_user.id = source_seller."userId"
      JOIN public."Follow" AS source_follow
        ON source_follow."sellerProfileId" = source_seller.id
       AND source_follow."followerId" = p_user_id
     WHERE source_listing.id = p_source_id
       AND source_listing.status = 'ACTIVE'
       AND source_listing."isPrivate" = false
       AND source_seller."userId" = p_related_user_id
       AND source_seller."chargesEnabled" = true
       AND source_seller."vacationMode" = false
       AND source_seller."stripeAccountSupported" = true
       AND source_seller_user.banned = false
       AND source_seller_user."deletedAt" IS NULL
     FOR SHARE OF source_listing, source_seller, source_seller_user, source_follow;
  ELSIF p_source_type = 'followed_maker_new_blog' THEN
    SELECT
      '/blog/' || source_post.slug,
      pg_catalog.left(
        'New post from '
        || COALESCE(NULLIF(source_seller."displayName", ''), 'A maker you follow'),
        200
      ),
      pg_catalog.left(source_post.title, 1000)
      INTO notification_link, notification_title, notification_body
      FROM public."BlogPost" AS source_post
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_post."sellerProfileId"
      JOIN public."User" AS source_seller_user
        ON source_seller_user.id = source_seller."userId"
      JOIN public."Follow" AS source_follow
        ON source_follow."sellerProfileId" = source_seller.id
       AND source_follow."followerId" = p_user_id
     WHERE source_post.id = p_source_id
       AND source_post.status = 'PUBLISHED'
       AND source_post."publishedAt" IS NOT NULL
       AND source_post."publishedAt" <= pg_catalog.clock_timestamp()
       AND source_seller."userId" = p_related_user_id
       AND source_seller."chargesEnabled" = true
       AND source_seller."vacationMode" = false
       AND source_seller."stripeAccountSupported" = true
       AND source_seller_user.banned = false
       AND source_seller_user."deletedAt" IS NULL
     FOR SHARE OF source_post, source_seller, source_seller_user, source_follow;
  ELSIF p_source_type = 'seller_broadcast' THEN
    SELECT
      '/account/feed?broadcast=' || source_broadcast.id,
      pg_catalog.left(
        'Update from '
        || COALESCE(NULLIF(source_seller."displayName", ''), 'A maker you follow'),
        200
      ),
      CASE
        WHEN pg_catalog.char_length(source_broadcast.message) > 100
          THEN pg_catalog.left(source_broadcast.message, 100) || '…'
        ELSE source_broadcast.message
      END
      INTO notification_link, notification_title, notification_body
      FROM public."SellerBroadcast" AS source_broadcast
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_broadcast."sellerProfileId"
      JOIN public."User" AS source_seller_user
        ON source_seller_user.id = source_seller."userId"
      JOIN public."Follow" AS source_follow
        ON source_follow."sellerProfileId" = source_seller.id
       AND source_follow."followerId" = p_user_id
     WHERE source_broadcast.id = p_source_id
       AND source_seller."userId" = p_related_user_id
       AND source_seller."chargesEnabled" = true
       AND source_seller."vacationMode" = false
       AND source_seller."stripeAccountSupported" = true
       AND source_seller_user.banned = false
       AND source_seller_user."deletedAt" IS NULL
     FOR SHARE OF source_broadcast, source_seller, source_seller_user, source_follow;
  ELSIF p_source_type = 'favorite' THEN
    SELECT
      '/listing/' || source_listing.id,
      pg_catalog.left(
        COALESCE(NULLIF(source_actor.name, ''), 'Someone') || ' hearted your listing',
        200
      ),
      pg_catalog.left(source_listing.title, 1000)
      INTO notification_link, notification_title, notification_body
      FROM public."Favorite" AS source_favorite
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_favorite."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
      JOIN public."User" AS source_seller_user
        ON source_seller_user.id = source_seller."userId"
      JOIN public."User" AS source_actor
        ON source_actor.id = source_favorite."userId"
     WHERE source_favorite."listingId" = p_source_id
       AND source_favorite."userId" = p_related_user_id
       AND source_seller."userId" = p_user_id
       AND source_listing.status IN ('ACTIVE', 'SOLD_OUT')
       AND source_listing."isPrivate" = false
       AND source_seller."chargesEnabled" = true
       AND source_seller."vacationMode" = false
       AND source_seller."stripeAccountSupported" = true
       AND source_seller_user.banned = false
       AND source_seller_user."deletedAt" IS NULL
     FOR SHARE OF source_favorite, source_listing, source_seller, source_seller_user, source_actor;
  ELSIF p_source_type = 'follow' THEN
    SELECT
      '/dashboard/analytics',
      pg_catalog.left(
        COALESCE(NULLIF(source_actor.name, ''), 'Someone') || ' started following you',
        200
      ),
      'They can now see your new listings and posts in their feed'
      INTO notification_link, notification_title, notification_body
      FROM public."Follow" AS source_follow
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_follow."sellerProfileId"
      JOIN public."User" AS source_actor
        ON source_actor.id = source_follow."followerId"
     WHERE source_follow."sellerProfileId" = p_source_id
       AND source_follow."followerId" = p_related_user_id
       AND source_seller."userId" = p_user_id
     FOR SHARE OF source_follow, source_seller, source_actor;
  ELSIF p_source_type = 'message' THEN
    IF p_type = 'CUSTOM_ORDER_LINK' THEN
      SELECT
        '/listing/' || context_listing.id,
        'Your custom piece is ready to review!',
        pg_catalog.left(context_listing.title || ' - review and purchase', 1000)
        INTO notification_link, notification_title, notification_body
        FROM public."Message" AS source_message
        JOIN public."Conversation" AS source_conversation
          ON source_conversation.id = source_message."conversationId"
        JOIN public."Listing" AS context_listing
          ON context_listing.id = pg_catalog.substring(
            source_message.body,
            '"listingId":"([^"]+)"'
          )
         AND context_listing."customOrderConversationId" = source_conversation.id
        JOIN public."SellerProfile" AS context_seller
          ON context_seller.id = context_listing."sellerId"
       WHERE source_message.id = p_source_id
         AND source_message.kind = 'custom_order_link'
         AND source_message."senderId" = p_related_user_id
         AND source_message."recipientId" = p_user_id
         AND context_listing."reservedForUserId" = p_user_id
         AND context_seller."userId" = p_related_user_id
         AND context_listing.status IN ('ACTIVE', 'SOLD_OUT')
         AND (
           (source_conversation."userAId" = p_related_user_id
            AND source_conversation."userBId" = p_user_id)
           OR
           (source_conversation."userBId" = p_related_user_id
            AND source_conversation."userAId" = p_user_id)
         )
       FOR SHARE OF source_message, source_conversation, context_listing, context_seller;
    ELSE
      SELECT
        '/messages/' || source_conversation.id,
        pg_catalog.left(
          COALESCE(
            NULLIF(source_sender.name, ''),
            CASE
              WHEN p_type = 'CUSTOM_ORDER_REQUEST' THEN 'A customer'
              ELSE 'Someone'
            END
          )
          || CASE
            WHEN p_type = 'CUSTOM_ORDER_REQUEST' THEN ' wants a custom piece!'
            ELSE ' sent you a message'
          END,
          200
        ),
        CASE
          WHEN p_type = 'CUSTOM_ORDER_REQUEST'
            THEN pg_catalog.left(source_message.body::jsonb ->> 'description', 60)
          ELSE pg_catalog.left(
            COALESCE(NULLIF(source_message.body, ''), 'Sent an attachment'),
            1000
          )
        END
        INTO notification_link, notification_title, notification_body
        FROM public."Message" AS source_message
        JOIN public."Conversation" AS source_conversation
          ON source_conversation.id = source_message."conversationId"
        JOIN public."User" AS source_sender
          ON source_sender.id = source_message."senderId"
       WHERE source_message.id = p_source_id
         AND source_message."senderId" = p_related_user_id
         AND source_message."recipientId" = p_user_id
         AND (
           (source_conversation."userAId" = p_related_user_id
            AND source_conversation."userBId" = p_user_id)
           OR
           (source_conversation."userBId" = p_related_user_id
            AND source_conversation."userAId" = p_user_id)
         )
         AND (
           (p_type = 'CUSTOM_ORDER_REQUEST'
            AND source_message.kind = 'custom_order_request')
           OR
           (p_type = 'NEW_MESSAGE'
            AND source_message.kind IS DISTINCT FROM 'custom_order_request'
            AND source_message.kind IS DISTINCT FROM 'custom_order_link')
         )
       FOR SHARE OF source_message, source_conversation, source_sender;
    END IF;
  ELSIF p_source_type = 'review' THEN
    SELECT
      '/listing/' || source_listing.id || '#reviews',
      pg_catalog.left(
        COALESCE(NULLIF(source_reviewer.name, ''), 'A buyer')
        || ' left you a '
        || CASE
          WHEN source_review."ratingX2" % 2 = 0
            THEN (source_review."ratingX2" / 2)::text
          ELSE pg_catalog.to_char(source_review."ratingX2"::numeric / 2, 'FM9.0')
        END
        || '-star review',
        200
      ),
      pg_catalog.left(source_listing.title, 1000)
      INTO notification_link, notification_title, notification_body
      FROM public."Review" AS source_review
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_review."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
      JOIN public."User" AS source_reviewer
        ON source_reviewer.id = source_review."reviewerId"
     WHERE source_review.id = p_source_id
       AND source_review."reviewerId" = p_related_user_id
       AND source_seller."userId" = p_user_id
     FOR SHARE OF source_review, source_listing, source_seller, source_reviewer;
  END IF;
  IF p_source_type IS NOT NULL AND NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF notification_title IS NULL
     OR notification_title = ''
     OR notification_body IS NULL THEN
    RAISE EXCEPTION 'derived notification payload is invalid' USING ERRCODE = '22023';
  END IF;

  -- Match the application payload contract without trusting application text.
  -- Legitimate source fields such as staff reasons may exceed the display
  -- bounds, so truncate the database-derived result instead of dropping the
  -- notification after the state transition has already committed.
  notification_title := pg_catalog.left(notification_title, 200);
  notification_body := pg_catalog.left(notification_body, 1000);

  IF notification_link IS NULL
     OR notification_link = ''
     OR pg_catalog.char_length(notification_link) > 2048
     OR pg_catalog.left(notification_link, 1) <> '/'
     OR pg_catalog.left(notification_link, 2) = '//'
     OR pg_catalog.strpos(notification_link, pg_catalog.chr(92)) > 0
     OR notification_link ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'derived notification link is invalid' USING ERRCODE = '22023';
  END IF;

  replay_material := pg_catalog.concat_ws(
    pg_catalog.chr(31),
    'grainline-notification-v1',
    p_user_id,
    p_type::text,
    p_source_type,
    p_source_id,
    COALESCE(p_related_user_id, '<system>')
  );
  notification_dedup_key :=
    pg_catalog.md5(replay_material)
    || pg_catalog.md5('grainline-notification-v1-secondary' || replay_material);

  INSERT INTO public."Notification" (
    id,
    "userId",
    "relatedUserId",
    "type",
    title,
    body,
    link,
    "sourceType",
    "sourceId",
    "dedupKey",
    read,
    "createdAt"
  ) VALUES (
    p_notification_id,
    p_user_id,
    p_related_user_id,
    p_type,
    notification_title,
    notification_body,
    notification_link,
    p_source_type,
    p_source_id,
    notification_dedup_key,
    false,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT ("userId", "type", "dedupKey") DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    SELECT notification.id
      INTO notification_id
      FROM public."Notification" AS notification
     WHERE notification."userId" = p_user_id
       AND notification."type" = p_type
       AND notification."dedupKey" = notification_dedup_key;
  END IF;

  RETURN notification_id;
END;
$grainline_notification_create_core$;

CREATE TEMP TABLE
  pg_temp.grainline_dispute_first_event_case_candidates
ON COMMIT DROP
AS
SELECT DISTINCT ON (
  payment."orderId",
  payment."stripeObjectId"
)
  payment.id AS payment_event_id,
  payment."orderId" AS order_id,
  payment."stripeEventId" AS stripe_event_id,
  payment."stripeObjectId" AS dispute_id,
  orders."buyerId" AS buyer_user_id,
  seller."userId" AS seller_user_id,
  COALESCE(
    payment."stripeEventCreatedSeconds",
    (payment.metadata->>'stripeEventCreated')::bigint
  ) AS event_created_seconds
FROM public."OrderPaymentEvent" AS payment
JOIN public."Order" AS orders
  ON orders.id = payment."orderId"
JOIN public."SellerProfile" AS seller
  ON seller.id = orders."sellerProfileId"
WHERE payment."eventType" = 'DISPUTE'
  AND payment."stripeObjectType" = 'dispute'
  AND payment."stripeObjectId" IS NOT NULL
  AND payment."stripeEventId" IS NOT NULL
  AND pg_catalog.jsonb_typeof(payment.metadata) = 'object'
  AND payment.metadata->>'stripeEventType' IN (
    'charge.dispute.created',
    'charge.dispute.updated',
    'charge.dispute.closed',
    'charge.dispute.funds_withdrawn',
    'charge.dispute.funds_reinstated'
  )
  AND payment.metadata->>'orderingAction' = 'applied'
  AND payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
  AND pg_catalog.lower(COALESCE(payment.status, '')) NOT IN (
    'won', 'lost', 'prevented', 'warning_closed'
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public."CaseStripeDisputeApplication" AS prior_application
      JOIN public."OrderPaymentEvent" AS applied_event
        ON applied_event.id = prior_application."paymentEventId"
     WHERE prior_application."orderId" = payment."orderId"
       AND applied_event."orderId" = payment."orderId"
       AND applied_event."eventType" = 'DISPUTE'
       AND applied_event."stripeObjectType" = 'dispute'
       AND applied_event."stripeObjectId"
             IS NOT DISTINCT FROM payment."stripeObjectId"
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public."OrderPaymentEvent" AS newer_event
     WHERE newer_event."orderId" = payment."orderId"
       AND newer_event."eventType" = 'DISPUTE'
       AND newer_event."stripeObjectType" = 'dispute'
       AND newer_event."stripeObjectId"
             IS NOT DISTINCT FROM payment."stripeObjectId"
       AND pg_catalog.jsonb_typeof(newer_event.metadata) = 'object'
       AND newer_event.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
       AND (
         (newer_event.metadata->>'stripeEventCreated')::bigint
           > (payment.metadata->>'stripeEventCreated')::bigint
         OR (
           (newer_event.metadata->>'stripeEventCreated')::bigint
             = (payment.metadata->>'stripeEventCreated')::bigint
           AND pg_catalog.lower(COALESCE(newer_event.status, '')) IN (
             'won', 'lost', 'prevented', 'warning_closed'
           )
         )
       )
  )
ORDER BY
  payment."orderId",
  payment."stripeObjectId",
  COALESCE(
    payment."stripeEventCreatedSeconds",
    (payment.metadata->>'stripeEventCreated')::bigint
  ) DESC,
  payment."createdAt" DESC,
  payment.id DESC;

DO $grainline_dispute_first_event_case_recovery$
DECLARE
  candidate record;
  application record;
  notification_id text;
  candidate_count bigint;
BEGIN
  SELECT pg_catalog.count(*)
    INTO candidate_count
    FROM pg_temp.grainline_dispute_first_event_case_candidates;

  IF candidate_count > 100 THEN
    RAISE EXCEPTION
      'Dispute first-event recovery candidate cap exceeded: %',
      candidate_count;
  END IF;

  FOR candidate IN
    SELECT candidates.*
      FROM pg_temp.grainline_dispute_first_event_case_candidates AS candidates
     ORDER BY candidates.order_id, candidates.dispute_id
  LOOP
    SELECT recovered.*
      INTO application
      FROM public.grainline_case_stripe_dispute_apply(
        candidate.payment_event_id
      ) AS recovered;

    IF NOT FOUND
       OR application."orderId" IS DISTINCT FROM candidate.order_id
       OR application."sellerUserId" IS DISTINCT FROM candidate.seller_user_id
       OR application."buyerUserId" IS DISTINCT FROM candidate.buyer_user_id
       OR application."paymentEventId"
            IS DISTINCT FROM candidate.payment_event_id
       OR application.action NOT IN ('create', 'reopen', 'replay') THEN
      RAISE EXCEPTION 'Dispute first-event Case recovery result is invalid';
    END IF;

    IF application.action IN ('create', 'reopen') THEN
      SELECT public.grainline_notification_create_core(
        pg_catalog.gen_random_uuid()::text,
        candidate.seller_user_id,
        'PAYMENT_DISPUTE'::public."NotificationType",
        'order_payment',
        candidate.stripe_event_id,
        candidate.buyer_user_id
      ) INTO notification_id;
    END IF;
  END LOOP;
END;
$grainline_dispute_first_event_case_recovery$;

REVOKE ALL ON FUNCTION public.grainline_case_relationship_valid()
  FROM PUBLIC, grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_case_stripe_dispute_apply(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_case_stripe_dispute_apply(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_order_payment_signed_dispute_apply(
    text, bigint, text, text, bigint, integer, text, text, text
  ) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_payment_signed_dispute_apply(
    text, bigint, text, text, bigint, integer, text, text, text
  ) TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_notification_create_core(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;

DO $grainline_dispute_first_event_case_catalog_verify$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM grainline_dispute_first_event_case_catalog_before AS before
      JOIN pg_catalog.pg_proc AS after ON after.oid = before.oid
     WHERE after.proowner IS DISTINCT FROM before.proowner
        OR after.prosecdef IS DISTINCT FROM before.prosecdef
        OR after.provolatile IS DISTINCT FROM before.provolatile
        OR after.proparallel IS DISTINCT FROM before.proparallel
        OR after.proconfig IS DISTINCT FROM before.proconfig
        OR after.proacl IS DISTINCT FROM before.proacl
  ) THEN
    RAISE EXCEPTION 'Dispute first-event function catalog posture changed';
  END IF;
END;
$grainline_dispute_first_event_case_catalog_verify$;

COMMENT ON FUNCTION
  public.grainline_order_payment_signed_dispute_apply(
    text, bigint, text, text, bigint, integer, text, text, text
  ) IS
  'Records signed Stripe dispute ordering, applies a first nonterminal observation, and preserves created-event recovery after a terminal first observation.';

DO $grainline_dispute_first_event_case_verify$
DECLARE
  relationship_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_case_relationship_valid()'
  );
  case_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_case_stripe_dispute_apply(text)'
  );
  dispute_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)'
  );
  relationship_definition text;
  case_definition text;
  dispute_definition text;
BEGIN
  IF relationship_oid IS NULL OR case_oid IS NULL OR dispute_oid IS NULL THEN
    RAISE EXCEPTION 'Dispute first-event Case functions are missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(routine.oid)
    INTO relationship_definition
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = relationship_oid;
  SELECT pg_catalog.pg_get_functiondef(routine.oid)
    INTO case_definition
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = case_oid;
  SELECT pg_catalog.pg_get_functiondef(routine.oid)
    INTO dispute_definition
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid = dispute_oid;

  IF relationship_definition NOT LIKE '%charge.dispute.funds_withdrawn%'
     OR relationship_definition NOT LIKE '%orderingAction%applied%'
     OR case_definition NOT LIKE '%charge.dispute.funds_withdrawn%'
     OR case_definition NOT LIKE '%exact_application%prior_application%'
     OR dispute_definition NOT LIKE '%is_first_dispute_event AND NOT is_terminal%'
     OR dispute_definition LIKE '%equal_payment.metadata->>''stripeEventType''%IS DISTINCT FROM source_event.type%'
     OR NOT (
       SELECT routine.prosecdef
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = relationship_oid
     )
     OR NOT (
       SELECT routine.prosecdef
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = case_oid
     )
     OR NOT (
       SELECT routine.prosecdef
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = dispute_oid
     )
     OR (
       SELECT routine.proconfig
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = relationship_oid
     ) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR (
       SELECT routine.proconfig
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = case_oid
     ) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR (
       SELECT routine.proconfig
         FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = dispute_oid
     ) IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime', relationship_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', case_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', dispute_oid, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine,
              LATERAL pg_catalog.aclexplode(
                COALESCE(
                  routine.proacl,
                  pg_catalog.acldefault('f', routine.proowner)
                )
              ) AS acl
        WHERE routine.oid IN (relationship_oid, case_oid, dispute_oid)
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Dispute first-event Case catalog drifted';
  END IF;
END;
$grainline_dispute_first_event_case_verify$;

COMMIT;
