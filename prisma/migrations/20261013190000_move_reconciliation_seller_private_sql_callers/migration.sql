-- Move refund reconciliation writers onto SellerProfilePrivate while keeping
-- the predecessor representation synchronized for old deployments.
-- Existing public entrypoint signatures, security modes, and grants remain unchanged.

BEGIN;

DO $seller_private_reconciliation_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."SellerProfilePrivate"') IS NULL THEN
    RAISE EXCEPTION 'SellerProfilePrivate table is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND attribute.attname IN (
         'manualStripeReconciliationNeeded',
         'manualStripeReconciliationNote',
         'updatedAt'
       )
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     GROUP BY attribute.attrelid
    HAVING pg_catalog.count(*) = 3
  ) THEN
    RAISE EXCEPTION 'SellerProfilePrivate reconciliation columns are missing';
  END IF;
END
$seller_private_reconciliation_preflight$;

-- Transition-only fixed writer. It synchronizes the private source and the
-- predecessor representation while old deployments can still read the latter.
-- It has no runtime grant and must be replaced before predecessor columns drop.
CREATE OR REPLACE FUNCTION public.grainline_seller_profile_reconciliation_required_compat(
  p_seller_profile_id text,
  p_seller_user_id text,
  p_note text,
  p_updated_at timestamp without time zone
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_profile_reconciliation_required_compat$
DECLARE
  target_seller_profile_id text;
BEGIN
  IF (p_seller_profile_id IS NULL) = (p_seller_user_id IS NULL)
     OR COALESCE(p_seller_profile_id, p_seller_user_id) = ''
     OR pg_catalog.char_length(COALESCE(p_seller_profile_id, p_seller_user_id)) > 191
     OR p_note IS NULL
     OR pg_catalog.char_length(p_note) NOT BETWEEN 1 AND 1000
     OR p_updated_at IS NULL THEN
    RAISE EXCEPTION 'Seller reconciliation input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_seller_profile_id IS NOT NULL THEN
    SELECT seller.id
      INTO target_seller_profile_id
      FROM public."SellerProfile" AS seller
      JOIN public."SellerProfilePrivate" AS seller_private
        ON seller_private."sellerProfileId" = seller.id
     WHERE seller.id = p_seller_profile_id
     FOR UPDATE OF seller, seller_private;
  ELSE
    SELECT seller.id
      INTO target_seller_profile_id
      FROM public."SellerProfile" AS seller
      JOIN public."SellerProfilePrivate" AS seller_private
        ON seller_private."sellerProfileId" = seller.id
     WHERE seller."userId" = p_seller_user_id
     FOR UPDATE OF seller, seller_private;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller reconciliation target is missing'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Update the predecessor first. Its installed mirror trigger writes the same
  -- values into the private row; the explicit private update then makes the
  -- intended source authoritative even after that trigger is retired.
  UPDATE public."SellerProfile" AS seller
     SET "manualStripeReconciliationNeeded" = true,
         "manualStripeReconciliationNote" = p_note,
         "updatedAt" = p_updated_at
   WHERE seller.id = target_seller_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller reconciliation predecessor update failed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  UPDATE public."SellerProfilePrivate" AS seller_private
     SET "manualStripeReconciliationNeeded" = true,
         "manualStripeReconciliationNote" = p_note,
         "updatedAt" = p_updated_at
   WHERE seller_private."sellerProfileId" = target_seller_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller reconciliation private update failed'
      USING ERRCODE = 'serialization_failure';
  END IF;
END
$grainline_seller_profile_reconciliation_required_compat$;

REVOKE ALL ON FUNCTION
  public.grainline_seller_profile_reconciliation_required_compat(
    text, text, text, timestamp without time zone
  )
  FROM PUBLIC, grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_blocked_checkout_refund_record_core(
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
AS $grainline_blocked_checkout_refund_record_core$
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
     OR locked_order."stripeSessionId" IS DISTINCT FROM locked_event."sourceObjectId"
     OR locked_order."fulfillmentStatus"::text IS DISTINCT FROM 'PENDING'
     OR locked_order."labelStatus"::text IS NOT DISTINCT FROM 'PURCHASED'
     OR COALESCE(locked_order."labelClaimStatus", '') IN (
       'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
     ) THEN
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
    PERFORM public.grainline_seller_profile_reconciliation_required_compat(
      locked_order."sellerProfileId",
      NULL::text,
      'Blocked-checkout refund used a platform-only Stripe refund; staff must reconcile the seller transfer manually.',
      transition_at
    );
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
$grainline_blocked_checkout_refund_record_core$;

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
    PERFORM public.grainline_seller_profile_reconciliation_required_compat(
      locked_seller.id,
      NULL::text,
      'Seller refund used a platform-only Stripe refund; staff must reconcile the seller transfer manually.',
      transition_at
    );
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

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
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
    PERFORM public.grainline_seller_profile_reconciliation_required_compat(
      NULL::text,
      locked_case."sellerId",
      'Staff case refund used a platform-only Stripe refund; '
        || 'staff must reconcile the seller transfer manually.',
      transition_at
    );
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

CREATE OR REPLACE FUNCTION
  public.grainline_case_staff_resolution_provider_recovery_record(
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
AS $grainline_case_staff_resolution_provider_recovery_record$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  locked_claim record;
  existing_event record;
  recovery_audit_id text;
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
     OR locked_actor.role <> 'ADMIN'::public."Role" THEN
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
    claim."orderPaymentEventId",
    claim."providerRecoveryActorId",
    claim."providerRecoveryAction",
    claim."providerRecoveryEvidenceSha256",
    claim."providerRecoveryInspectedAt",
    claim."providerRecoveryAuthorizedAt",
    claim."providerRecoveryRecordedAt",
    claim."providerRecoveryFinalizedAt"
    INTO locked_claim
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = p_resolution_claim_id
     AND claim."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_claim."caseId" IS DISTINCT FROM locked_case.id
     OR locked_claim."providerRecoveryActorId"
          IS DISTINCT FROM locked_actor.id
     OR locked_claim."providerRecoveryAuthorizedAt" IS NULL
     OR locked_claim."providerRecoveryFinalizedAt" IS NOT NULL
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

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
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
           "providerRecoveryActorId" = NULL,
           "providerRecoveryAction" = NULL,
           "providerRecoveryEvidenceSha256" = NULL,
           "providerRecoveryInspectedAt" = NULL,
           "providerRecoveryAuthorizedAt" = NULL,
           "providerRecoveryRecordedAt" = NULL,
           "providerRecoveryFinalizedAt" = NULL,
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
      locked_claim."staffActorId",
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

    recovery_audit_id :=
      'case-resolution-provider-recovery-ambiguous-audit:'
      || pg_catalog.gen_random_uuid()::text;
    INSERT INTO public."AdminAuditLog" (
      id, "adminId", action, "targetType", "targetId", reason,
      metadata, undone, "createdAt"
    )
    VALUES (
      recovery_audit_id,
      locked_actor.id,
      'RECOVER_CASE_RESOLUTION_PROVIDER_AMBIGUOUS',
      'CASE_RESOLUTION_CLAIM',
      locked_claim.id,
      locked_claim."providerRecoveryAction",
      pg_catalog.jsonb_build_object(
        'caseId', locked_case.id,
        'orderId', locked_order.id,
        'originalStaffActorId', locked_claim."staffActorId",
        'providerEvidenceSha256',
          locked_claim."providerRecoveryEvidenceSha256",
        'providerInspectedAt', locked_claim."providerRecoveryInspectedAt"
      ),
      false,
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
    PERFORM public.grainline_seller_profile_reconciliation_required_compat(
      NULL::text,
      locked_case."sellerId",
      'Staff case refund used a platform-only Stripe refund; '
        || 'staff must reconcile the seller transfer manually.',
      transition_at
    );
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
    locked_claim."staffActorId",
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

  UPDATE public."CaseResolutionClaim" AS claim
     SET "providerRecoveryRecordedAt" = transition_at,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim."providerRecoveryActorId" = locked_actor.id
     AND claim."providerRecoveryRecordedAt" IS NULL
     AND claim."providerRecoveryFinalizedAt" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case recovery provider-record lease was lost'
      USING ERRCODE = '40001';
  END IF;

  recovery_audit_id :=
    'case-resolution-provider-recovery-record-audit:'
    || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason,
    metadata, undone, "createdAt"
  )
  VALUES (
    recovery_audit_id,
    locked_actor.id,
    'RECOVER_CASE_RESOLUTION_PROVIDER_RECORD',
    'CASE_RESOLUTION_CLAIM',
    locked_claim.id,
    locked_claim."providerRecoveryAction",
    pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'orderId', locked_order.id,
      'originalStaffActorId', locked_claim."staffActorId",
      'providerEvidenceSha256',
        locked_claim."providerRecoveryEvidenceSha256",
      'providerInspectedAt', locked_claim."providerRecoveryInspectedAt",
      'stripeRefundId', p_primary_refund_id
    ),
    false,
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
$grainline_case_staff_resolution_provider_recovery_record$;

COMMIT;
