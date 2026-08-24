-- Compatible recovery for an in-flight seller refund after the seller
-- becomes banned or soft-deleted. Authority is derived only from the exact
-- immutable ADMIN reconciliation row; no caller supplies a recovery target.

BEGIN;

DO $grainline_order_refund_inactive_seller_recovery_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."OrderRefundReconciliation"') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_refund_record(text,text,bigint,text,text,text,integer)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_case_seller_refund_apply(text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'Inactive seller refund recovery prerequisites are missing'
      USING ERRCODE = 'undefined_function';
  END IF;
END
$grainline_order_refund_inactive_seller_recovery_preflight$;

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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case seller-refund actor does not exist'
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

  -- Inactive sellers cannot initiate or normally finalize refunds. Permit
  -- only the already-authorized first local record whose exact claim and
  -- source are preserved in immutable ADMIN reconciliation evidence.
  IF locked_actor.banned OR locked_actor."deletedAt" IS NOT NULL THEN
    PERFORM 1
      FROM public."OrderRefundReconciliation" AS reconciliation
      JOIN public."User" AS administrator
        ON administrator.id = reconciliation."actorUserId"
     WHERE reconciliation."orderId" = locked_order.id
       AND reconciliation."claimId"
             = source_event.metadata->>'refundClaimId'
       AND reconciliation."claimGeneration"::text
             = source_event.metadata->>'refundClaimGeneration'
       AND reconciliation."claimSource" = 'SELLER'
       AND reconciliation."claimSourceId" = locked_actor.id
       AND reconciliation."claimSourceGeneration" IS NULL
       AND reconciliation.action IN (
         'RETRY_EXISTING_SCOPE',
         'CONFIRMED_PROVIDER_EFFECT'
       )
       AND source_event.metadata->>'refundClaimSource' = 'SELLER'
       AND source_event.metadata->>'refundClaimSourceId' = locked_actor.id
       AND source_event.metadata->>'refundClaimSourceGeneration' IS NULL
       AND administrator.role = 'ADMIN'::public."Role"
       AND NOT administrator.banned
       AND administrator."deletedAt" IS NULL
     FOR SHARE OF reconciliation, administrator;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Inactive Case seller-refund lacks exact ADMIN reconciliation'
        USING ERRCODE = '42501';
    END IF;
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

