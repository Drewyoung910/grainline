-- Compatible fixed authority for staged staff Case resolution.
--
-- This migration adds four narrow SECURITY DEFINER operations around the
-- already-private CaseResolutionClaim ledger. It does not enable participant
-- RLS, revoke legacy Case grants, or convert the application. Old and new
-- deployments can therefore coexist while the authority is proved.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_prepare(
  p_actor_user_id text,
  p_case_id text,
  p_resolution public."CaseResolution",
  p_partial_refund_amount_cents integer,
  p_stock_restore_decision jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_staff_resolution_prepare$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  existing_claim record;
  seller_count integer;
  only_seller_user_id text;
  order_total_cents bigint;
  refund_amount_cents integer;
  stock_restore_plan jsonb := '[]'::jsonb;
  decision_entry jsonb;
  claim_id text;
  claim_status public."CaseResolutionClaimStatus";
  idempotency_scope text;
  transition_at timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_case_id IS NULL
     OR pg_catalog.btrim(p_case_id) = ''
     OR pg_catalog.char_length(p_case_id) > 191
     OR p_resolution IS NULL
     OR p_stock_restore_decision IS NULL
     OR pg_catalog.jsonb_typeof(p_stock_restore_decision) <> 'array'
     OR pg_catalog.jsonb_array_length(p_stock_restore_decision) > 50
     OR pg_catalog.octet_length(p_stock_restore_decision::text) > 32768 THEN
    RAISE EXCEPTION 'Case staff-resolution preparation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  FOR decision_entry IN
    SELECT input.value
      FROM pg_catalog.jsonb_array_elements(p_stock_restore_decision) AS input(value)
  LOOP
    IF pg_catalog.jsonb_typeof(decision_entry) <> 'object'
       OR (decision_entry - 'listingId' - 'quantity') <> '{}'::jsonb
       OR NOT (decision_entry ? 'listingId')
       OR NOT (decision_entry ? 'quantity')
       OR pg_catalog.btrim(decision_entry->>'listingId') = ''
       OR pg_catalog.char_length(decision_entry->>'listingId') > 191
       OR COALESCE(decision_entry->>'quantity', '') !~ '^[1-9][0-9]?$' THEN
      RAISE EXCEPTION 'Case stock-restoration decision is invalid'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT
    actor.id,
    actor.role,
    actor.banned,
    actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL
     OR locked_actor.role NOT IN (
       'EMPLOYEE'::public."Role",
       'ADMIN'::public."Role"
     ) THEN
    RAISE EXCEPTION 'Case staff-resolution actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT case_row."orderId"
    INTO source_order_id
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case staff-resolution Case does not exist'
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
    orders."stripePaymentIntentId",
    orders."stripeTransferId",
    orders."sellerRefundId",
    orders."sellerRefundAmountCents",
    orders."sellerRefundLockedAt",
    orders."labelStatus",
    orders."fulfillmentStatus",
    orders."caseResolutionClaimId"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case staff-resolution Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row."resolvedAt"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id
     AND case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case staff-resolution Case changed Order'
      USING ERRCODE = '40001';
  END IF;

  IF locked_case.status IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     OR locked_case."resolvedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case is already terminal'
      USING ERRCODE = '23514';
  END IF;

  -- Lock the complete Order-item/listing/seller graph before deriving parties
  -- or stock authority. Finalization revalidates the immutable stored plan.
  PERFORM item.id
    FROM public."OrderItem" AS item
    JOIN public."Listing" AS listing ON listing.id = item."listingId"
    JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
   WHERE item."orderId" = locked_order.id
   ORDER BY item.id, listing.id, seller.id
   FOR SHARE OF item, listing, seller;

  SELECT
    pg_catalog.count(DISTINCT seller."userId")::integer,
    pg_catalog.min(seller."userId")
    INTO seller_count, only_seller_user_id
    FROM public."OrderItem" AS item
    JOIN public."Listing" AS listing ON listing.id = item."listingId"
    JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
   WHERE item."orderId" = locked_order.id;

  IF seller_count <> 1
     OR only_seller_user_id IS NULL
     OR locked_case."sellerId" IS DISTINCT FROM only_seller_user_id
     OR locked_case."buyerId" IS DISTINCT FROM locked_order."buyerId"
     OR (
       locked_case."buyerId" IS NOT NULL
       AND locked_case."buyerId" = only_seller_user_id
     ) THEN
    RAISE EXCEPTION 'Case staff-resolution parties are invalid'
      USING ERRCODE = '23514';
  END IF;

  order_total_cents :=
      COALESCE(locked_order."itemsSubtotalCents", 0)::bigint
    + COALESCE(locked_order."shippingAmountCents", 0)::bigint
    + COALESCE(locked_order."giftWrappingPriceCents", 0)::bigint
    + COALESCE(locked_order."taxAmountCents", 0)::bigint;

  IF order_total_cents <= 0
     OR order_total_cents > 2147483647 THEN
    RAISE EXCEPTION 'Case staff-resolution Order total is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF p_resolution = 'REFUND_FULL'::public."CaseResolution" THEN
    IF p_partial_refund_amount_cents IS NOT NULL
       OR p_stock_restore_decision <> '[]'::jsonb THEN
      RAISE EXCEPTION 'Full refund inputs are not canonical'
        USING ERRCODE = '22023';
    END IF;
    refund_amount_cents := order_total_cents::integer;
    IF locked_order."fulfillmentStatus" NOT IN (
         'SHIPPED'::public."FulfillmentStatus",
         'DELIVERED'::public."FulfillmentStatus",
         'PICKED_UP'::public."FulfillmentStatus"
       ) THEN
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'listingId', restorable."listingId",
            'quantity', restorable.quantity
          )
          ORDER BY restorable."listingId"
        ),
        '[]'::jsonb
      )
        INTO stock_restore_plan
        FROM (
          SELECT
            item."listingId",
            pg_catalog.sum(item.quantity)::integer AS quantity
          FROM public."OrderItem" AS item
          JOIN public."Listing" AS listing ON listing.id = item."listingId"
          WHERE item."orderId" = locked_order.id
            AND listing."listingType" = 'IN_STOCK'::public."ListingType"
            AND item.quantity > 0
          GROUP BY item."listingId"
        ) AS restorable;
    END IF;
  ELSIF p_resolution = 'REFUND_PARTIAL'::public."CaseResolution" THEN
    IF p_partial_refund_amount_cents IS NULL
       OR p_partial_refund_amount_cents <= 0
       OR p_partial_refund_amount_cents::bigint > order_total_cents THEN
      RAISE EXCEPTION 'Partial refund amount is invalid'
        USING ERRCODE = '22023';
    END IF;
    refund_amount_cents := p_partial_refund_amount_cents;
    IF p_stock_restore_decision <> '[]'::jsonb
       AND locked_order."fulfillmentStatus" IN (
         'SHIPPED'::public."FulfillmentStatus",
         'DELIVERED'::public."FulfillmentStatus",
         'PICKED_UP'::public."FulfillmentStatus"
       ) THEN
      RAISE EXCEPTION 'Stock cannot be restored after fulfillment'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      WITH requested AS (
        SELECT
          input.value->>'listingId' AS listing_id,
          pg_catalog.sum((input.value->>'quantity')::integer)::integer
            AS quantity
        FROM pg_catalog.jsonb_array_elements(
          p_stock_restore_decision
        ) AS input(value)
        GROUP BY input.value->>'listingId'
      ),
      available AS (
        SELECT
          item."listingId" AS listing_id,
          pg_catalog.sum(item.quantity)::integer AS quantity
        FROM public."OrderItem" AS item
        JOIN public."Listing" AS listing ON listing.id = item."listingId"
        WHERE item."orderId" = locked_order.id
          AND listing."listingType" = 'IN_STOCK'::public."ListingType"
          AND item.quantity > 0
        GROUP BY item."listingId"
      )
      SELECT 1
        FROM requested
        LEFT JOIN available USING (listing_id)
       WHERE available.listing_id IS NULL
          OR requested.quantity > available.quantity
    ) THEN
      RAISE EXCEPTION 'Stock-restoration target or quantity is invalid'
        USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'listingId', requested.listing_id,
          'quantity', requested.quantity
        )
        ORDER BY requested.listing_id
      ),
      '[]'::jsonb
    )
      INTO stock_restore_plan
      FROM (
        SELECT
          input.value->>'listingId' AS listing_id,
          pg_catalog.sum((input.value->>'quantity')::integer)::integer
            AS quantity
        FROM pg_catalog.jsonb_array_elements(
          p_stock_restore_decision
        ) AS input(value)
        GROUP BY input.value->>'listingId'
      ) AS requested;
  ELSE
    IF p_partial_refund_amount_cents IS NOT NULL
       OR p_stock_restore_decision <> '[]'::jsonb THEN
      RAISE EXCEPTION 'Dismissal inputs are not canonical'
        USING ERRCODE = '22023';
    END IF;
    refund_amount_cents := NULL;
  END IF;

  IF locked_order."caseResolutionClaimId" IS NOT NULL THEN
    SELECT
      claim.id,
      claim."caseId",
      claim."orderId",
      claim."staffActorId",
      claim.resolution,
      claim."refundAmountCents",
      claim.currency,
      claim."stockRestorePlan",
      claim.status,
      claim."idempotencyScope"
      INTO existing_claim
      FROM public."CaseResolutionClaim" AS claim
     WHERE claim.id = locked_order."caseResolutionClaimId"
     FOR SHARE;
    IF NOT FOUND
       OR existing_claim."caseId" IS DISTINCT FROM locked_case.id
       OR existing_claim."orderId" IS DISTINCT FROM locked_order.id
       OR existing_claim."staffActorId" IS DISTINCT FROM locked_actor.id
       OR existing_claim.resolution IS DISTINCT FROM p_resolution
       OR existing_claim."refundAmountCents"
            IS DISTINCT FROM refund_amount_cents
       OR existing_claim.currency
            IS DISTINCT FROM pg_catalog.lower(locked_order.currency)
       OR existing_claim."stockRestorePlan"
            IS DISTINCT FROM stock_restore_plan THEN
      RAISE EXCEPTION 'A different Case resolution claim is active'
        USING ERRCODE = '23505';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'claimId', existing_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'buyerUserId', locked_case."buyerId",
      'sellerUserId', locked_case."sellerId",
      'resolution', existing_claim.resolution::text,
      'refundAmountCents', existing_claim."refundAmountCents",
      'currency', existing_claim.currency,
      'stockRestorePlan', existing_claim."stockRestorePlan",
      'status', existing_claim.status::text,
      'idempotencyScope', existing_claim."idempotencyScope",
      'paymentIntentId', locked_order."stripePaymentIntentId",
      'itemsSubtotalCents', locked_order."itemsSubtotalCents",
      'shippingAmountCents', locked_order."shippingAmountCents",
      'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
      'taxAmountCents', locked_order."taxAmountCents",
      'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
      'action', 'replay'
    );
  END IF;

  IF locked_order."sellerRefundId" IS NOT NULL
     OR locked_order."sellerRefundLockedAt" IS NOT NULL
     OR EXISTS (
       SELECT 1
         FROM public."OrderPaymentEvent" AS refund_event
        WHERE refund_event."orderId" = locked_order.id
          AND refund_event."eventType" = 'REFUND'
          AND (
            refund_event.status IS NULL
            OR pg_catalog.lower(refund_event.status)
                 NOT IN ('failed', 'canceled', 'cancelled')
          )
     ) THEN
    RAISE EXCEPTION 'Case staff-resolution Order has refund activity'
      USING ERRCODE = '23514';
  END IF;

  IF p_resolution IN (
       'REFUND_FULL'::public."CaseResolution",
       'REFUND_PARTIAL'::public."CaseResolution"
     ) THEN
    IF locked_order."stripePaymentIntentId" IS NULL
       OR pg_catalog.btrim(locked_order."stripePaymentIntentId") = ''
       OR locked_order."labelStatus" =
            'PURCHASED'::public."LabelStatus"
       OR EXISTS (
         SELECT 1
           FROM (
             SELECT DISTINCT ON (
               COALESCE(dispute_event."stripeObjectId", dispute_event.id)
             )
               dispute_event.status
             FROM public."OrderPaymentEvent" AS dispute_event
             WHERE dispute_event."orderId" = locked_order.id
               AND dispute_event."eventType" = 'DISPUTE'
             ORDER BY
               COALESCE(dispute_event."stripeObjectId", dispute_event.id),
               COALESCE(
                 NULLIF(
                   dispute_event.metadata->>'stripeEventCreated',
                   ''
                 )::bigint,
                 EXTRACT(
                   epoch FROM dispute_event."createdAt"
                 )::bigint
               ) DESC,
               dispute_event."createdAt" DESC,
               dispute_event.id DESC
           ) AS latest_dispute
          WHERE latest_dispute.status IS NULL
             OR pg_catalog.lower(latest_dispute.status) NOT IN (
               'won',
               'lost',
               'prevented',
               'warning_closed'
             )
       ) THEN
      RAISE EXCEPTION 'Case staff-resolution refund is not eligible'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  transition_at := pg_catalog.clock_timestamp()::timestamp(3);
  claim_id :=
    'case_resolution_claim_' || pg_catalog.gen_random_uuid()::text;
  IF refund_amount_cents IS NULL THEN
    claim_status := 'LOCAL_READY'::public."CaseResolutionClaimStatus";
    idempotency_scope := NULL;
  ELSE
    claim_status := 'PROVIDER_PENDING'::public."CaseResolutionClaimStatus";
    idempotency_scope :=
      'case-resolve:' || claim_id || ':' || p_resolution::text || ':'
      || refund_amount_cents::text;
  END IF;

  INSERT INTO public."CaseResolutionClaim" (
    id,
    "caseId",
    "orderId",
    "staffActorId",
    resolution,
    "refundAmountCents",
    currency,
    "stockRestorePlan",
    status,
    "idempotencyScope",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    claim_id,
    locked_case.id,
    locked_order.id,
    locked_actor.id,
    p_resolution,
    refund_amount_cents,
    pg_catalog.lower(locked_order.currency),
    stock_restore_plan,
    claim_status,
    idempotency_scope,
    transition_at,
    transition_at
  );

  UPDATE public."Order" AS orders
     SET "caseResolutionClaimId" = claim_id,
         "sellerRefundId" = CASE
           WHEN refund_amount_cents IS NULL THEN orders."sellerRefundId"
           ELSE 'pending'
         END,
         "sellerRefundLockedAt" = CASE
           WHEN refund_amount_cents IS NULL THEN orders."sellerRefundLockedAt"
           ELSE transition_at
         END
   WHERE orders.id = locked_order.id
     AND orders."caseResolutionClaimId" IS NULL
     AND orders."sellerRefundId" IS NULL
     AND orders."sellerRefundLockedAt" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case staff-resolution lease acquisition failed'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'claimId', claim_id,
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'resolution', p_resolution::text,
    'refundAmountCents', refund_amount_cents,
    'currency', pg_catalog.lower(locked_order.currency),
    'stockRestorePlan', stock_restore_plan,
    'status', claim_status::text,
    'idempotencyScope', idempotency_scope,
    'paymentIntentId', locked_order."stripePaymentIntentId",
    'itemsSubtotalCents', locked_order."itemsSubtotalCents",
    'shippingAmountCents', locked_order."shippingAmountCents",
    'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
    'taxAmountCents', locked_order."taxAmountCents",
    'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
    'action', 'prepared'
  );
