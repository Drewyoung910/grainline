-- Compatible fixed record/finalize authority for the two generation-fenced
-- Order refund families. This release leaves Order and OrderPaymentEvent RLS
-- plus predecessor table grants unchanged so old and new deployments coexist.

BEGIN;

-- A failed webhook attempt clears its event lease; the next signed retry owns
-- a higher event generation. Preserve the already-authorized Stripe
-- idempotency claim only when the immutable event/session/Order source is
-- identical, and atomically hand that claim to the current lease generation.
CREATE FUNCTION public.grainline_blocked_checkout_refund_claim_resume(
  p_event_id text,
  p_event_claim_generation bigint,
  p_session_id text,
  p_order_id text,
  p_expected_amount_cents integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_blocked_checkout_refund_claim_resume$
DECLARE
  locked_event public."StripeWebhookEvent"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  claim_amount integer;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_event_claim_generation IS NULL OR p_event_claim_generation < 1
     OR p_session_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_session_id)) NOT BETWEEN 1 AND 255
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191
     OR p_expected_amount_cents IS NULL OR p_expected_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Blocked-checkout refund resume input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT source_event.*
    INTO locked_event
    FROM public."StripeWebhookEvent" AS source_event
   WHERE source_event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_event.type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR locked_event."claimGeneration" IS DISTINCT FROM p_event_claim_generation
     OR locked_event."processingStartedAt" IS NULL
     OR locked_event."processedAt" IS NOT NULL
     OR locked_event."sourceObjectId" IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'Blocked-checkout refund resume source lease is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND OR locked_order."stripeSessionId" IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'Blocked-checkout refund resume Order source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  claim_amount :=
      locked_order."itemsSubtotalCents"
    + locked_order."shippingAmountCents"
    + COALESCE(locked_order."giftWrappingPriceCents", 0)
    + locked_order."taxAmountCents";
  IF claim_amount IS DISTINCT FROM p_expected_amount_cents
     OR claim_amount <= 0
     OR claim_amount > 2147483647
     OR locked_order.currency !~ '^[A-Za-z]{3}$' THEN
    RAISE EXCEPTION 'Blocked-checkout refund resume amount or currency drifted'
      USING ERRCODE = 'check_violation';
  END IF;

  IF locked_order."sellerRefundId" = 'pending'
     AND locked_order."refundClaimId" IS NOT NULL
     AND locked_order."refundClaimGeneration" >= 1
     AND locked_order."refundClaimSource" = 'BLOCKED_CHECKOUT'
     AND locked_order."refundClaimSourceId" = locked_event.id
     AND locked_order."refundClaimSourceGeneration" IS NOT NULL
     AND locked_order."refundClaimSourceGeneration" <= locked_event."claimGeneration"
     AND locked_order."refundClaimProviderAuthorizedAt" IS NOT NULL
     AND locked_order."refundClaimIdempotencyScope" IS NOT DISTINCT FROM
       'blocked-checkout-refund:'
       || locked_order."refundClaimId"
       || ':FULL:'
       || claim_amount::text THEN
    UPDATE public."Order" AS orders
       SET "refundClaimSourceGeneration" = locked_event."claimGeneration"
     WHERE orders.id = locked_order.id
       AND orders."refundClaimId" = locked_order."refundClaimId"
       AND orders."refundClaimGeneration" = locked_order."refundClaimGeneration"
       AND orders."refundClaimSource" = 'BLOCKED_CHECKOUT'
       AND orders."refundClaimSourceId" = locked_event.id
       AND orders."refundClaimSourceGeneration"
             = locked_order."refundClaimSourceGeneration"
       AND orders."sellerRefundId" = 'pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Blocked-checkout refund resume generation raced'
        USING ERRCODE = 'serialization_failure';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'claimId', locked_order."refundClaimId",
      'claimGeneration', locked_order."refundClaimGeneration",
      'idempotencyScope', locked_order."refundClaimIdempotencyScope",
      'refundAmountCents', claim_amount,
      'currency', pg_catalog.lower(locked_order.currency),
      'paymentIntentId', locked_order."stripePaymentIntentId",
      'itemsSubtotalCents', locked_order."itemsSubtotalCents",
      'shippingAmountCents', locked_order."shippingAmountCents",
      'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
      'taxAmountCents', locked_order."taxAmountCents",
      'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
      'action', 'replay'
    );
  END IF;

  RETURN public.grainline_blocked_checkout_refund_claim(
    p_event_id,
    p_event_claim_generation,
    p_session_id,
    p_order_id,
    p_expected_amount_cents
  );
END
$grainline_blocked_checkout_refund_claim_resume$;

