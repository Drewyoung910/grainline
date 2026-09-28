-- Prevent a staff Case refund from starting while a Shippo label
-- provider claim is active or has recorded a purchase. Both authorities lock
-- the same Order row; this replacement makes the staff path inspect the
-- locked label-claim state before any Stripe refund reservation is created.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.case.staff-refund-label-claim.correction',
    0
  )
);

DO $grainline_case_staff_refund_label_claim_preflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (
        VALUES
          ('public.grainline_case_staff_resolution_prepare(text,text,public."CaseResolution",integer,jsonb)',
           'c433e9d779eb6f482ab7ed34ee9d341220dec8a426f69e1954fa1002167b49ae'),
          ('public.grainline_case_staff_resolution_reconcile(text,text,text,text)',
           '20407470f8702837f7f98bab8a5ce684e084cc067d07ea0db013f7011b8e39a2')
      ) AS expected_functions(identity, source_sha256)
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Case predecessor function % is missing',
        expected.identity;
    END IF;

    SELECT pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(routine.prosrc, 'UTF8')
             ),
             'hex'
           )
      INTO actual_hash
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = function_oid
       AND routine.prosecdef
       AND routine.provolatile = 'v'
       AND routine.proparallel = 'u'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];

    IF actual_hash IS DISTINCT FROM expected.source_sha256 THEN
      RAISE EXCEPTION 'Case predecessor function % drifted',
        expected.identity;
    END IF;

    IF NOT pg_catalog.has_function_privilege(
         'grainline_app_runtime', function_oid, 'EXECUTE'
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
          WHERE routine.oid = function_oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Case predecessor grant posture % drifted',
        expected.identity;
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = 'public."Order"'::pg_catalog.regclass
          AND attribute.attname = 'labelClaimStatus'
          AND attribute.atttypid = 'pg_catalog.varchar'::pg_catalog.regtype
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
                = 'character varying(32)'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.conrelid =
                'public."Order"'::pg_catalog.regclass
          AND constraint_state.conname = 'Order_labelClaimStatus_check'
          AND constraint_state.contype = 'c'
          AND constraint_state.convalidated
     ) THEN
    RAISE EXCEPTION 'Order label-claim state contract is missing';
  END IF;