END
$grainline_case_staff_resolution_prepare$;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_prepare(
    text,
    text,
    public."CaseResolution",
    integer,
    jsonb
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_prepare(
    text,
    text,
    public."CaseResolution",
    integer,
    jsonb
  )
  TO grainline_app_runtime;

CREATE OR REPLACE FUNCTION
  public.grainline_case_staff_resolution_provider_record(
    p_actor_user_id text,
    p_resolution_claim_id text,
    p_provider_outcome text,
    p_primary_refund_id text,
    p_refund_ids text[],
    p_refund_statuses text[],
    p_transfer_reversal_id text,
    p_transfer_reversal_amount_cents integer,
    p_requires_manual_transfer_reconciliation boolean,
    p_requires_manual_follow_up boolean
  )
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_staff_resolution_provider_record$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  locked_claim record;
  existing_event record;
  primary_status text;
  payment_event_id text;
  transition_at timestamp(3);
  audit_id text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_resolution_claim_id IS NULL
     OR pg_catalog.btrim(p_resolution_claim_id) = ''
     OR pg_catalog.char_length(p_resolution_claim_id) > 191
     OR p_provider_outcome IS NULL
     OR p_provider_outcome NOT IN ('RECORDED', 'AMBIGUOUS') THEN
    RAISE EXCEPTION 'Case provider-record input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_outcome = 'AMBIGUOUS'
     AND (
       p_primary_refund_id IS NOT NULL
       OR COALESCE(pg_catalog.cardinality(p_refund_ids), 0) <> 0
       OR COALESCE(pg_catalog.cardinality(p_refund_statuses), 0) <> 0
       OR p_transfer_reversal_id IS NOT NULL
       OR p_transfer_reversal_amount_cents IS NOT NULL
       OR COALESCE(p_requires_manual_transfer_reconciliation, false)
       OR COALESCE(p_requires_manual_follow_up, false)
     ) THEN
    RAISE EXCEPTION 'Ambiguous provider outcome cannot assert evidence'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.id,
    actor.role,
    actor.banned,
    actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL
     OR locked_actor.role NOT IN (
       'EMPLOYEE'::public."Role",
       'ADMIN'::public."Role"
     ) THEN
    RAISE EXCEPTION 'Case provider-record actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT claim."orderId"
    INTO source_order_id
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution claim does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."caseResolutionClaimId",
    orders."sellerRefundId",
    orders."sellerRefundLockedAt"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-record Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row."resolvedAt"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-record Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    claim.id,
    claim."caseId",
    claim."orderId",
    claim."staffActorId",
    claim.resolution,
    claim."refundAmountCents",
    claim.currency,
    claim.status,
    claim."idempotencyScope",
    claim."orderPaymentEventId"
    INTO locked_claim
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id
     AND claim."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_claim."caseId" IS DISTINCT FROM locked_case.id
     OR locked_claim."staffActorId" IS DISTINCT FROM locked_actor.id
     OR locked_claim.resolution NOT IN (
       'REFUND_FULL'::public."CaseResolution",
       'REFUND_PARTIAL'::public."CaseResolution"
     )
     OR locked_claim."refundAmountCents" IS NULL
     OR locked_order."caseResolutionClaimId"
          IS DISTINCT FROM locked_claim.id THEN
    RAISE EXCEPTION 'Case provider-record claim authority is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF locked_claim.status =
       'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
     AND p_provider_outcome = 'RECORDED' THEN
    SELECT
      payment_event.id,
      payment_event."stripeObjectId"
      INTO existing_event
      FROM public."OrderPaymentEvent" AS payment_event
     WHERE payment_event.id = locked_claim."orderPaymentEventId"
       AND payment_event."orderId" = locked_order.id
     FOR SHARE;
    IF NOT FOUND
       OR existing_event."stripeObjectId"
            IS DISTINCT FROM p_primary_refund_id THEN
      RAISE EXCEPTION 'Case provider-record replay is inconsistent'
        USING ERRCODE = '23514';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'paymentEventId', existing_event.id,
      'status', locked_claim.status::text,
      'action', 'replay'
    );
  END IF;

  IF locked_claim.status =
       'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
     AND p_provider_outcome = 'AMBIGUOUS' THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'paymentEventId', NULL,
      'status', locked_claim.status::text,
      'action', 'ambiguous_replay'
    );
  END IF;

  IF locked_claim.status <>
       'PROVIDER_PENDING'::public."CaseResolutionClaimStatus"
     OR locked_case.status IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     OR locked_case."resolvedAt" IS NOT NULL
     OR locked_order."sellerRefundId" IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Case provider-record claim is not pending'
      USING ERRCODE = '23514';
  END IF;

  transition_at := pg_catalog.clock_timestamp()::timestamp(3);
  IF p_provider_outcome = 'AMBIGUOUS' THEN
    IF p_primary_refund_id IS NOT NULL
       OR COALESCE(pg_catalog.cardinality(p_refund_ids), 0) <> 0
       OR COALESCE(pg_catalog.cardinality(p_refund_statuses), 0) <> 0
       OR p_transfer_reversal_id IS NOT NULL
       OR p_transfer_reversal_amount_cents IS NOT NULL
       OR COALESCE(p_requires_manual_transfer_reconciliation, false)
       OR COALESCE(p_requires_manual_follow_up, false) THEN
      RAISE EXCEPTION 'Ambiguous provider outcome cannot assert evidence'
        USING ERRCODE = '22023';
    END IF;

    UPDATE public."Order" AS orders
       SET "sellerRefundId" =
             'ambiguous_refund_pending_reconciliation',
           "sellerRefundLockedAt" = NULL,
           "reviewNeeded" = true,
           "reviewNote" =
             'Staff case refund has an ambiguous provider outcome; '
             || 'staff must reconcile Stripe before retrying.'
     WHERE orders.id = locked_order.id
       AND orders."caseResolutionClaimId" = locked_claim.id
       AND orders."sellerRefundId" = 'pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case provider-record ambiguous lease was lost'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public."CaseResolutionClaim" AS claim
       SET status =
             'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus",
           "updatedAt" = transition_at
     WHERE claim.id = locked_claim.id
       AND claim.status =
             'PROVIDER_PENDING'::public."CaseResolutionClaimStatus";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case provider-record ambiguous transition failed'
        USING ERRCODE = '40001';
    END IF;

    audit_id :=
      'case-resolution-ambiguous-audit:'
      || pg_catalog.gen_random_uuid()::text;
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
      'staff',
      locked_actor.id,
      'CASE_RESOLUTION_PROVIDER_AMBIGUOUS',
      'CASE_RESOLUTION_CLAIM',
      locked_claim.id,
      'provider_outcome_ambiguous',
      pg_catalog.jsonb_build_object(
        'caseId', locked_case.id,
        'orderId', locked_order.id,
        'idempotencyScope', locked_claim."idempotencyScope"
      ),
      transition_at
    );

    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'paymentEventId', NULL,
      'status', 'RECONCILIATION_REQUIRED',
      'action', 'ambiguous'
    );
  END IF;

  IF p_primary_refund_id IS NULL
     OR p_primary_refund_id !~ '^re_[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_primary_refund_id) > 220
     OR p_refund_ids IS NULL
     OR p_refund_statuses IS NULL
     OR pg_catalog.cardinality(p_refund_ids) < 1
     OR pg_catalog.cardinality(p_refund_ids) > 5
     OR pg_catalog.cardinality(p_refund_statuses)
          <> pg_catalog.cardinality(p_refund_ids)
     OR NOT (p_primary_refund_id = ANY(p_refund_ids))
     OR (
       SELECT pg_catalog.count(DISTINCT refund_id)
       FROM pg_catalog.unnest(p_refund_ids) AS ids(refund_id)
     ) <> pg_catalog.cardinality(p_refund_ids)
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_refund_ids) AS ids(refund_id)
        WHERE ids.refund_id IS NULL
           OR ids.refund_id !~ '^re_[A-Za-z0-9]+$'
           OR pg_catalog.char_length(ids.refund_id) > 220
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_refund_statuses) AS statuses(refund_status)
        WHERE statuses.refund_status IS NOT NULL
          AND (
            pg_catalog.btrim(statuses.refund_status) = ''
            OR pg_catalog.char_length(statuses.refund_status) > 100
            OR pg_catalog.lower(statuses.refund_status)
                 IN ('failed', 'canceled', 'cancelled')
          )
     )
     OR (
       p_transfer_reversal_id IS NOT NULL
       AND (
         p_transfer_reversal_id !~ '^trr_[A-Za-z0-9]+$'
         OR pg_catalog.char_length(p_transfer_reversal_id) > 220
       )
     )
     OR (
       p_transfer_reversal_amount_cents IS NOT NULL
       AND (
         p_transfer_reversal_amount_cents < 0
         OR p_transfer_reversal_amount_cents
              > locked_claim."refundAmountCents"
       )
     ) THEN
    RAISE EXCEPTION 'Recorded provider evidence is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT statuses.refund_status
    INTO primary_status
    FROM unnest(
      p_refund_ids,
      p_refund_statuses
    ) AS statuses(refund_id, refund_status)
   WHERE statuses.refund_id = p_primary_refund_id;

  payment_event_id :=
    'case-resolution-payment:' || pg_catalog.gen_random_uuid()::text;
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
    "createdAt",
    "updatedAt"
  )
  VALUES (
    payment_event_id,
    locked_order.id,
    'local:case_refund_recorded:' || p_primary_refund_id,
    p_primary_refund_id,
    'refund',
    'REFUND',
    locked_claim."refundAmountCents",
    locked_claim.currency,
    primary_status,
    'case_resolution_refund',
    'Provider refund recorded for staged Case resolution claim.',
    pg_catalog.jsonb_build_object(
      'localAction', 'CASE_REFUND_RECORDED',
      'caseId', locked_case.id,
      'resolutionClaimId', locked_claim.id,
      'resolution', locked_claim.resolution::text,
      'refundIds', pg_catalog.to_jsonb(p_refund_ids),
      'refundStatuses', pg_catalog.to_jsonb(p_refund_statuses),
      'transferReversalId', p_transfer_reversal_id,
      'transferReversalAmountCents',
        p_transfer_reversal_amount_cents,
      'requiresManualTransferReconciliation',
        COALESCE(p_requires_manual_transfer_reconciliation, false),
      'requiresManualFollowUp',
        COALESCE(p_requires_manual_follow_up, false)
    ),
    transition_at,
    transition_at
  );

  UPDATE public."Order" AS orders
     SET "sellerRefundId" = p_primary_refund_id,
         "sellerRefundAmountCents" = locked_claim."refundAmountCents",
         "sellerRefundLockedAt" = NULL,
         "reviewNeeded" = true,
         "reviewNote" =
           'Stripe refund recorded for staged staff Case resolution claim '
           || locked_claim.id || '.'
   WHERE orders.id = locked_order.id
     AND orders."caseResolutionClaimId" = locked_claim.id
     AND orders."sellerRefundId" = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-record refund lease was lost'
      USING ERRCODE = '40001';
  END IF;

  IF COALESCE(p_requires_manual_transfer_reconciliation, false) THEN
    UPDATE public."SellerProfile" AS seller
       SET "manualStripeReconciliationNeeded" = true,
           "manualStripeReconciliationNote" =
             'Staff case refund used a platform-only Stripe refund; '
             || 'staff must reconcile the seller transfer manually.',
           "updatedAt" = transition_at
     WHERE seller."userId" = locked_case."sellerId";
  END IF;

  UPDATE public."CaseResolutionClaim" AS claim
     SET status =
           'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus",
         "orderPaymentEventId" = payment_event_id,
         "providerRecordedAt" = transition_at,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim.status =
           'PROVIDER_PENDING'::public."CaseResolutionClaimStatus";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-record transition failed'
      USING ERRCODE = '40001';
  END IF;

  audit_id :=
    'case-resolution-provider-audit:'
    || pg_catalog.gen_random_uuid()::text;
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
    'staff',
    locked_actor.id,
    'CASE_REFUND_RECORDED',
    'ORDER',
    locked_order.id,
    'case_resolution_refund',
    pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'resolutionClaimId', locked_claim.id,
      'orderPaymentEventId', payment_event_id,
      'stripeRefundId', p_primary_refund_id,
      'refundIds', pg_catalog.to_jsonb(p_refund_ids),
      'amountCents', locked_claim."refundAmountCents",
      'currency', locked_claim.currency
    ),
    transition_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'claimId', locked_claim.id,
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'paymentEventId', payment_event_id,
    'status', 'PROVIDER_RECORDED',
    'action', 'recorded'
  );