CREATE FUNCTION public.grainline_seller_refund_record(
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
  IF NOT FOUND OR locked_actor."deletedAt" IS NOT NULL OR locked_actor.banned THEN
    RAISE EXCEPTION 'Seller refund record actor is not active'
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

CREATE FUNCTION public.grainline_blocked_checkout_refund_record(
  p_event_id text,
  p_event_claim_generation bigint,
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
AS $grainline_blocked_checkout_refund_record$
DECLARE
  locked_event public."StripeWebhookEvent"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  existing_event public."OrderPaymentEvent"%ROWTYPE;
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
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_event_claim_generation IS NULL OR p_event_claim_generation < 1
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
    RAISE EXCEPTION 'Blocked-checkout refund provider evidence is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    824022,
    pg_catalog.hashtext(p_claim_id)
  );
  event_key := 'local:blocked_checkout_refund_recorded:' || p_refund_id;

  SELECT source_event.*
    INTO locked_event
    FROM public."StripeWebhookEvent" AS source_event
   WHERE source_event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_event.type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR locked_event."claimGeneration" IS DISTINCT FROM p_event_claim_generation THEN
    RAISE EXCEPTION 'Blocked-checkout refund record source identity is invalid'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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
      RAISE EXCEPTION 'Blocked-checkout refund replay Order is missing'
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
      'localAction', 'BLOCKED_CHECKOUT_REFUND_RECORDED',
      'refundIds', pg_catalog.jsonb_build_array(p_refund_id),
      'refundStatuses', pg_catalog.jsonb_build_array(p_refund_status),
      'refundAccounting', refund_accounting,
      'requiresManualTransferReconciliation',
        requires_manual_transfer_reconciliation,
      'requiresManualFollowUp', requires_manual_follow_up,
      'stripeSessionId', locked_order."stripeSessionId",
      'stripeEventType', locked_event.type,
      'refundClaimId', p_claim_id,
      'refundClaimGeneration', p_claim_generation::text,
      'refundClaimSource', 'BLOCKED_CHECKOUT',
      'refundClaimSourceId', p_event_id,
      'refundClaimSourceGeneration', p_event_claim_generation::text
    );

    IF locked_order."stripeSessionId" IS DISTINCT FROM locked_event."sourceObjectId"
       OR locked_order."sellerRefundId" IS DISTINCT FROM p_refund_id
       OR locked_order."sellerRefundAmountCents" IS DISTINCT FROM refund_amount
       OR locked_order."sellerRefundLockedAt" IS NOT NULL
       OR existing_event."stripeObjectId" IS DISTINCT FROM p_refund_id
       OR existing_event."stripeObjectType" IS DISTINCT FROM 'refund'
       OR existing_event."eventType" IS DISTINCT FROM 'REFUND'
       OR existing_event."amountCents" IS DISTINCT FROM refund_amount
       OR existing_event.currency IS DISTINCT FROM pg_catalog.lower(locked_order.currency)
       OR existing_event.status IS DISTINCT FROM p_refund_status
       OR existing_event.reason IS DISTINCT FROM 'blocked_checkout'
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
      RAISE EXCEPTION 'Blocked-checkout refund replay evidence drifted'
        USING ERRCODE = 'unique_violation';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'orderId', locked_order.id,
      'buyerUserId', locked_order."buyerId",
      'paymentEventId', existing_event.id,
      'refundId', p_refund_id,
      'refundAmountCents', refund_amount,
      'restoredActiveListingCount',
        (existing_event.metadata->>'restoredActiveListingCount')::integer,
      'action', 'replay'
    );
  END IF;

  IF locked_event."processingStartedAt" IS NULL
     OR locked_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Blocked-checkout refund record source lease is inactive'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders."refundClaimId" = p_claim_id
     AND orders."refundClaimGeneration" = p_claim_generation
   FOR UPDATE;
  IF NOT FOUND
     OR locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
     OR locked_order."refundClaimSource" IS DISTINCT FROM 'BLOCKED_CHECKOUT'
     OR locked_order."refundClaimSourceId" IS DISTINCT FROM locked_event.id
     OR locked_order."refundClaimSourceGeneration"
          IS DISTINCT FROM locked_event."claimGeneration"
     OR locked_order."refundClaimProviderAuthorizedAt" IS NULL
     OR locked_order."stripeSessionId" IS DISTINCT FROM locked_event."sourceObjectId" THEN
    RAISE EXCEPTION 'Blocked-checkout refund record claim is no longer active'
      USING ERRCODE = 'serialization_failure';
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
    RAISE EXCEPTION 'Blocked-checkout refund accounting evidence is invalid'
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
    RAISE EXCEPTION 'Blocked-checkout refund reversal evidence is missing or mismatched'
      USING ERRCODE = 'check_violation';
  ELSIF NOT expected_transfer_reversal
     AND (
       p_transfer_reversal_id IS NOT NULL
       OR p_transfer_reversal_amount_cents IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Blocked-checkout refund has unexpected transfer-reversal evidence'
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
    'localAction', 'BLOCKED_CHECKOUT_REFUND_RECORDED',
    'refundIds', pg_catalog.jsonb_build_array(p_refund_id),
    'refundStatuses', pg_catalog.jsonb_build_array(p_refund_status),
    'refundAccounting', refund_accounting,
    'requiresManualTransferReconciliation',
      requires_manual_transfer_reconciliation,
    'requiresManualFollowUp', requires_manual_follow_up,
    'stripeSessionId', locked_order."stripeSessionId",
    'stripeEventType', locked_event.type,
    'refundClaimId', p_claim_id,
    'refundClaimGeneration', p_claim_generation::text,
    'refundClaimSource', 'BLOCKED_CHECKOUT',
    'refundClaimSourceId', p_event_id,
    'refundClaimSourceGeneration', p_event_claim_generation::text
  );
  transition_at := (
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3);
  review_note := pg_catalog.format(
    'Automatic full refund of %s cents via Stripe refund %s because checkout was no longer eligible.%s%s',
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
    'blocked-checkout-refund-payment:'
    || pg_catalog.gen_random_uuid()::text;
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
    'blocked_checkout',
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
    RAISE EXCEPTION 'Blocked-checkout refund record lost its active generation'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF requires_manual_transfer_reconciliation
     AND locked_order."sellerProfileId" IS NOT NULL THEN
    UPDATE public."SellerProfile" AS seller
       SET "manualStripeReconciliationNeeded" = true,
           "manualStripeReconciliationNote" =
             'Blocked-checkout refund used a platform-only Stripe refund; staff must reconcile the seller transfer manually.',
           "updatedAt" = transition_at
     WHERE seller.id = locked_order."sellerProfileId";
  END IF;

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
    RAISE EXCEPTION 'Blocked-checkout payment event disappeared before finalization'
      USING ERRCODE = 'serialization_failure';
  END IF;

  audit_id :=
    'blocked-checkout-refund-audit:'
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
    'webhook',
    locked_event.id,
    'BLOCKED_CHECKOUT_REFUND_RECORDED',
    'ORDER',
    locked_order.id,
    'blocked_checkout',
    pg_catalog.jsonb_build_object(
      'orderPaymentEventId', payment_event_id,
      'stripeRefundId', p_refund_id,
      'refundIds', pg_catalog.jsonb_build_array(p_refund_id),
      'amountCents', refund_amount,
      'currency', pg_catalog.lower(locked_order.currency),
      'refundAccounting', refund_accounting,
      'stripeSessionId', locked_order."stripeSessionId",
      'stripeEventType', locked_event.type,
      'refundClaimId', p_claim_id,
      'refundClaimGeneration', p_claim_generation::text,
      'refundClaimSourceGeneration', p_event_claim_generation::text,
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
    'restoredActiveListingCount', restored_active_listing_count,
    'action', 'recorded'
  );
END
$grainline_blocked_checkout_refund_record$;

REVOKE ALL ON FUNCTION
  public.grainline_blocked_checkout_refund_claim_resume(
    text, bigint, text, text, integer
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.grainline_seller_refund_record(
    text, text, bigint, text, text, text, integer
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.grainline_blocked_checkout_refund_record(
    text, bigint, text, bigint, text, text, text, integer
  )
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.grainline_blocked_checkout_refund_claim_resume(
    text, bigint, text, text, integer
  )
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_refund_record(
    text, text, bigint, text, text, text, integer
  )
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_blocked_checkout_refund_record(
    text, bigint, text, bigint, text, text, text, integer
  )
  TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_blocked_checkout_refund_claim_resume(
  text, bigint, text, text, integer
) IS
  'Resumes an exact blocked-checkout refund idempotency claim under a later signed lease generation for the same immutable event, session and Order.';
COMMENT ON FUNCTION public.grainline_seller_refund_record(
  text, text, bigint, text, text, text, integer
) IS
  'Atomically records and finalizes one exact generation-fenced seller full refund, including payment, Case, stock and audit effects.';
COMMENT ON FUNCTION public.grainline_blocked_checkout_refund_record(
  text, bigint, text, bigint, text, text, text, integer
) IS
  'Atomically records and finalizes one exact signed-event generation-fenced blocked-checkout refund.';

DO $grainline_order_refund_record_postflight$
DECLARE
  runtime_role_oid oid := 'grainline_app_runtime'::pg_catalog.regrole;
  function_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.oid IN (
       'public.grainline_blocked_checkout_refund_claim_resume(text,bigint,text,text,integer)'::pg_catalog.regprocedure,
       'public.grainline_seller_refund_record(text,text,bigint,text,text,text,integer)'::pg_catalog.regprocedure,
       'public.grainline_blocked_checkout_refund_record(text,bigint,text,bigint,text,text,text,integer)'::pg_catalog.regprocedure
     )
     AND procedure.prosecdef
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proowner <> runtime_role_oid
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE');
  IF function_count <> 3 THEN
    RAISE EXCEPTION 'Order refund record function posture is incomplete';
  END IF;
END
$grainline_order_refund_record_postflight$;

COMMIT;