END
$grainline_case_staff_refund_label_claim_preflight$;

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
    orders."labelClaimStatus",
    orders."fulfillmentStatus",
    orders."paymentOpenDisputeBlocked",
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
      claim."idempotencyScope",
      claim."orderPaymentEventId"
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

    IF existing_claim.status =
         'PROVIDER_PENDING'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution NOT IN (
           'REFUND_FULL'::public."CaseResolution",
           'REFUND_PARTIAL'::public."CaseResolution"
         )
         OR locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
         OR locked_order."sellerRefundLockedAt" IS NULL
         OR existing_claim."orderPaymentEventId" IS NOT NULL
         OR locked_order."stripePaymentIntentId" IS NULL
         OR pg_catalog.btrim(locked_order."stripePaymentIntentId") = ''
         OR locked_order."labelStatus" = 'PURCHASED'::public."LabelStatus"
         OR locked_order."labelClaimStatus" IN (
           'PROVIDER_PENDING',
           'PROVIDER_AMBIGUOUS',
           'PROVIDER_RECORDED'
         )
         OR locked_order."paymentOpenDisputeBlocked"
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
        RAISE EXCEPTION
          'Case staff-resolution replay is no longer refund-eligible'
          USING ERRCODE = '23514';
      END IF;
    ELSIF existing_claim.status =
            'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution NOT IN (
           'REFUND_FULL'::public."CaseResolution",
           'REFUND_PARTIAL'::public."CaseResolution"
         )
         OR existing_claim."orderPaymentEventId" IS NULL
         OR locked_order."sellerRefundId" IS NULL
         OR locked_order."sellerRefundId" = 'pending'
         OR locked_order."sellerRefundLockedAt" IS NOT NULL THEN
        RAISE EXCEPTION
          'Case staff-resolution recorded replay evidence is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSIF existing_claim.status =
            'LOCAL_READY'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution <>
           'DISMISSED'::public."CaseResolution"
         OR existing_claim."orderPaymentEventId" IS NOT NULL
         OR locked_order."sellerRefundId" IS NOT NULL
         OR locked_order."sellerRefundLockedAt" IS NOT NULL THEN
        RAISE EXCEPTION
          'Case staff-resolution local replay evidence is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSIF existing_claim.status =
            'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus" THEN
      IF existing_claim.resolution NOT IN (
           'REFUND_FULL'::public."CaseResolution",
           'REFUND_PARTIAL'::public."CaseResolution"
         )
         OR existing_claim."orderPaymentEventId" IS NOT NULL
         OR locked_order."sellerRefundId" IS DISTINCT FROM
              'ambiguous_refund_pending_reconciliation'
         OR locked_order."sellerRefundLockedAt" IS NOT NULL THEN
        RAISE EXCEPTION
          'Case staff-resolution reconciliation replay evidence is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Case staff-resolution replay status is invalid'
        USING ERRCODE = '23514';
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
       OR locked_order."labelClaimStatus" IN (
         'PROVIDER_PENDING',
         'PROVIDER_AMBIGUOUS',
         'PROVIDER_RECORDED'
       )
       OR locked_order."paymentOpenDisputeBlocked"
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

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
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
    orders."sellerRefundLockedAt",
    orders."labelStatus",
    orders."labelClaimStatus"
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

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
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
       OR locked_case."resolvedAt" IS NOT NULL
       OR locked_order."labelStatus" =
            'PURCHASED'::public."LabelStatus"
       OR locked_order."labelClaimStatus" IN (
         'PROVIDER_PENDING',
         'PROVIDER_AMBIGUOUS',
         'PROVIDER_RECORDED'
       ) THEN
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
  public.grainline_case_staff_resolution_prepare(text, text, public."CaseResolution", integer, jsonb)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_prepare(text, text, public."CaseResolution", integer, jsonb)
  TO grainline_app_runtime;

COMMENT ON FUNCTION
  public.grainline_case_staff_resolution_prepare(text, text, public."CaseResolution", integer, jsonb) IS
  'Prepares a fixed staff Case resolution after locking the Order; refund resolutions reject active or recorded shipping-label provider claims.';

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_reconcile(text, text, text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_reconcile(text, text, text, text)
  TO grainline_app_runtime;

COMMENT ON FUNCTION
  public.grainline_case_staff_resolution_reconcile(text, text, text, text) IS
  'Reconciles a staff Case refund claim; retries reject active or recorded shipping-label provider claims while no-effect releases remain available.';

DO $grainline_case_staff_refund_label_claim_postflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (
        VALUES
          ('public.grainline_case_staff_resolution_prepare(text,text,public."CaseResolution",integer,jsonb)',
           '1f2786a3676e23af23848fab06e829a69bc7cd51bc25274e5569d9f5bc21c5a9'),
          ('public.grainline_case_staff_resolution_reconcile(text,text,text,text)',
           '2b70cb728df1471f68ebf63b98489d33c4b3de56a9250ad3b87e01a1133851d6')
      ) AS expected_functions(identity, source_sha256)
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    SELECT pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(routine.prosrc, 'UTF8')
             ),
             'hex'
           )
      INTO actual_hash
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = function_oid
       AND routine.prosecdef
       AND routine.provolatile = 'v'
       AND routine.proparallel = 'u'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[];

    IF actual_hash IS DISTINCT FROM expected.source_sha256
       OR NOT pg_catalog.has_function_privilege(
         'grainline_app_runtime', function_oid, 'EXECUTE'
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
          WHERE routine.oid = function_oid
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Corrected Case function % drifted', expected.identity;
    END IF;
  END LOOP;
END
$grainline_case_staff_refund_label_claim_postflight$;

COMMIT;
