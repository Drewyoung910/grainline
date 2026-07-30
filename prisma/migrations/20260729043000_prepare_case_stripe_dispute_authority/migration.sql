-- Compatible fixed authority for applying a signed Stripe dispute source to
-- Case. Direct Case grants and RLS posture are deliberately unchanged so old
-- and new application deployments can coexist.

BEGIN;

-- Runtime must not be able to preempt, rewrite or delete replay authority.
-- The fixed operation owns this table through its SECURITY DEFINER identity;
-- zero policies and no table grants keep ordinary application SQL out.
CREATE TABLE public."CaseStripeDisputeApplication" (
  "paymentEventId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  action VARCHAR(10) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CaseStripeDisputeApplication_pkey"
    PRIMARY KEY ("paymentEventId"),
  CONSTRAINT "CaseStripeDisputeApplication_paymentEventId_fkey"
    FOREIGN KEY ("paymentEventId", "orderId")
    REFERENCES public."OrderPaymentEvent"(id, "orderId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseStripeDisputeApplication_caseId_fkey"
    FOREIGN KEY ("caseId", "orderId")
    REFERENCES public."Case"(id, "orderId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseStripeDisputeApplication_identity_bounds_check"
    CHECK (
      "paymentEventId" <> ''
      AND pg_catalog.char_length("paymentEventId") <= 191
      AND "caseId" <> ''
      AND pg_catalog.char_length("caseId") <= 191
      AND "orderId" <> ''
      AND pg_catalog.char_length("orderId") <= 191
    ),
  CONSTRAINT "CaseStripeDisputeApplication_action_check"
    CHECK (action IN ('create', 'reopen'))
);

CREATE INDEX "CaseStripeDisputeApplication_caseId_createdAt_idx"
  ON public."CaseStripeDisputeApplication" ("caseId", "createdAt");
CREATE INDEX "CaseStripeDisputeApplication_orderId_idx"
  ON public."CaseStripeDisputeApplication" ("orderId");

ALTER TABLE public."CaseStripeDisputeApplication"
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CaseStripeDisputeApplication"
  FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CaseStripeDisputeApplication"
  FROM PUBLIC, grainline_app_runtime;

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
     OR source_event.metadata->>'stripeEventType'
          IS DISTINCT FROM 'charge.dispute.created'
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

  transition_at := pg_catalog.clock_timestamp()::timestamp(3);
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

REVOKE ALL ON FUNCTION
  public.grainline_case_stripe_dispute_apply(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_stripe_dispute_apply(text)
  TO grainline_app_runtime;

COMMIT;