END
$grainline_case_staff_resolution_provider_record$;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_provider_record(
    text,
    text,
    text,
    text,
    text[],
    text[],
    text,
    integer,
    boolean,
    boolean
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_provider_record(
    text,
    text,
    text,
    text,
    text[],
    text[],
    text,
    integer,
    boolean,
    boolean
  )
  TO grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_finalize(
  p_actor_user_id text,
  p_resolution_claim_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_staff_resolution_finalize$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  locked_claim record;
  linked_event record;
  plan_entry jsonb;
  plan_listing_id text;
  plan_quantity integer;
  message_id text;
  audit_id text;
  transition_at timestamp(3);
  resolution_message text;
  stripe_refund_id text := NULL;
  restored_active_count integer := 0;
  changed_count integer;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_resolution_claim_id IS NULL
     OR pg_catalog.btrim(p_resolution_claim_id) = ''
     OR pg_catalog.char_length(p_resolution_claim_id) > 191 THEN
    RAISE EXCEPTION 'Case staff-resolution finalization input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.id,
    actor.role,
    actor.banned,
    actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL
     OR locked_actor.role NOT IN (
       'EMPLOYEE'::public."Role",
       'ADMIN'::public."Role"
     ) THEN
    RAISE EXCEPTION 'Case staff-resolution finalizer is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT claim."orderId"
    INTO source_order_id
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution claim does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."buyerId",
    orders."caseResolutionClaimId",
    orders."sellerRefundId",
    orders."sellerRefundAmountCents"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case finalization Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row.resolution,
    case_row."resolvedAt"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case finalization Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    claim.id,
    claim."caseId",
    claim."orderId",
    claim."staffActorId",
    claim.resolution,
    claim."refundAmountCents",
    claim.currency,
    claim."stockRestorePlan",
    claim.status,
    claim."orderPaymentEventId"
    INTO locked_claim
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id
     AND claim."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_claim."caseId" IS DISTINCT FROM locked_case.id
     OR locked_claim."staffActorId" IS DISTINCT FROM locked_actor.id THEN
    RAISE EXCEPTION 'Case finalization claim authority is invalid'
      USING ERRCODE = '42501';
  END IF;

  message_id := 'case_resolution_message_' || locked_claim.id;
  IF locked_claim.status =
       'FINALIZED'::public."CaseResolutionClaimStatus" THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'buyerUserId', locked_case."buyerId",
      'sellerUserId', locked_case."sellerId",
      'resolution', locked_claim.resolution::text,
      'refundAmountCents', locked_claim."refundAmountCents",
      'currency', locked_claim.currency,
      'resolutionMessageId', message_id,
      'stockStatusRestoredCount', 0,
      'status', 'FINALIZED',
      'action', 'replay'
    );
  END IF;

  IF locked_order."caseResolutionClaimId"
       IS DISTINCT FROM locked_claim.id
     OR locked_case.status IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     OR locked_case."resolvedAt" IS NOT NULL
     OR (
       locked_claim.resolution = 'DISMISSED'::public."CaseResolution"
       AND locked_claim.status <>
             'LOCAL_READY'::public."CaseResolutionClaimStatus"
     )
     OR (
       locked_claim.resolution IN (
         'REFUND_FULL'::public."CaseResolution",
         'REFUND_PARTIAL'::public."CaseResolution"
       )
       AND locked_claim.status <>
             'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
     ) THEN
    RAISE EXCEPTION 'Case resolution claim is not finalizable'
      USING ERRCODE = '23514';
  END IF;

  IF locked_claim."orderPaymentEventId" IS NOT NULL THEN
    SELECT
      payment_event.id,
      payment_event."orderId",
      payment_event."stripeObjectId",
      payment_event."stripeObjectType",
      payment_event."eventType",
      payment_event."amountCents",
      payment_event.currency,
      payment_event.reason,
      payment_event.metadata
      INTO linked_event
      FROM public."OrderPaymentEvent" AS payment_event
     WHERE payment_event.id = locked_claim."orderPaymentEventId"
       AND payment_event."orderId" = locked_order.id
     FOR SHARE;
    IF NOT FOUND
       OR linked_event."eventType" <> 'REFUND'
       OR linked_event."stripeObjectType" IS DISTINCT FROM 'refund'
       OR linked_event."stripeObjectId"
            IS DISTINCT FROM locked_order."sellerRefundId"
       OR linked_event."amountCents"
            IS DISTINCT FROM locked_claim."refundAmountCents"
       OR linked_event.currency IS DISTINCT FROM locked_claim.currency
       OR linked_event.reason IS DISTINCT FROM 'case_resolution_refund'
       OR linked_event.metadata->>'localAction'
            IS DISTINCT FROM 'CASE_REFUND_RECORDED'
       OR linked_event.metadata->>'resolutionClaimId'
            IS DISTINCT FROM locked_claim.id
       OR locked_order."sellerRefundAmountCents"
            IS DISTINCT FROM locked_claim."refundAmountCents" THEN
      RAISE EXCEPTION 'Case finalization payment evidence is invalid'
        USING ERRCODE = '23514';
    END IF;
    stripe_refund_id := linked_event."stripeObjectId";
  ELSIF locked_claim.resolution <>
          'DISMISSED'::public."CaseResolution" THEN
    RAISE EXCEPTION 'Case finalization refund evidence is absent'
      USING ERRCODE = '23514';
  END IF;

  -- Lock and revalidate the complete current Order-item/listing source graph
  -- before applying any Case transition. The Order lock alone does not stop a
  -- caller with direct OrderItem authority from racing the stock derivation.
  PERFORM item.id
    FROM public."OrderItem" AS item
    JOIN public."Listing" AS listing ON listing.id = item."listingId"
   WHERE item."orderId" = locked_order.id
   ORDER BY item.id, listing.id
   FOR SHARE OF item
   FOR UPDATE OF listing;

  IF EXISTS (
    WITH plan AS (
      SELECT
        input.value->>'listingId' AS listing_id,
        (input.value->>'quantity')::integer AS quantity
      FROM pg_catalog.jsonb_array_elements(
        locked_claim."stockRestorePlan"
      ) AS input(value)
    ),
    purchased AS (
      SELECT
        item."listingId" AS listing_id,
        pg_catalog.sum(item.quantity)::integer AS quantity
      FROM public."OrderItem" AS item
      JOIN public."Listing" AS listing ON listing.id = item."listingId"
      WHERE item."orderId" = locked_order.id
        AND listing."listingType" = 'IN_STOCK'::public."ListingType"
      GROUP BY item."listingId"
    )
    SELECT 1
      FROM plan
      LEFT JOIN purchased USING (listing_id)
     WHERE purchased.listing_id IS NULL
        OR plan.quantity <= 0
        OR plan.quantity > purchased.quantity
  ) THEN
    RAISE EXCEPTION 'Case finalization stock plan no longer validates'
      USING ERRCODE = '23514';
  END IF;

  transition_at := pg_catalog.clock_timestamp()::timestamp(3);
  resolution_message :=
    CASE locked_claim.resolution
      WHEN 'REFUND_FULL'::public."CaseResolution"
        THEN 'Grainline resolved this case with a full refund to the buyer.'
      WHEN 'REFUND_PARTIAL'::public."CaseResolution"
        THEN 'Grainline resolved this case with a partial refund to the buyer.'
      ELSE 'Grainline reviewed this case and dismissed it.'
    END;

  UPDATE public."Case" AS case_row
     SET status = 'RESOLVED'::public."CaseStatus",
         resolution = locked_claim.resolution,
         "refundAmountCents" = locked_claim."refundAmountCents",
         "stripeRefundId" = stripe_refund_id,
         "resolvedAt" = transition_at,
         "resolvedById" = locked_actor.id,
         "buyerMarkedResolved" = false,
         "sellerMarkedResolved" = false,
         "updatedAt" = transition_at
   WHERE case_row.id = locked_case.id
     AND case_row.status NOT IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     AND case_row."resolvedAt" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case finalization transition lost'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public."CaseMessage" (
    id,
    "caseId",
    "authorId",
    "authorKind",
    body,
    "createdAt"
  )
  VALUES (
    message_id,
    locked_case.id,
    locked_actor.id,
    'STAFF'::public."CaseMessageAuthorKind",
    resolution_message,
    transition_at
  );

  FOR plan_entry IN
    SELECT input.value
      FROM pg_catalog.jsonb_array_elements(
        locked_claim."stockRestorePlan"
      ) AS input(value)
     ORDER BY input.value->>'listingId'
  LOOP
    plan_listing_id := plan_entry->>'listingId';
    plan_quantity := (plan_entry->>'quantity')::integer;
    UPDATE public."Listing" AS listing
       SET "stockQuantity" =
             COALESCE(listing."stockQuantity", 0) + plan_quantity,
           status = CASE
             WHEN listing.status =
                    'SOLD_OUT'::public."ListingStatus"
                  AND NOT listing."isPrivate"
               THEN 'ACTIVE'::public."ListingStatus"
             ELSE listing.status
           END,
           "updatedAt" = transition_at
     WHERE listing.id = plan_listing_id
       AND listing."listingType" =
             'IN_STOCK'::public."ListingType";
    GET DIAGNOSTICS changed_count = ROW_COUNT;
    IF changed_count <> 1 THEN
      RAISE EXCEPTION 'Case finalization stock target disappeared'
        USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public."Listing" AS listing
       WHERE listing.id = plan_listing_id
         AND listing.status = 'ACTIVE'::public."ListingStatus"
         AND NOT listing."isPrivate"
    ) THEN
      restored_active_count := restored_active_count + 1;
    END IF;
  END LOOP;

  UPDATE public."Order" AS orders
     SET "reviewNeeded" = true,
         "reviewNote" =
           'Case resolved by fixed staff authority: '
           || locked_claim.resolution::text || '.'
   WHERE orders.id = locked_order.id
     AND orders."caseResolutionClaimId" = locked_claim.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case finalization Order lease was lost'
      USING ERRCODE = '40001';
  END IF;

  audit_id :=
    'case-resolution-admin-audit:'
    || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."AdminAuditLog" (
    id,
    "adminId",
    action,
    "targetType",
    "targetId",
    reason,
    metadata,
    undone,
    "createdAt"
  )
  VALUES (
    audit_id,
    locked_actor.id,
    'RESOLVE_CASE',
    'CASE',
    locked_case.id,
    locked_claim.resolution::text,
    pg_catalog.jsonb_build_object(
      'orderId', locked_order.id,
      'resolutionClaimId', locked_claim.id,
      'resolution', locked_claim.resolution::text,
      'refundAmountCents', locked_claim."refundAmountCents",
      'stripeRefundId', stripe_refund_id,
      'resolutionMessageId', message_id,
      'at', transition_at
    ),
    false,
    transition_at
  );

  UPDATE public."CaseResolutionClaim" AS claim
     SET status = 'FINALIZED'::public."CaseResolutionClaimStatus",
         "finalizedAt" = transition_at,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim.status IN (
       'LOCAL_READY'::public."CaseResolutionClaimStatus",
       'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution claim finalization failed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public."Order" AS orders
     SET "caseResolutionClaimId" = NULL
   WHERE orders.id = locked_order.id
     AND orders."caseResolutionClaimId" = locked_claim.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution claim lease release failed'
      USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'claimId', locked_claim.id,
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'resolution', locked_claim.resolution::text,
    'refundAmountCents', locked_claim."refundAmountCents",
    'currency', locked_claim.currency,
    'resolutionMessageId', message_id,
    'stockStatusRestoredCount', restored_active_count,
    'status', 'FINALIZED',
    'action', 'finalized'
  );
