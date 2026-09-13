-- Compatible fixed authority for applying one seller-owned local refund
-- source to an existing Case. Direct Case grants and participant RLS posture
-- remain unchanged so old and new application deployments can coexist.

BEGIN;

-- Runtime cannot preempt, rewrite or delete refund replay authority. The fixed
-- operation owns this table through its SECURITY DEFINER identity.
CREATE TABLE public."CaseSellerRefundApplication" (
  "paymentEventId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  action VARCHAR(10) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CaseSellerRefundApplication_pkey"
    PRIMARY KEY ("paymentEventId"),
  CONSTRAINT "CaseSellerRefundApplication_paymentEventId_fkey"
    FOREIGN KEY ("paymentEventId", "orderId")
    REFERENCES public."OrderPaymentEvent"(id, "orderId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseSellerRefundApplication_caseId_fkey"
    FOREIGN KEY ("caseId", "orderId")
    REFERENCES public."Case"(id, "orderId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaseSellerRefundApplication_identity_bounds_check"
    CHECK (
      "paymentEventId" <> ''
      AND pg_catalog.char_length("paymentEventId") <= 191
      AND "caseId" <> ''
      AND pg_catalog.char_length("caseId") <= 191
      AND "orderId" <> ''
      AND pg_catalog.char_length("orderId") <= 191
    ),
  CONSTRAINT "CaseSellerRefundApplication_action_check"
    CHECK (action IN ('resolve', 'terminal'))
);

CREATE INDEX "CaseSellerRefundApplication_caseId_createdAt_idx"
  ON public."CaseSellerRefundApplication" ("caseId", "createdAt");
CREATE INDEX "CaseSellerRefundApplication_orderId_idx"
  ON public."CaseSellerRefundApplication" ("orderId");

ALTER TABLE public."CaseSellerRefundApplication"
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CaseSellerRefundApplication"
  FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CaseSellerRefundApplication"
  FROM PUBLIC, grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_case_seller_refund_apply(
  p_actor_user_id text,
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
AS $grainline_case_seller_refund_apply$
DECLARE
  locked_actor record;
  source_order_id text;
  source_event record;
  locked_order record;
  existing_case record;
  existing_application record;
  seller_count integer;
  only_seller_user_id text;
  target_action text;
  target_resolution public."CaseResolution";
  transition_at timestamp(3);
  audit_id text;
  order_total_cents bigint;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_order_payment_event_id IS NULL
     OR pg_catalog.btrim(p_order_payment_event_id) = ''
     OR pg_catalog.char_length(p_order_payment_event_id) > 191 THEN
    RAISE EXCEPTION 'Case seller-refund input is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Shared authority order: actor User, then Order, then parent Case.
  SELECT
    actor.id,
    actor.banned,
    actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case seller-refund actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  -- Read only the source Order identity before acquiring the canonical Order
  -- lock. Re-read and lock the exact source afterward.
  SELECT payment_event."orderId"
    INTO source_order_id
    FROM public."OrderPaymentEvent" AS payment_event
   WHERE payment_event.id = p_order_payment_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case seller-refund source does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."buyerId",
    orders.currency,
    orders."itemsSubtotalCents",
    orders."shippingAmountCents",
    orders."giftWrappingPriceCents",
    orders."taxAmountCents",
    orders."sellerRefundId",
    orders."sellerRefundAmountCents",
    orders."sellerRefundLockedAt"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case seller-refund Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    payment_event.id,
    payment_event."orderId",
    payment_event."stripeEventId",
    payment_event."stripeObjectId",
    payment_event."stripeObjectType",
    payment_event."eventType",
    payment_event."amountCents",
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
    RAISE EXCEPTION 'Case seller-refund source changed Order'
      USING ERRCODE = '40001';
  END IF;

  order_total_cents :=
      COALESCE(locked_order."itemsSubtotalCents", 0)::bigint
    + COALESCE(locked_order."shippingAmountCents", 0)::bigint
    + COALESCE(locked_order."giftWrappingPriceCents", 0)::bigint
    + COALESCE(locked_order."taxAmountCents", 0)::bigint;

  IF source_event."eventType" <> 'REFUND'
     OR source_event."stripeObjectType" IS DISTINCT FROM 'refund'
     OR source_event."stripeObjectId" IS NULL
     OR pg_catalog.btrim(source_event."stripeObjectId") = ''
     OR source_event."stripeEventId" IS DISTINCT FROM
          'local:seller_refund_recorded:'
          || source_event."stripeObjectId"
     OR source_event."amountCents" IS NULL
     OR source_event."amountCents" <= 0
     OR source_event."amountCents"::bigint > order_total_cents
     OR source_event.currency !~ '^[a-z]{3}$'
     OR pg_catalog.lower(source_event.currency)
          IS DISTINCT FROM pg_catalog.lower(locked_order.currency)
     OR source_event.reason IS DISTINCT FROM 'seller_refund'
     OR pg_catalog.jsonb_typeof(source_event.metadata)
          IS DISTINCT FROM 'object'
     OR source_event.metadata->>'localAction'
          IS DISTINCT FROM 'SELLER_REFUND_RECORDED'
     OR source_event.metadata->>'refundType' IS NULL
     OR source_event.metadata->>'refundType'
          NOT IN ('FULL', 'PARTIAL')
     OR pg_catalog.jsonb_typeof(source_event.metadata->'refundIds')
          IS DISTINCT FROM 'array'
     OR NOT (
       source_event.metadata->'refundIds'
         @> pg_catalog.jsonb_build_array(source_event."stripeObjectId")
     )
     OR locked_order."sellerRefundId"
          IS DISTINCT FROM source_event."stripeObjectId"
     OR locked_order."sellerRefundAmountCents"
          IS DISTINCT FROM source_event."amountCents"
     OR locked_order."sellerRefundLockedAt" IS NOT NULL
     OR (
       source_event.metadata->>'refundType' = 'FULL'
       AND source_event."amountCents"::bigint <> order_total_cents
     ) THEN
    RAISE EXCEPTION 'Case seller-refund source is invalid'
      USING ERRCODE = '23514';
  END IF;

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
     OR locked_actor.id IS DISTINCT FROM only_seller_user_id
     OR (
       locked_order."buyerId" IS NOT NULL
       AND locked_order."buyerId" = only_seller_user_id
     ) THEN
    RAISE EXCEPTION 'Case seller-refund Order has invalid seller authority'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    case_row.id,
    case_row."buyerId",
    case_row."sellerId",
    case_row.status
    INTO existing_case
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = locked_order.id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      NULL::text,
      locked_order.id::text,
      only_seller_user_id,
      locked_order."buyerId"::text,
      source_event.id::text,
      'no_case'::text;
    RETURN;
  END IF;

  IF existing_case."sellerId" IS DISTINCT FROM only_seller_user_id
     OR existing_case."buyerId"
          IS DISTINCT FROM locked_order."buyerId" THEN
    RAISE EXCEPTION 'Case seller-refund Case parties are invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    application."caseId",
    application."orderId",
    application.action
    INTO existing_application
    FROM public."CaseSellerRefundApplication" AS application
   WHERE application."paymentEventId" = source_event.id
   FOR SHARE;

  IF FOUND THEN
    IF existing_application."caseId" IS DISTINCT FROM existing_case.id
       OR existing_application."orderId" IS DISTINCT FROM locked_order.id
       OR existing_application.action NOT IN ('resolve', 'terminal') THEN
      RAISE EXCEPTION 'Case seller-refund replay authority is invalid'
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

  transition_at := pg_catalog.clock_timestamp()::timestamp(3);
  IF existing_case.status IN (
    'RESOLVED'::public."CaseStatus",
    'CLOSED'::public."CaseStatus"
  ) THEN
    target_action := 'terminal';
  ELSE
    target_action := 'resolve';
    target_resolution :=
      CASE source_event.metadata->>'refundType'
        WHEN 'FULL' THEN 'REFUND_FULL'::public."CaseResolution"
        ELSE 'REFUND_PARTIAL'::public."CaseResolution"
      END;

    UPDATE public."Case" AS case_row
       SET status = 'RESOLVED'::public."CaseStatus",
           resolution = target_resolution,
           "refundAmountCents" = source_event."amountCents",
           "stripeRefundId" = source_event."stripeObjectId",
           "resolvedAt" = transition_at,
           "resolvedById" = only_seller_user_id,
           "buyerMarkedResolved" = false,
           "sellerMarkedResolved" = false,
           "updatedAt" = transition_at
     WHERE case_row.id = existing_case.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case seller-refund target disappeared'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  INSERT INTO public."CaseSellerRefundApplication" (
    "paymentEventId",
    "caseId",
    "orderId",
    action,
    "createdAt"
  )
  VALUES (
    source_event.id,
    existing_case.id,
    locked_order.id,
    target_action,
    transition_at
  );

  audit_id :=
    'case-seller-refund-audit:' || pg_catalog.gen_random_uuid()::text;
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
    'system',
    only_seller_user_id,
    'CASE_SELLER_REFUND_APPLIED',
    'CASE',
    existing_case.id,
    source_event.reason,
    pg_catalog.jsonb_build_object(
      'orderPaymentEventId', source_event.id,
      'orderId', locked_order.id,
      'stripeRefundId', source_event."stripeObjectId",
      'caseAction', target_action
    ),
    transition_at
  );

  RETURN QUERY SELECT
    existing_case.id::text,
    locked_order.id::text,
    only_seller_user_id,
    locked_order."buyerId"::text,
    source_event.id::text,
    target_action;
END
$grainline_case_seller_refund_apply$;

REVOKE ALL ON FUNCTION
  public.grainline_case_seller_refund_apply(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_seller_refund_apply(text, text)
  TO grainline_app_runtime;

COMMIT;