CREATE OR REPLACE FUNCTION public.grainline_seller_refund_record(
  p_actor_user_id text,
  p_claim_id text,
  p_claim_generation bigint,
  p_refund_id text,
  p_refund_status text,
  p_transfer_reversal_id text,
  p_transfer_reversal_amount_cents integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_refund_record$
DECLARE
  locked_actor public."User"%ROWTYPE;
  locked_seller public."SellerProfile"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  existing_event public."OrderPaymentEvent"%ROWTYPE;
  case_result record;
  stock_restore record;
  transition_at timestamp(3) without time zone;
  event_key text;
  payment_event_id text;
  audit_id text;
  refund_amount integer;
  seller_portion integer;
  original_transfer_amount integer;
  expected_transfer_reversal boolean;
  requires_manual_transfer_reconciliation boolean;
  requires_manual_follow_up boolean;
  platform_funded_refund_cents integer;
  refund_accounting jsonb;
  event_metadata jsonb;
  review_note text;
  restored_active_listing_count integer := 0;
  reactivated_count integer := 0;
  case_action text := 'no_case';
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_claim_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_claim_id)) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_refund_id IS NULL
     OR p_refund_id !~ '^re_[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_refund_id) > 220
     OR (
       p_refund_status IS NOT NULL
       AND p_refund_status NOT IN ('pending', 'requires_action', 'succeeded')
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
         OR p_transfer_reversal_id IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Seller refund provider evidence is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Serialize exact retries before checking the local Stripe evidence key.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    824021,
    pg_catalog.hashtext(p_claim_id)
  );
  event_key := 'local:seller_refund_recorded:' || p_refund_id;

  SELECT payment_event.*
    INTO existing_event
    FROM public."OrderPaymentEvent" AS payment_event
   WHERE payment_event."stripeEventId" = event_key
   FOR SHARE;
  IF FOUND THEN
    SELECT orders.*
      INTO locked_order
      FROM public."Order" AS orders
     WHERE orders.id = existing_event."orderId"
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Seller refund replay Order is missing'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    refund_amount :=
        locked_order."itemsSubtotalCents"
      + locked_order."shippingAmountCents"
      + COALESCE(locked_order."giftWrappingPriceCents", 0)
      + locked_order."taxAmountCents";
    seller_portion :=
        locked_order."itemsSubtotalCents"
      + locked_order."shippingAmountCents"
      + COALESCE(locked_order."giftWrappingPriceCents", 0);
    original_transfer_amount := seller_portion
      - pg_catalog.round(
          locked_order."itemsSubtotalCents"::numeric * 0.05::numeric
        )::integer;
    expected_transfer_reversal :=
      locked_order."stripeTransferId" IS NOT NULL AND seller_portion > 0;
    requires_manual_transfer_reconciliation :=
      locked_order."stripeTransferId" IS NULL;
    requires_manual_follow_up :=
      pg_catalog.lower(COALESCE(p_refund_status, ''))
        IN ('pending', 'requires_action');
    platform_funded_refund_cents := CASE
      WHEN p_transfer_reversal_amount_cents IS NOT NULL
        THEN GREATEST(
          0,
          refund_amount - p_transfer_reversal_amount_cents
        )
      WHEN expected_transfer_reversal THEN NULL
      ELSE refund_amount
    END;
    refund_accounting := pg_catalog.jsonb_build_object(
      'buyerRefundAmountCents', refund_amount,
      'chargeAmountCents', refund_amount,
      'originalTransferAmountCents', original_transfer_amount,
      'expectedTransferReversal', expected_transfer_reversal,
      'transferReversalId', p_transfer_reversal_id,
      'transferReversalAmountCents', p_transfer_reversal_amount_cents,
      'platformFundedRefundCents', platform_funded_refund_cents
    );
    event_metadata := pg_catalog.jsonb_build_object(
      'localAction', 'SELLER_REFUND_RECORDED',
      'refundType', 'FULL',
      'refundIds', pg_catalog.jsonb_build_array(p_refund_id),
      'refundStatuses', pg_catalog.jsonb_build_array(p_refund_status),
      'notificationBody',
        'Your maker issued a refund of '
        || pg_catalog.to_char(
          refund_amount::numeric / 100::numeric,
          'FM999999990.00'
        )
        || ' '
        || pg_catalog.upper(locked_order.currency)
        || ' for your order.',
      'refundAccounting', refund_accounting,
      'requiresManualTransferReconciliation',
        requires_manual_transfer_reconciliation,
      'requiresManualFollowUp', requires_manual_follow_up,
      'refundClaimId', p_claim_id,
      'refundClaimGeneration', p_claim_generation::text,
      'refundClaimSource', 'SELLER',
      'refundClaimSourceId', p_actor_user_id,
      'refundClaimSourceGeneration', NULL
    );

    IF NOT EXISTS (
         SELECT 1
           FROM public."SellerProfile" AS replay_seller
          WHERE replay_seller.id = locked_order."sellerProfileId"
            AND replay_seller."userId" = p_actor_user_id
       )
       OR locked_order."sellerRefundId" IS DISTINCT FROM p_refund_id
       OR locked_order."sellerRefundAmountCents" IS DISTINCT FROM refund_amount
       OR locked_order."sellerRefundLockedAt" IS NOT NULL
       OR existing_event."stripeObjectId" IS DISTINCT FROM p_refund_id
       OR existing_event."stripeObjectType" IS DISTINCT FROM 'refund'
       OR existing_event."eventType" IS DISTINCT FROM 'REFUND'
       OR existing_event."amountCents" IS DISTINCT FROM refund_amount
       OR existing_event.currency IS DISTINCT FROM pg_catalog.lower(locked_order.currency)
       OR existing_event.status IS DISTINCT FROM p_refund_status
       OR existing_event.reason IS DISTINCT FROM 'seller_refund'
       OR existing_event.metadata - 'restoredActiveListingCount'
            IS DISTINCT FROM event_metadata
       OR pg_catalog.jsonb_typeof(
            existing_event.metadata->'restoredActiveListingCount'
          ) IS DISTINCT FROM 'number'
       OR (existing_event.metadata->>'restoredActiveListingCount')::integer < 0
       OR (
         expected_transfer_reversal
         AND (
           p_transfer_reversal_id IS NULL
           OR p_transfer_reversal_amount_cents
                IS DISTINCT FROM original_transfer_amount
         )
       )
       OR (
         NOT expected_transfer_reversal
         AND (
           p_transfer_reversal_id IS NOT NULL
           OR p_transfer_reversal_amount_cents IS NOT NULL
         )
       ) THEN
      RAISE EXCEPTION 'Seller refund replay evidence drifted'
        USING ERRCODE = 'unique_violation';
    END IF;

    SELECT application.action
      INTO case_action
      FROM public."CaseSellerRefundApplication" AS application
     WHERE application."paymentEventId" = existing_event.id;
    RETURN pg_catalog.jsonb_build_object(
      'orderId', locked_order.id,
      'buyerUserId', locked_order."buyerId",
      'paymentEventId', existing_event.id,
      'refundId', p_refund_id,
      'refundAmountCents', refund_amount,
      'caseAction', COALESCE(case_action, 'no_case'),
      'restoredActiveListingCount',
        (existing_event.metadata->>'restoredActiveListingCount')::integer,
      'action', 'replay'
    );
  END IF;

  -- Mutable actor posture is required only while creating new evidence. An
  -- exact replay remains available after account-state changes because the
  -- committed event already binds the actor, Order and provider evidence.
  SELECT actor.*
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller refund record actor does not exist'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT seller.*
    INTO locked_seller
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = locked_actor.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller refund record actor has no seller profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders."refundClaimId" = p_claim_id
     AND orders."refundClaimGeneration" = p_claim_generation
   FOR UPDATE;
  IF NOT FOUND
     OR locked_order."sellerProfileId" IS DISTINCT FROM locked_seller.id
     OR locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
     OR locked_order."refundClaimSource" IS DISTINCT FROM 'SELLER'
     OR locked_order."refundClaimSourceId" IS DISTINCT FROM locked_actor.id
     OR locked_order."refundClaimSourceGeneration" IS NOT NULL
     OR locked_order."refundClaimProviderAuthorizedAt" IS NULL THEN
    RAISE EXCEPTION 'Seller refund record claim is no longer active'
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- Do not weaken ordinary seller finalization. A banned or soft-deleted
  -- seller reaches the first local record only after a current ADMIN has
  -- committed one exact immutable reconciliation for this claim generation.
  IF locked_actor.banned OR locked_actor."deletedAt" IS NOT NULL THEN
    PERFORM 1
      FROM public."OrderRefundReconciliation" AS reconciliation
      JOIN public."User" AS administrator
        ON administrator.id = reconciliation."actorUserId"
     WHERE reconciliation."orderId" = locked_order.id
       AND reconciliation."claimId" = p_claim_id
       AND reconciliation."claimGeneration" = p_claim_generation
       AND reconciliation."claimSource" = 'SELLER'
       AND reconciliation."claimSourceId" = locked_actor.id
       AND reconciliation."claimSourceGeneration" IS NULL
       AND reconciliation."idempotencyScope"
             = locked_order."refundClaimIdempotencyScope"
       AND reconciliation.action IN (
         'RETRY_EXISTING_SCOPE',
         'CONFIRMED_PROVIDER_EFFECT'
       )
       AND administrator.role = 'ADMIN'::public."Role"
       AND NOT administrator.banned
       AND administrator."deletedAt" IS NULL
     FOR SHARE OF reconciliation, administrator;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Inactive seller refund lacks exact ADMIN reconciliation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  refund_amount :=
      locked_order."itemsSubtotalCents"
    + locked_order."shippingAmountCents"
    + COALESCE(locked_order."giftWrappingPriceCents", 0)
    + locked_order."taxAmountCents";
  seller_portion :=
      locked_order."itemsSubtotalCents"
    + locked_order."shippingAmountCents"
    + COALESCE(locked_order."giftWrappingPriceCents", 0);
  IF refund_amount <= 0
     OR p_transfer_reversal_amount_cents > refund_amount THEN
    RAISE EXCEPTION 'Seller refund accounting evidence is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  original_transfer_amount := seller_portion
    - pg_catalog.round(
        locked_order."itemsSubtotalCents"::numeric * 0.05::numeric
      )::integer;
  expected_transfer_reversal :=
    locked_order."stripeTransferId" IS NOT NULL AND seller_portion > 0;
  IF expected_transfer_reversal
     AND (
       p_transfer_reversal_id IS NULL
       OR p_transfer_reversal_amount_cents
            IS DISTINCT FROM original_transfer_amount
     ) THEN
    RAISE EXCEPTION 'Seller refund reversal evidence is missing or mismatched'
      USING ERRCODE = 'check_violation';
  ELSIF NOT expected_transfer_reversal
     AND (
       p_transfer_reversal_id IS NOT NULL
       OR p_transfer_reversal_amount_cents IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Seller refund has unexpected transfer-reversal evidence'
      USING ERRCODE = 'check_violation';
  END IF;
  requires_manual_transfer_reconciliation :=
    locked_order."stripeTransferId" IS NULL;
  requires_manual_follow_up :=
    pg_catalog.lower(COALESCE(p_refund_status, ''))
      IN ('pending', 'requires_action');
  platform_funded_refund_cents := CASE
    WHEN p_transfer_reversal_amount_cents IS NOT NULL
      THEN GREATEST(
        0,
        refund_amount - p_transfer_reversal_amount_cents
      )
    WHEN expected_transfer_reversal THEN NULL
    ELSE refund_amount
  END;
  refund_accounting := pg_catalog.jsonb_build_object(
    'buyerRefundAmountCents', refund_amount,
    'chargeAmountCents', refund_amount,
    'originalTransferAmountCents', original_transfer_amount,
    'expectedTransferReversal', expected_transfer_reversal,
    'transferReversalId', p_transfer_reversal_id,
    'transferReversalAmountCents', p_transfer_reversal_amount_cents,
    'platformFundedRefundCents', platform_funded_refund_cents
  );
  event_metadata := pg_catalog.jsonb_build_object(
    'localAction', 'SELLER_REFUND_RECORDED',
    'refundType', 'FULL',
    'refundIds', pg_catalog.jsonb_build_array(p_refund_id),
    'refundStatuses', pg_catalog.jsonb_build_array(p_refund_status),
    'notificationBody',
      'Your maker issued a refund of '
      || pg_catalog.to_char(
        refund_amount::numeric / 100::numeric,
        'FM999999990.00'
      )
      || ' '
      || pg_catalog.upper(locked_order.currency)
      || ' for your order.',
    'refundAccounting', refund_accounting,
    'requiresManualTransferReconciliation',
      requires_manual_transfer_reconciliation,
    'requiresManualFollowUp', requires_manual_follow_up,
    'refundClaimId', p_claim_id,
    'refundClaimGeneration', p_claim_generation::text,
    'refundClaimSource', 'SELLER',
    'refundClaimSourceId', p_actor_user_id,
    'refundClaimSourceGeneration', NULL
  );
  transition_at := (
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3);
  review_note := pg_catalog.format(
    'Seller-initiated full refund of %s cents via Stripe refund %s.%s%s',
    refund_amount,
    p_refund_id,
    CASE
      WHEN requires_manual_transfer_reconciliation
        THEN ' Seller transfer reversal requires manual reconciliation.'
      ELSE ''
    END,
    CASE
      WHEN requires_manual_follow_up
        THEN ' Stripe refund status requires manual follow-up.'
      ELSE ''
    END
  );

  payment_event_id :=
    'seller-refund-payment:' || pg_catalog.gen_random_uuid()::text;
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
    event_key,
    p_refund_id,
    'refund',
    'REFUND',
    refund_amount,
    pg_catalog.lower(locked_order.currency),
    p_refund_status,
    'seller_refund',
    review_note,
    event_metadata,
    transition_at,
    transition_at
  );

  UPDATE public."Order" AS orders
     SET "sellerRefundId" = p_refund_id,
         "sellerRefundAmountCents" = refund_amount,
         "sellerRefundLockedAt" = NULL,
         "refundClaimId" = NULL,
         "refundClaimSource" = NULL,
         "refundClaimSourceId" = NULL,
         "refundClaimSourceGeneration" = NULL,
         "refundClaimIdempotencyScope" = NULL,
         "refundClaimProviderAuthorizedAt" = NULL,
         "reviewNeeded" = true,
         "reviewNote" = review_note
   WHERE orders.id = locked_order.id
     AND orders."refundClaimId" = p_claim_id
     AND orders."refundClaimGeneration" = p_claim_generation
     AND orders."sellerRefundId" = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller refund record lost its active generation'
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT applied.*
    INTO case_result
    FROM public.grainline_case_seller_refund_apply(
      locked_actor.id,
      payment_event_id
    ) AS applied;
  IF NOT FOUND
     OR case_result.action NOT IN ('resolve', 'terminal', 'no_case', 'replay')
     OR case_result."orderId" IS DISTINCT FROM locked_order.id
     OR case_result."paymentEventId" IS DISTINCT FROM payment_event_id THEN
    RAISE EXCEPTION 'Seller refund Case application failed closed'
      USING ERRCODE = 'serialization_failure';
  END IF;
  case_action := case_result.action;

  IF requires_manual_transfer_reconciliation THEN
    UPDATE public."SellerProfile" AS seller
       SET "manualStripeReconciliationNeeded" = true,
           "manualStripeReconciliationNote" =
             'Seller refund used a platform-only Stripe refund; staff must reconcile the seller transfer manually.',
           "updatedAt" = transition_at
     WHERE seller.id = locked_seller.id;
  END IF;

  IF case_action = 'terminal' THEN
    UPDATE public."Order" AS orders
       SET "reviewNote" = review_note
         || ' Case auto-resolution did not update because Case state changed; staff must reconcile it manually.'
     WHERE orders.id = locked_order.id;
  END IF;

  IF locked_order."fulfillmentStatus"::text
       NOT IN ('SHIPPED', 'DELIVERED', 'PICKED_UP') THEN
    PERFORM item.id
      FROM public."OrderItem" AS item
     WHERE item."orderId" = locked_order.id
     ORDER BY item.id
     FOR SHARE;
    PERFORM listing.id
      FROM public."Listing" AS listing
     WHERE listing.id IN (
       SELECT item."listingId"
         FROM public."OrderItem" AS item
        WHERE item."orderId" = locked_order.id
     )
     ORDER BY listing.id
     FOR UPDATE;

    FOR stock_restore IN
      SELECT item."listingId" AS listing_id,
             pg_catalog.sum(item.quantity)::integer AS quantity
        FROM public."OrderItem" AS item
        JOIN public."Listing" AS listing
          ON listing.id = item."listingId"
       WHERE item."orderId" = locked_order.id
         AND listing."listingType"::text = 'IN_STOCK'
       GROUP BY item."listingId"
       ORDER BY item."listingId"
    LOOP
      UPDATE public."Listing" AS listing
         SET "stockQuantity" = COALESCE(listing."stockQuantity", 0)
               + stock_restore.quantity,
             "updatedAt" = transition_at
       WHERE listing.id = stock_restore.listing_id
         AND listing."listingType"::text = 'IN_STOCK';

      UPDATE public."Listing" AS listing
         SET status = 'ACTIVE'::public."ListingStatus",
             "updatedAt" = transition_at
       WHERE listing.id = stock_restore.listing_id
         AND listing."listingType"::text = 'IN_STOCK'
         AND listing.status::text = 'SOLD_OUT'
         AND listing."stockQuantity" > 0
         AND NOT listing."isPrivate";
      GET DIAGNOSTICS reactivated_count = ROW_COUNT;
      restored_active_listing_count :=
        restored_active_listing_count + reactivated_count;
    END LOOP;
  END IF;

  UPDATE public."OrderPaymentEvent" AS payment_event
     SET metadata = pg_catalog.jsonb_set(
           payment_event.metadata,
           '{restoredActiveListingCount}',
           pg_catalog.to_jsonb(restored_active_listing_count),
           true
         ),
         "updatedAt" = transition_at
   WHERE payment_event.id = payment_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller refund payment event disappeared before finalization'
      USING ERRCODE = 'serialization_failure';
  END IF;

  audit_id := 'seller-refund-audit:' || pg_catalog.gen_random_uuid()::text;
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
    locked_actor.id,
    'SELLER_REFUND_RECORDED',
    'ORDER',
    locked_order.id,
    'seller_refund',
    pg_catalog.jsonb_build_object(
      'orderPaymentEventId', payment_event_id,
      'stripeRefundId', p_refund_id,
      'refundIds', pg_catalog.jsonb_build_array(p_refund_id),
      'amountCents', refund_amount,
      'currency', pg_catalog.lower(locked_order.currency),
      'refundAccounting', refund_accounting,
      'refundClaimId', p_claim_id,
      'refundClaimGeneration', p_claim_generation::text,
      'restoredActiveListingCount', restored_active_listing_count
    ),
    transition_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'orderId', locked_order.id,
    'buyerUserId', locked_order."buyerId",
    'paymentEventId', payment_event_id,
    'refundId', p_refund_id,
    'refundAmountCents', refund_amount,
    'caseAction', case_action,
    'restoredActiveListingCount', restored_active_listing_count,
    'action', 'recorded'
  );
END
$grainline_seller_refund_record$;

REVOKE ALL ON FUNCTION
  public.grainline_case_seller_refund_apply(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_seller_refund_apply(text, text)
  TO grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_seller_refund_record(
    text,
    text,
    bigint,
    text,
    text,
    text,
    integer
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_refund_record(
    text,
    text,
    bigint,
    text,
    text,
    text,
    integer
  )
  TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_seller_refund_record(
  text, text, bigint, text, text, text, integer
) IS
  'Records a seller refund; inactive first-write recovery requires exact immutable ADMIN reconciliation evidence.';
COMMENT ON FUNCTION public.grainline_case_seller_refund_apply(text, text) IS
  'Applies seller-refund Case effects; inactive sources require exact immutable ADMIN reconciliation evidence.';

COMMIT;