END
$grainline_case_staff_resolution_finalize$;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_finalize(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_finalize(text, text)
  TO grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_reconcile(
  p_actor_user_id text,
  p_resolution_claim_id text,
  p_reconciliation_action text,
  p_reconciliation_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_staff_resolution_reconcile$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  locked_claim record;
  transition_at timestamp(3);
  audit_id text;
  normalized_reason text;
BEGIN
  normalized_reason := pg_catalog.btrim(p_reconciliation_reason);
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_resolution_claim_id IS NULL
     OR pg_catalog.btrim(p_resolution_claim_id) = ''
     OR pg_catalog.char_length(p_resolution_claim_id) > 191
     OR p_reconciliation_action IS NULL
     OR p_reconciliation_action NOT IN (
       'RETRY_EXISTING_SCOPE',
       'CONFIRMED_NO_PROVIDER_EFFECT'
     )
     OR normalized_reason IS NULL
     OR normalized_reason = ''
     OR pg_catalog.char_length(normalized_reason) > 1000 THEN
    RAISE EXCEPTION 'Case reconciliation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.id,
    actor.role,
    actor.banned,
    actor."deletedAt"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL
     OR locked_actor.role <> 'ADMIN'::public."Role" THEN
    RAISE EXCEPTION 'Case reconciliation requires a current ADMIN'
      USING ERRCODE = '42501';
  END IF;

  SELECT claim."orderId"
    INTO source_order_id
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case resolution claim does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."caseResolutionClaimId",
    orders."sellerRefundId",
    orders."sellerRefundLockedAt"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case reconciliation Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row.status,
    case_row."resolvedAt"
    INTO locked_case
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case reconciliation Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    claim.id,
    claim."caseId",
    claim."orderId",
    claim.status,
    claim."idempotencyScope",
    claim."orderPaymentEventId"
    INTO locked_claim
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id
     AND claim."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_claim."caseId" IS DISTINCT FROM locked_case.id
     OR locked_order."caseResolutionClaimId"
          IS DISTINCT FROM locked_claim.id
     OR locked_claim."orderPaymentEventId" IS NOT NULL THEN
    RAISE EXCEPTION 'Case reconciliation claim authority is invalid'
      USING ERRCODE = '23514';
  END IF;

  transition_at := pg_catalog.clock_timestamp()::timestamp(3);
  audit_id :=
    'case-resolution-reconcile-audit:'
    || pg_catalog.gen_random_uuid()::text;

  IF p_reconciliation_action = 'RETRY_EXISTING_SCOPE' THEN
    IF locked_claim.status <>
         'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
       OR locked_order."sellerRefundId" <>
            'ambiguous_refund_pending_reconciliation'
       OR locked_case.status IN (
         'RESOLVED'::public."CaseStatus",
         'CLOSED'::public."CaseStatus"
       )
       OR locked_case."resolvedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Case reconciliation claim is not retryable'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public."Order" AS orders
       SET "sellerRefundId" = 'pending',
           "sellerRefundLockedAt" = transition_at,
           "reviewNeeded" = true,
           "reviewNote" =
             'Staff approved retry with the existing Case refund '
             || 'idempotency scope.'
     WHERE orders.id = locked_order.id
       AND orders."caseResolutionClaimId" = locked_claim.id
       AND orders."sellerRefundId" =
             'ambiguous_refund_pending_reconciliation';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case reconciliation retry lease was lost'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public."CaseResolutionClaim" AS claim
       SET status =
             'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
           "updatedAt" = transition_at
     WHERE claim.id = locked_claim.id
       AND claim.status =
             'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case reconciliation retry transition failed'
        USING ERRCODE = '40001';
    END IF;

    INSERT INTO public."AdminAuditLog" (
      id,
      "adminId",
      action,
      "targetType",
      "targetId",
      reason,
      metadata,
      undone,
      "createdAt"
    )
    VALUES (
      audit_id,
      locked_actor.id,
      'RETRY_CASE_RESOLUTION_PROVIDER_SCOPE',
      'CASE_RESOLUTION_CLAIM',
      locked_claim.id,
      normalized_reason,
      pg_catalog.jsonb_build_object(
        'caseId', locked_case.id,
        'orderId', locked_order.id,
        'idempotencyScope', locked_claim."idempotencyScope"
      ),
      false,
      transition_at
    );

    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_claim.id,
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'idempotencyScope', locked_claim."idempotencyScope",
      'status', 'PROVIDER_PENDING',
      'action', 'retry'
    );
  END IF;

  IF locked_claim.status NOT IN (
       'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
       'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
     )
     OR locked_order."sellerRefundId" NOT IN (
       'pending',
       'ambiguous_refund_pending_reconciliation'
     ) THEN
    RAISE EXCEPTION 'Case reconciliation claim cannot be released'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public."CaseResolutionClaim" AS claim
     SET status =
           'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus",
         "reconciledAt" = transition_at,
         "reconciledById" = locked_actor.id,
         "reconciliationAction" = 'CONFIRMED_NO_PROVIDER_EFFECT',
         "reconciliationReason" = normalized_reason,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim.status IN (
       'PROVIDER_PENDING'::public."CaseResolutionClaimStatus",
       'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
     )
     AND claim."orderPaymentEventId" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case reconciliation release transition failed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public."Order" AS orders
     SET "caseResolutionClaimId" = NULL,
         "sellerRefundId" = NULL,
         "sellerRefundLockedAt" = NULL,
         "reviewNeeded" = true,
         "reviewNote" =
           'An administrator confirmed that the staged Case refund had '
           || 'no provider effect; the claim was released.'
   WHERE orders.id = locked_order.id
     AND orders."caseResolutionClaimId" = locked_claim.id
     AND orders."sellerRefundId" IN (
       'pending',
       'ambiguous_refund_pending_reconciliation'
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case reconciliation Order release failed'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public."AdminAuditLog" (
    id,
    "adminId",
    action,
    "targetType",
    "targetId",
    reason,
    metadata,
    undone,
    "createdAt"
  )
  VALUES (
    audit_id,
    locked_actor.id,
    'RELEASE_CASE_RESOLUTION_NO_PROVIDER_EFFECT',
    'CASE_RESOLUTION_CLAIM',
    locked_claim.id,
    normalized_reason,
    pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'idempotencyScope', locked_claim."idempotencyScope"
    ),
    false,
    transition_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'claimId', locked_claim.id,
    'caseId', locked_case.id,
    'orderId', locked_order.id,
    'idempotencyScope', locked_claim."idempotencyScope",
    'status', 'RELEASED_NO_PROVIDER_EFFECT',
    'action', 'released'
  );
END
$grainline_case_staff_resolution_reconcile$;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_reconcile(
    text,
    text,
    text,
    text
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_reconcile(
    text,
    text,
    text,
    text
  )
  TO grainline_app_runtime;

COMMIT;
