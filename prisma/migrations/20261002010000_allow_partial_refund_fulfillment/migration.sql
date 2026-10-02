-- Allow a completed, evidenced partial refund to continue fulfillment when no
-- units were returned to inventory, while retaining fail-closed behavior for
-- stock-restoring, full, pending, ambiguous, locked, or internally
-- inconsistent refund states. This successor changes no RLS posture or table
-- grants.

BEGIN;

CREATE FUNCTION public.grainline_order_refund_blocks_fulfillment(
  p_order_id text,
  p_seller_refund_id text,
  p_seller_refund_locked_at timestamp without time zone,
  p_payment_refund_blocked boolean,
  p_seller_refund_amount_cents integer,
  p_order_total_cents integer
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $grainline_order_refund_blocks_fulfillment$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
        FROM public."CaseResolutionClaim" AS resolution_claim
       WHERE resolution_claim."orderId" = p_order_id
         AND resolution_claim.status::text = 'FINALIZED'
         AND pg_catalog.jsonb_array_length(
               resolution_claim."stockRestorePlan"
             ) > 0
    ) THEN true
    WHEN p_seller_refund_id IS NULL
         AND p_seller_refund_locked_at IS NULL
         AND NOT COALESCE(p_payment_refund_blocked, false)
         AND p_seller_refund_amount_cents IS NULL THEN false
    WHEN p_seller_refund_locked_at IS NOT NULL THEN true
    WHEN NULLIF(pg_catalog.btrim(p_seller_refund_id), '') IS NULL THEN true
    WHEN p_seller_refund_id IN (
      'pending',
      'ambiguous_refund_pending_reconciliation'
    ) THEN true
    WHEN p_seller_refund_amount_cents IS NULL
         OR p_seller_refund_amount_cents <= 0 THEN true
    WHEN p_order_total_cents IS NULL OR p_order_total_cents <= 0 THEN true
    ELSE p_seller_refund_amount_cents >= p_order_total_cents
  END
$grainline_order_refund_blocks_fulfillment$;

REVOKE ALL ON FUNCTION public.grainline_order_refund_blocks_fulfillment(
  text, text, timestamp without time zone, boolean, integer, integer
) FROM PUBLIC, grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_order_refund_blocks_fulfillment(
  text, text, timestamp without time zone, boolean, integer, integer
) IS
  'Private fail-closed classifier for Order fulfillment after refund evidence or finalized stock restoration.';


CREATE OR REPLACE FUNCTION public.grainline_order_seller_fulfillment_transition(
  p_actor_user_id text,
  p_order_id text,
  p_action text,
  p_tracking_carrier text,
  p_tracking_number text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_fulfillment_transition$
DECLARE
  locked_actor public."User"%ROWTYPE;
  source_seller public."SellerProfile"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  active_buyer_user_id text;
  buyer_name text;
  buyer_email text;
  transition_at timestamp(3) without time zone;
  audit_id text;
  normalized_carrier text := NULLIF(pg_catalog.btrim(p_tracking_carrier), '');
  normalized_tracking text := NULLIF(pg_catalog.btrim(p_tracking_number), '');
  next_status text;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_action IS NULL
     OR p_action NOT IN ('shipped', 'ready_for_pickup') THEN
    RAISE EXCEPTION 'Order seller-fulfillment input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'shipped' AND (
       normalized_carrier IS NULL
       OR normalized_carrier NOT IN ('UPS', 'USPS', 'FedEx', 'DHL', 'Other')
       OR normalized_tracking IS NULL
       OR normalized_tracking !~ '^[A-Za-z0-9][A-Za-z0-9 -]{4,99}$'
     ) THEN
    RAISE EXCEPTION 'Order shipment tracking evidence is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_action = 'ready_for_pickup'
     AND (normalized_carrier IS NOT NULL OR normalized_tracking IS NOT NULL) THEN
    RAISE EXCEPTION 'Order pickup readiness cannot include tracking evidence'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.*
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE OF actor;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT seller.*
    INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = locked_actor.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT source_order.*
    INTO locked_order
    FROM public."Order" AS source_order
   WHERE source_order.id = p_order_id
   FOR UPDATE OF source_order;
  IF NOT FOUND OR locked_order."sellerProfileId" IS DISTINCT FROM source_seller.id THEN
    RETURN NULL;
  END IF;

  IF locked_order."paidAt" IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'unpaid');
  END IF;
  IF public.grainline_order_refund_blocks_fulfillment(
      locked_order.id,
      locked_order."sellerRefundId",
      locked_order."sellerRefundLockedAt",
      locked_order."paymentRefundBlocked",
      locked_order."sellerRefundAmountCents",
      COALESCE(
      locked_order."chargedTotalCents",
      COALESCE(locked_order."itemsSubtotalCents", 0)
        + COALESCE(locked_order."shippingAmountCents", 0)
        + COALESCE(locked_order."giftWrappingPriceCents", 0)
        + COALESCE(locked_order."taxAmountCents", 0)
    )
    ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'refunded');
  END IF;
  IF locked_order."paymentOpenDisputeBlocked" THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'open_dispute');
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public."Case" AS source_case
     WHERE source_case."orderId" = locked_order.id
       AND source_case.status::text IN (
         'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW'
       )
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'active_case');
  END IF;
  IF locked_order."sellerDeauthorizedAt" IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'conflict', 'reason', 'seller_deauthorized'
    );
  END IF;
  IF locked_order."fulfillmentStatus"::text <> 'PENDING' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'state_changed');
  END IF;

  IF p_action = 'shipped' THEN
    IF COALESCE(locked_order."fulfillmentMethod"::text, 'SHIPPING') <> 'SHIPPING' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'method_mismatch');
    END IF;
    IF locked_order."labelStatus"::text = 'PURCHASED' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'label_purchased');
    END IF;
    next_status := 'SHIPPED';
  ELSE
    IF locked_order."fulfillmentMethod"::text <> 'PICKUP' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'method_mismatch');
    END IF;
    next_status := 'READY_FOR_PICKUP';
  END IF;

  transition_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  IF p_action = 'shipped' THEN
    UPDATE public."Order" AS target_order
       SET "fulfillmentMethod" = 'SHIPPING'::public."FulfillmentMethod",
           "fulfillmentStatus" = 'SHIPPED'::public."FulfillmentStatus",
           "shippedAt" = transition_at,
           "trackingCarrier" = normalized_carrier,
           "trackingNumber" = normalized_tracking
     WHERE target_order.id = locked_order.id;
  ELSE
    UPDATE public."Order" AS target_order
       SET "fulfillmentMethod" = 'PICKUP'::public."FulfillmentMethod",
           "fulfillmentStatus" = 'READY_FOR_PICKUP'::public."FulfillmentStatus",
           "pickupReadyAt" = transition_at
     WHERE target_order.id = locked_order.id;
  END IF;

  audit_id := 'order-fulfillment-audit:' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId", metadata,
    "createdAt"
  ) VALUES (
    audit_id,
    'user',
    locked_actor.id,
    'ORDER_FULFILLMENT_TRANSITION',
    'ORDER',
    locked_order.id,
    pg_catalog.jsonb_build_object(
      'action', p_action,
      'previousStatus', 'PENDING',
      'newStatus', next_status,
      'trackingCarrier', CASE WHEN p_action = 'shipped' THEN normalized_carrier ELSE NULL END
    ),
    transition_at
  );

  SELECT buyer.id, buyer.name, buyer.email
    INTO active_buyer_user_id, buyer_name, buyer_email
    FROM public."User" AS buyer
   WHERE buyer.id = locked_order."buyerId"
     AND buyer.banned = false
     AND buyer."deletedAt" IS NULL;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'changed',
    'orderId', locked_order.id,
    'buyerUserId', active_buyer_user_id,
    'buyerName', buyer_name,
    'buyerEmail', buyer_email,
    'sellerDisplayName', source_seller."displayName",
    'estimatedDeliveryDate', locked_order."estimatedDeliveryDate",
    'action', p_action,
    'trackingCarrier', normalized_carrier,
    'trackingNumber', normalized_tracking,
    'auditLogId', audit_id,
    'previousStatus', 'PENDING',
    'newStatus', next_status
  );
END
$grainline_order_seller_fulfillment_transition$;

CREATE OR REPLACE FUNCTION public.grainline_order_buyer_receipt_confirm(
  p_actor_user_id text,
  p_order_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_receipt_confirm$
DECLARE
  locked_actor public."User"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  seller_user_id text;
  transition_at timestamp(3) without time zone;
  audit_id text;
  normalized_method text;
  previous_status text;
  next_status text;
  transition_action text;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Order buyer-receipt input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.*
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE OF actor;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT source_order.*
    INTO locked_order
    FROM public."Order" AS source_order
   WHERE source_order.id = p_order_id
   FOR UPDATE OF source_order;
  IF NOT FOUND OR locked_order."buyerId" IS DISTINCT FROM locked_actor.id THEN
    RETURN NULL;
  END IF;

  IF locked_order."paidAt" IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'unpaid');
  END IF;
  IF public.grainline_order_refund_blocks_fulfillment(
      locked_order.id,
      locked_order."sellerRefundId",
      locked_order."sellerRefundLockedAt",
      locked_order."paymentRefundBlocked",
      locked_order."sellerRefundAmountCents",
      COALESCE(
      locked_order."chargedTotalCents",
      COALESCE(locked_order."itemsSubtotalCents", 0)
        + COALESCE(locked_order."shippingAmountCents", 0)
        + COALESCE(locked_order."giftWrappingPriceCents", 0)
        + COALESCE(locked_order."taxAmountCents", 0)
    )
    ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'refunded');
  END IF;
  IF locked_order."paymentOpenDisputeBlocked" THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'open_dispute');
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public."Case" AS source_case
     WHERE source_case."orderId" = locked_order.id
       AND source_case.status::text IN (
         'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW'
       )
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'active_case');
  END IF;

  IF locked_order."fulfillmentStatus"::text = 'SHIPPED'
     AND COALESCE(locked_order."fulfillmentMethod"::text, 'SHIPPING') = 'SHIPPING' THEN
    normalized_method := 'SHIPPING';
    previous_status := 'SHIPPED';
    next_status := 'DELIVERED';
    transition_action := 'delivered';
  ELSIF locked_order."fulfillmentStatus"::text = 'READY_FOR_PICKUP'
     AND locked_order."fulfillmentMethod"::text = 'PICKUP' THEN
    normalized_method := 'PICKUP';
    previous_status := 'READY_FOR_PICKUP';
    next_status := 'PICKED_UP';
    transition_action := 'picked_up';
  ELSE
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'state_changed');
  END IF;

  transition_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  IF normalized_method = 'SHIPPING' THEN
    UPDATE public."Order" AS target_order
       SET "fulfillmentMethod" = 'SHIPPING'::public."FulfillmentMethod",
           "fulfillmentStatus" = 'DELIVERED'::public."FulfillmentStatus",
           "deliveredAt" = transition_at
     WHERE target_order.id = locked_order.id;
  ELSE
    UPDATE public."Order" AS target_order
       SET "fulfillmentMethod" = 'PICKUP'::public."FulfillmentMethod",
           "fulfillmentStatus" = 'PICKED_UP'::public."FulfillmentStatus",
           "pickedUpAt" = transition_at
     WHERE target_order.id = locked_order.id;
  END IF;

  audit_id := 'order-receipt-audit:' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId", metadata,
    "createdAt"
  ) VALUES (
    audit_id,
    'user',
    locked_actor.id,
    'ORDER_FULFILLMENT_TRANSITION',
    'ORDER',
    locked_order.id,
    pg_catalog.jsonb_build_object(
      'action', transition_action,
      'fulfillmentMethod', normalized_method,
      'previousStatus', previous_status,
      'newStatus', next_status
    ),
    transition_at
  );

  SELECT seller_user.id
    INTO seller_user_id
    FROM public."SellerProfile" AS seller
    JOIN public."User" AS seller_user
      ON seller_user.id = seller."userId"
   WHERE seller.id = locked_order."sellerProfileId"
     AND seller_user.banned = false
     AND seller_user."deletedAt" IS NULL;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'changed',
    'orderId', locked_order.id,
    'sellerUserId', seller_user_id,
    'action', transition_action,
    'fulfillmentMethod', normalized_method,
    'auditLogId', audit_id,
    'previousStatus', previous_status,
    'newStatus', next_status
  );
END
$grainline_order_buyer_receipt_confirm$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_label_preflight(
  p_actor_user_id text,
  p_order_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_label_preflight$
DECLARE
  actor public."User"%ROWTYPE;
  seller public."SellerProfile"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  package_source text;
  package_weight numeric;
  package_length numeric;
  package_width numeric;
  package_height numeric;
  snapshot_items integer;
  legacy_items integer;
  total_items integer;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Order label preflight input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT source_actor.* INTO actor
    FROM public."User" AS source_actor
   WHERE source_actor.id = p_actor_user_id;
  IF NOT FOUND OR actor.banned OR actor."deletedAt" IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT source_seller.* INTO seller
    FROM public."SellerProfile" AS source_seller
   WHERE source_seller."userId" = actor.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT candidate.* INTO source_order
    FROM public."Order" AS candidate
   WHERE candidate.id = p_order_id;
  IF NOT FOUND OR source_order."sellerProfileId" IS DISTINCT FROM seller.id THEN
    RETURN NULL;
  END IF;

  IF source_order."paidAt" IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'unpaid');
  END IF;
  IF public.grainline_order_refund_blocks_fulfillment(
      source_order.id,
      source_order."sellerRefundId",
      source_order."sellerRefundLockedAt",
      source_order."paymentRefundBlocked",
      source_order."sellerRefundAmountCents",
      COALESCE(
      source_order."chargedTotalCents",
      COALESCE(source_order."itemsSubtotalCents", 0)
        + COALESCE(source_order."shippingAmountCents", 0)
        + COALESCE(source_order."giftWrappingPriceCents", 0)
        + COALESCE(source_order."taxAmountCents", 0)
    )
    ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'refunded');
  END IF;
  IF source_order."paymentOpenDisputeBlocked" THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'open_dispute');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."Case" AS source_case
     WHERE source_case."orderId" = source_order.id
       AND source_case.status::text IN (
         'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW'
       )
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'active_case');
  END IF;
  IF source_order."sellerDeauthorizedAt" IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'conflict', 'reason', 'seller_deauthorized'
    );
  END IF;
  IF source_order."fulfillmentStatus"::text <> 'PENDING'
     OR COALESCE(source_order."fulfillmentMethod"::text, 'SHIPPING') <> 'SHIPPING' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'state_changed');
  END IF;
  IF source_order."labelStatus"::text = 'PURCHASED' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'label_purchased');
  END IF;
  IF source_order."labelClaimStatus" IN (
    'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'conflict', 'reason', 'label_claim_active'
    );
  END IF;

  IF NULLIF(pg_catalog.btrim(source_order."shipToLine1"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(source_order."shipToCity"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(source_order."shipToState"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(source_order."shipToPostalCode"), '') IS NULL
     OR COALESCE(source_order."shipToCountry", 'US') !~ '^[A-Za-z]{2}$'
     OR NULLIF(pg_catalog.btrim(
       COALESCE(source_order."buyerName", source_order."quotedToName", '')
     ), '') IS NULL
     OR NULLIF(pg_catalog.btrim(seller."shipFromLine1"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(seller."shipFromCity"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(seller."shipFromState"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(seller."shipFromPostal"), '') IS NULL
     OR COALESCE(seller."shipFromCountry", 'US') !~ '^[A-Za-z]{2}$'
     OR NULLIF(pg_catalog.btrim(seller."shipFromPhone"), '') IS NULL
     OR seller."shipFromPhone" !~ '^[+][1-9][0-9]{7,14}$'
     OR NULLIF(pg_catalog.btrim(
       COALESCE(seller."shipFromName", seller."displayName", '')
     ), '') IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'address_missing');
  END IF;

  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(*) FILTER (
           WHERE pg_catalog.jsonb_typeof(item."listingSnapshot") = 'object'
             AND item.quantity > 0
             AND item."listingSnapshot"->>'shippingPackageComplete' = 'true'
             AND item."listingSnapshot"->>'shippingWeightGrams' ~ '^[0-9]+([.][0-9]+)?$'
             AND item."listingSnapshot"->>'shippingLengthCm' ~ '^[0-9]+([.][0-9]+)?$'
             AND item."listingSnapshot"->>'shippingWidthCm' ~ '^[0-9]+([.][0-9]+)?$'
             AND item."listingSnapshot"->>'shippingHeightCm' ~ '^[0-9]+([.][0-9]+)?$'
         )::integer
    INTO total_items, snapshot_items
    FROM public."OrderItem" AS item
   WHERE item."orderId" = source_order.id;

  IF total_items < 1 THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'package_missing');
  END IF;

  IF snapshot_items = total_items THEN
    SELECT
      pg_catalog.sum((item."listingSnapshot"->>'shippingWeightGrams')::numeric * item.quantity),
      pg_catalog.max((item."listingSnapshot"->>'shippingLengthCm')::numeric),
      pg_catalog.max((item."listingSnapshot"->>'shippingWidthCm')::numeric),
      pg_catalog.max((item."listingSnapshot"->>'shippingHeightCm')::numeric)
      INTO package_weight, package_length, package_width, package_height
      FROM public."OrderItem" AS item
     WHERE item."orderId" = source_order.id;
    package_source := 'CHECKOUT_SNAPSHOT';
  ELSE
    SELECT pg_catalog.count(*) FILTER (
             WHERE item.quantity > 0
               AND COALESCE(listing."packagedWeightGrams", seller."defaultPkgWeightGrams") > 0
               AND COALESCE(listing."packagedWeightGrams", seller."defaultPkgWeightGrams") <= 500000
               AND COALESCE(listing."packagedLengthCm", seller."defaultPkgLengthCm") > 0
               AND COALESCE(listing."packagedLengthCm", seller."defaultPkgLengthCm") <= 1000
               AND COALESCE(listing."packagedWidthCm", seller."defaultPkgWidthCm") > 0
               AND COALESCE(listing."packagedWidthCm", seller."defaultPkgWidthCm") <= 1000
               AND COALESCE(listing."packagedHeightCm", seller."defaultPkgHeightCm") > 0
               AND COALESCE(listing."packagedHeightCm", seller."defaultPkgHeightCm") <= 1000
           )::integer,
      pg_catalog.sum(COALESCE(listing."packagedWeightGrams", seller."defaultPkgWeightGrams")::numeric * item.quantity),
      pg_catalog.max(COALESCE(listing."packagedLengthCm", seller."defaultPkgLengthCm")::numeric),
      pg_catalog.max(COALESCE(listing."packagedWidthCm", seller."defaultPkgWidthCm")::numeric),
      pg_catalog.max(COALESCE(listing."packagedHeightCm", seller."defaultPkgHeightCm")::numeric)
      INTO legacy_items, package_weight, package_length, package_width, package_height
      FROM public."OrderItem" AS item
      LEFT JOIN public."Listing" AS listing ON listing.id = item."listingId"
     WHERE item."orderId" = source_order.id;
    package_source := 'LEGACY_LIVE';
  END IF;

  IF (package_source = 'LEGACY_LIVE' AND legacy_items <> total_items)
     OR package_weight IS NULL OR package_weight <= 0 OR package_weight > 500000
     OR package_length IS NULL OR package_length <= 0 OR package_length > 1000
     OR package_width IS NULL OR package_width <= 0 OR package_width > 1000
     OR package_height IS NULL OR package_height <= 0 OR package_height > 1000 THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'package_missing');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'ready',
    'orderId', source_order.id,
    'sellerUserId', seller."userId",
    'currency', pg_catalog.lower(source_order.currency),
    'storedRateObjectId', source_order."shippoRateObjectId",
    'storedRateAmountCents', source_order."quotedShippingAmountCents",
    'storedRateUsable', source_order."shippoRateObjectId" IS NOT NULL
      AND source_order."shippoRateObjectId" NOT IN ('fallback', 'pickup')
      AND source_order."shippoRateObjectId" NOT LIKE 'quote-only:%'
      AND source_order."createdAt" >
        (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '5 days',
    'packageSource', package_source,
    'packageWeightGrams', package_weight,
    'packageLengthCm', package_length,
    'packageWidthCm', package_width,
    'packageHeightCm', package_height,
    'shipFrom', pg_catalog.jsonb_build_object(
      'name', COALESCE(NULLIF(pg_catalog.btrim(seller."shipFromName"), ''),
        pg_catalog.btrim(seller."displayName")),
      'street1', pg_catalog.btrim(seller."shipFromLine1"),
      'street2', seller."shipFromLine2",
      'city', pg_catalog.btrim(seller."shipFromCity"),
      'state', pg_catalog.btrim(seller."shipFromState"),
      'zip', pg_catalog.btrim(seller."shipFromPostal"),
      'country', COALESCE(seller."shipFromCountry", 'US'),
      'phone', pg_catalog.btrim(seller."shipFromPhone")
    ),
    'shipTo', pg_catalog.jsonb_build_object(
      'name', pg_catalog.btrim(
        COALESCE(source_order."buyerName", source_order."quotedToName")
      ),
      'street1', pg_catalog.btrim(source_order."shipToLine1"),
      'street2', source_order."shipToLine2",
      'city', pg_catalog.btrim(source_order."shipToCity"),
      'state', pg_catalog.btrim(source_order."shipToState"),
      'zip', pg_catalog.btrim(source_order."shipToPostalCode"),
      'country', COALESCE(source_order."shipToCountry", 'US')
    )
  );
END
$grainline_order_seller_label_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_label_quote_replace(
  p_actor_user_id text,
  p_order_id text,
  p_shipment_id text,
  p_rates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_label_quote_replace$
DECLARE
  locked_order public."Order"%ROWTYPE;
  seller_id text;
  rate jsonb;
  now_utc timestamp(3) without time zone;
  quote_id text;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_shipment_id IS NULL OR p_shipment_id !~ '^[A-Za-z0-9._:-]{1,255}$'
     OR pg_catalog.jsonb_typeof(p_rates) <> 'array'
     OR pg_catalog.jsonb_array_length(p_rates) NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Order label quote input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT seller.id INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = p_actor_user_id AND NOT actor.banned AND actor."deletedAt" IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT candidate.* INTO locked_order
    FROM public."Order" AS candidate WHERE candidate.id = p_order_id
   FOR UPDATE OF candidate;
  IF NOT FOUND OR locked_order."sellerProfileId" IS DISTINCT FROM seller_id THEN RETURN NULL; END IF;

  IF locked_order."paidAt" IS NULL OR locked_order."fulfillmentStatus"::text <> 'PENDING'
     OR COALESCE(locked_order."fulfillmentMethod"::text, 'SHIPPING') <> 'SHIPPING'
     OR locked_order."labelStatus"::text = 'PURCHASED'
     OR public.grainline_order_refund_blocks_fulfillment(
      locked_order.id,
      locked_order."sellerRefundId",
      locked_order."sellerRefundLockedAt",
      locked_order."paymentRefundBlocked",
      locked_order."sellerRefundAmountCents",
      COALESCE(
      locked_order."chargedTotalCents",
      COALESCE(locked_order."itemsSubtotalCents", 0)
        + COALESCE(locked_order."shippingAmountCents", 0)
        + COALESCE(locked_order."giftWrappingPriceCents", 0)
        + COALESCE(locked_order."taxAmountCents", 0)
    )
    ) OR locked_order."paymentOpenDisputeBlocked"
     OR locked_order."sellerDeauthorizedAt" IS NOT NULL
     OR locked_order."labelClaimStatus" IN (
       'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
     )
     OR EXISTS (
       SELECT 1 FROM public."Case" AS source_case
        WHERE source_case."orderId" = locked_order.id
          AND source_case.status::text IN (
            'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW'
          )
     ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'state_changed');
  END IF;

  FOR rate IN SELECT value FROM pg_catalog.jsonb_array_elements(p_rates)
  LOOP
    IF pg_catalog.jsonb_typeof(rate) <> 'object'
       OR rate->>'objectId' IS NULL OR rate->>'objectId' !~ '^[A-Za-z0-9._:-]{1,255}$'
       OR rate->>'amountCents' IS NULL OR rate->>'amountCents' !~ '^[0-9]{1,6}$'
       OR (rate->>'amountCents')::integer > 500000
       OR pg_catalog.lower(COALESCE(rate->>'currency', '')) <> pg_catalog.lower(locked_order.currency)
       OR rate->>'currency' !~ '^[A-Za-z]{3}$'
       OR pg_catalog.char_length(COALESCE(rate->>'label', '')) NOT BETWEEN 1 AND 200
       OR pg_catalog.char_length(COALESCE(rate->>'carrier', '')) > 100
       OR pg_catalog.char_length(COALESCE(rate->>'service', '')) > 100 THEN
      RAISE EXCEPTION 'Order label quote contains an invalid rate' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(DISTINCT value->>'objectId')
        FROM pg_catalog.jsonb_array_elements(p_rates))
     <> pg_catalog.jsonb_array_length(p_rates) THEN
    RAISE EXCEPTION 'Order label quote contains duplicate rates' USING ERRCODE = '22023';
  END IF;

  now_utc := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  quote_id := 'order-label-quote:' || pg_catalog.gen_random_uuid()::text;
  DELETE FROM public."OrderShippingRateQuote"
   WHERE "orderId" = locked_order.id;
  UPDATE public."Order" SET "shippoShipmentId" = p_shipment_id WHERE id = locked_order.id;
  INSERT INTO public."OrderShippingRateQuote" (
    id, "orderId", "shipmentId", rates, "expiresAt", "createdAt", "updatedAt"
  ) VALUES (
    quote_id, locked_order.id, p_shipment_id, p_rates,
    now_utc + interval '30 minutes', now_utc, now_utc
  );
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'changed', 'orderId', locked_order.id,
    'shipmentId', p_shipment_id, 'quoteId', quote_id,
    'expiresAt', now_utc + interval '30 minutes'
  );
END
$grainline_order_seller_label_quote_replace$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_label_claim(
  p_actor_user_id text,
  p_order_id text,
  p_rate_object_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_label_claim$
DECLARE
  locked_order public."Order"%ROWTYPE;
  seller_id text;
  selected_rate jsonb;
  selected_rate_id text;
  selected_amount integer;
  selected_currency text;
  claim_id text;
  claim_generation bigint;
  now_utc timestamp(3) without time zone;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_rate_object_id IS NOT NULL
       AND p_rate_object_id !~ '^[A-Za-z0-9._:-]{1,255}$') THEN
    RAISE EXCEPTION 'Order label claim input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT seller.id INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = p_actor_user_id AND NOT actor.banned AND actor."deletedAt" IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT candidate.* INTO locked_order
    FROM public."Order" AS candidate WHERE candidate.id = p_order_id
   FOR UPDATE OF candidate;
  IF NOT FOUND OR locked_order."sellerProfileId" IS DISTINCT FROM seller_id THEN RETURN NULL; END IF;

  IF locked_order."paidAt" IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'unpaid');
  END IF;
  IF public.grainline_order_refund_blocks_fulfillment(
      locked_order.id,
      locked_order."sellerRefundId",
      locked_order."sellerRefundLockedAt",
      locked_order."paymentRefundBlocked",
      locked_order."sellerRefundAmountCents",
      COALESCE(
      locked_order."chargedTotalCents",
      COALESCE(locked_order."itemsSubtotalCents", 0)
        + COALESCE(locked_order."shippingAmountCents", 0)
        + COALESCE(locked_order."giftWrappingPriceCents", 0)
        + COALESCE(locked_order."taxAmountCents", 0)
    )
    ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'refunded');
  END IF;
  IF locked_order."paymentOpenDisputeBlocked" THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'open_dispute');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."Case" AS source_case
     WHERE source_case."orderId" = locked_order.id
       AND source_case.status::text IN (
         'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW'
       )
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'active_case');
  END IF;
  IF locked_order."sellerDeauthorizedAt" IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'conflict', 'reason', 'seller_deauthorized'
    );
  END IF;
  IF locked_order."fulfillmentStatus"::text <> 'PENDING'
     OR COALESCE(locked_order."fulfillmentMethod"::text, 'SHIPPING') <> 'SHIPPING'
     OR locked_order."labelStatus"::text = 'PURCHASED' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'state_changed');
  END IF;
  IF locked_order."labelClaimStatus" IN (
    'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'conflict', 'reason', 'label_claim_active'
    );
  END IF;

  IF p_rate_object_id IS NULL THEN
    IF locked_order."shippoRateObjectId" IS NULL
       OR locked_order."shippoRateObjectId" IN ('fallback', 'pickup')
       OR locked_order."shippoRateObjectId" LIKE 'quote-only:%'
       OR locked_order."quotedShippingAmountCents" IS NULL
       OR locked_order."quotedShippingAmountCents" NOT BETWEEN 0 AND 500000
       OR locked_order."createdAt" <=
         (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '5 days' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'rate_required');
    END IF;
    selected_rate_id := locked_order."shippoRateObjectId";
    selected_amount := locked_order."quotedShippingAmountCents";
    selected_currency := pg_catalog.lower(locked_order.currency);
  ELSE
    SELECT rate.value INTO selected_rate
      FROM public."OrderShippingRateQuote" AS quote
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(quote.rates) AS rate(value)
     WHERE quote."orderId" = locked_order.id
       AND quote."expiresAt" > (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
       AND rate.value->>'objectId' = p_rate_object_id
     ORDER BY quote."createdAt" DESC, quote.id DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'rate_expired');
    END IF;
    IF selected_rate->>'amountCents' !~ '^[0-9]{1,6}$'
       OR (selected_rate->>'amountCents')::integer > 500000
       OR pg_catalog.lower(COALESCE(selected_rate->>'currency', ''))
          <> pg_catalog.lower(locked_order.currency) THEN
      RAISE EXCEPTION 'Persisted Order label rate is invalid' USING ERRCODE = '22023';
    END IF;
    selected_rate_id := p_rate_object_id;
    selected_amount := (selected_rate->>'amountCents')::integer;
    selected_currency := pg_catalog.lower(selected_rate->>'currency');
  END IF;

  claim_id := 'order-label-claim:' || pg_catalog.gen_random_uuid()::text;
  claim_generation := locked_order."labelClaimGeneration" + 1;
  now_utc := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."Order"
     SET "labelClaimId" = claim_id,
         "labelClaimGeneration" = claim_generation,
         "labelClaimStatus" = 'PROVIDER_PENDING',
         "labelClaimActorUserId" = p_actor_user_id,
         "labelClaimRateObjectId" = selected_rate_id,
         "labelClaimExpectedAmountCents" = selected_amount,
         "labelClaimCurrency" = selected_currency,
         "labelClaimStartedAt" = now_utc,
         "labelClaimProviderRecordedAt" = NULL,
         "shippoRateObjectId" = selected_rate_id
   WHERE id = locked_order.id;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'claimed', 'orderId', locked_order.id,
    'claimId', claim_id, 'claimGeneration', claim_generation,
    'rateObjectId', selected_rate_id, 'amountCents', selected_amount,
    'currency', selected_currency
  );
END
$grainline_order_seller_label_claim$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_label_provider_record(
  p_actor_user_id text,
  p_order_id text,
  p_claim_id text,
  p_claim_generation bigint,
  p_outcome text,
  p_transaction_id text,
  p_label_url text,
  p_provider_rate_object_id text,
  p_amount_cents integer,
  p_currency text,
  p_carrier text,
  p_tracking_number text,
  p_error_summary text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_label_provider_record$
DECLARE
  locked_order public."Order"%ROWTYPE;
  seller_id text;
  buyer_user_id text;
  buyer_name text;
  buyer_email text;
  buyer_notification_preferences jsonb;
  now_utc timestamp(3) without time zone;
  audit_id text;
  notification_dedup_key text;
  notification_replay_material text;
  next_clawback_status text;
  next_clawback_generation bigint;
  bounded_error text;
  refund_blocks_fulfillment boolean := false;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_id IS NULL OR p_claim_id !~ '^order-label-claim:[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_outcome IS NULL OR p_outcome NOT IN ('REJECTED', 'AMBIGUOUS', 'SUCCESS')
     OR (p_error_summary IS NOT NULL AND pg_catalog.char_length(p_error_summary) > 500) THEN
    RAISE EXCEPTION 'Order label provider result input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT seller.id INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = p_actor_user_id AND NOT actor.banned AND actor."deletedAt" IS NULL;
  IF NOT FOUND THEN
    -- Provider success may arrive after the originating seller is disabled.
    -- Exact evidence for the already-created pending or ambiguous claim may
    -- cross that timing boundary; a disabled actor cannot release or create a
    -- claim.
    IF p_outcome <> 'SUCCESS' THEN RETURN NULL; END IF;
    SELECT candidate."sellerProfileId" INTO seller_id
      FROM public."Order" AS candidate
     WHERE candidate.id = p_order_id
       AND candidate."labelClaimId" = p_claim_id
       AND candidate."labelClaimGeneration" = p_claim_generation
       AND candidate."labelClaimActorUserId" = p_actor_user_id
       AND candidate."labelClaimStatus" IN (
         'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS'
       );
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  SELECT candidate.* INTO locked_order
    FROM public."Order" AS candidate WHERE candidate.id = p_order_id
   FOR UPDATE OF candidate;
  IF NOT FOUND OR locked_order."sellerProfileId" IS DISTINCT FROM seller_id THEN RETURN NULL; END IF;

  IF locked_order."labelClaimId" IS DISTINCT FROM p_claim_id
     OR locked_order."labelClaimGeneration" <> p_claim_generation
     OR locked_order."labelClaimActorUserId" IS DISTINCT FROM p_actor_user_id THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'stale_claim');
  END IF;

  refund_blocks_fulfillment := public.grainline_order_refund_blocks_fulfillment(
      locked_order.id,
      locked_order."sellerRefundId",
      locked_order."sellerRefundLockedAt",
      locked_order."paymentRefundBlocked",
      locked_order."sellerRefundAmountCents",
      COALESCE(
      locked_order."chargedTotalCents",
      COALESCE(locked_order."itemsSubtotalCents", 0)
        + COALESCE(locked_order."shippingAmountCents", 0)
        + COALESCE(locked_order."giftWrappingPriceCents", 0)
        + COALESCE(locked_order."taxAmountCents", 0)
    )
    );

  now_utc := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  bounded_error := pg_catalog.left(
    pg_catalog.regexp_replace(COALESCE(p_error_summary, ''), '[[:space:]]+', ' ', 'g'),
    500
  );

  IF p_outcome = 'REJECTED' THEN
    -- Synchronous provider rejection may release only a pending claim. Once
    -- ambiguous, ordinary runtime authority cannot assert provider absence.
    IF locked_order."labelClaimStatus" <> 'PROVIDER_PENDING' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'stale_claim');
    END IF;
    UPDATE public."Order"
       SET "labelClaimId" = NULL, "labelClaimStatus" = NULL,
           "labelClaimActorUserId" = NULL, "labelClaimRateObjectId" = NULL,
           "labelClaimExpectedAmountCents" = NULL, "labelClaimCurrency" = NULL,
           "labelClaimStartedAt" = NULL, "labelClaimProviderRecordedAt" = NULL
     WHERE id = locked_order.id;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'released', 'orderId', locked_order.id
    );
  END IF;

  IF p_outcome = 'AMBIGUOUS' THEN
    IF locked_order."labelClaimStatus" <> 'PROVIDER_PENDING' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'stale_claim');
    END IF;
    UPDATE public."Order"
       SET "labelClaimStatus" = 'PROVIDER_AMBIGUOUS',
           "reviewNeeded" = true,
           "reviewNote" = pg_catalog.left(
             COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
             'AMBIGUOUS LABEL: Shippo did not return a conclusive label purchase response for claim ' ||
             p_claim_id || '. Staff must reconcile Shippo before this claim can be released.',
             10000
           )
     WHERE id = locked_order.id;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'ambiguous', 'orderId', locked_order.id,
      'claimId', p_claim_id, 'claimGeneration', p_claim_generation
    );
  END IF;

  IF locked_order."labelClaimStatus" IN ('PROVIDER_RECORDED', 'FINALIZED')
     AND locked_order."shippoTransactionId" IS NOT DISTINCT FROM p_transaction_id
     AND locked_order."labelClaimRateObjectId" IS NOT DISTINCT FROM p_provider_rate_object_id
     AND locked_order."labelCostCents" IS NOT DISTINCT FROM p_amount_cents THEN
    audit_id := pg_catalog.replace(p_claim_id, 'order-label-claim:', 'order-label-audit:');
  ELSIF locked_order."labelClaimStatus" NOT IN ('PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS') THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'stale_claim');
  ELSE
    IF p_transaction_id IS NULL OR p_transaction_id !~ '^[A-Za-z0-9._:-]{1,255}$'
       OR p_label_url IS NULL OR pg_catalog.char_length(p_label_url) > 2048
       OR p_label_url !~ '^https://[^[:space:]]+$'
       OR p_provider_rate_object_id IS DISTINCT FROM locked_order."labelClaimRateObjectId"
       OR p_amount_cents IS DISTINCT FROM locked_order."labelClaimExpectedAmountCents"
       OR pg_catalog.lower(COALESCE(p_currency, '')) IS DISTINCT FROM locked_order."labelClaimCurrency"
       OR p_carrier IS NULL OR pg_catalog.char_length(p_carrier) NOT BETWEEN 1 AND 100
       OR (p_tracking_number IS NOT NULL AND pg_catalog.char_length(p_tracking_number) > 100) THEN
      RAISE EXCEPTION 'Shippo label result does not match the fixed claim'
        USING ERRCODE = '22023';
    END IF;

    IF refund_blocks_fulfillment THEN
      -- Shippo has already created the label, so retain its terminal evidence.
      -- A concurrent Stripe refund makes automated fulfillment and transfer
      -- clawback unsafe; staff must reconcile and normally void the label.
      next_clawback_status := 'MANUAL_REVIEW';
      next_clawback_generation := locked_order."labelClawbackGeneration";
    ELSIF p_amount_cents = 0 THEN
      next_clawback_status := 'NOT_REQUIRED';
      next_clawback_generation := locked_order."labelClawbackGeneration";
    ELSIF locked_order."stripeTransferId" IS NULL THEN
      next_clawback_status := 'MANUAL_REVIEW';
      next_clawback_generation := locked_order."labelClawbackGeneration";
    ELSE
      next_clawback_status := 'RETRYING';
      next_clawback_generation := locked_order."labelClawbackGeneration" + 1;
    END IF;

    UPDATE public."Order"
       SET "shippoTransactionId" = p_transaction_id,
           "labelUrl" = p_label_url,
           "labelCarrier" = p_carrier,
           "labelTrackingNumber" = p_tracking_number,
           "labelCostCents" = p_amount_cents,
           "labelStatus" = 'PURCHASED'::public."LabelStatus",
           "labelPurchasedAt" = now_utc,
           "fulfillmentMethod" = CASE WHEN refund_blocks_fulfillment
             THEN "fulfillmentMethod" ELSE 'SHIPPING'::public."FulfillmentMethod" END,
           "fulfillmentStatus" = CASE WHEN refund_blocks_fulfillment
             THEN "fulfillmentStatus" ELSE 'SHIPPED'::public."FulfillmentStatus" END,
           "shippedAt" = CASE WHEN refund_blocks_fulfillment THEN "shippedAt" ELSE now_utc END,
           "trackingCarrier" = CASE WHEN refund_blocks_fulfillment
             THEN "trackingCarrier" ELSE p_carrier END,
           "trackingNumber" = CASE WHEN refund_blocks_fulfillment
             THEN "trackingNumber" ELSE p_tracking_number END,
           "labelClaimStatus" = CASE
             WHEN next_clawback_status IN ('NOT_REQUIRED', 'MANUAL_REVIEW') THEN 'FINALIZED'
             ELSE 'PROVIDER_RECORDED'
           END,
           "labelClaimProviderRecordedAt" = now_utc,
           "labelClawbackStatus" = next_clawback_status,
           "labelClawbackGeneration" = next_clawback_generation,
           "labelClawbackRetryCount" = CASE WHEN next_clawback_status = 'RETRYING' THEN 1 ELSE 0 END,
           "labelClawbackLastAttemptAt" = CASE WHEN next_clawback_status = 'RETRYING' THEN now_utc ELSE NULL END,
           "labelClawbackNextAttemptAt" = NULL,
           "labelClawbackResolvedAt" = CASE WHEN next_clawback_status = 'NOT_REQUIRED' THEN now_utc ELSE NULL END,
           "labelClawbackReversalId" = NULL,
           "reviewNeeded" = CASE WHEN next_clawback_status = 'MANUAL_REVIEW' THEN true ELSE "reviewNeeded" END,
           "reviewNote" = CASE WHEN refund_blocks_fulfillment THEN
             pg_catalog.left(
               COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
               'Shippo label ' || p_transaction_id || ' was purchased while this Order had a blocking refund state. ' ||
               'The Order was not marked shipped and no automatic transfer clawback was attempted. ' ||
               'Staff must reconcile and normally void the label.',
               10000
             )
           WHEN next_clawback_status = 'MANUAL_REVIEW' THEN
             pg_catalog.left(
               COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
               'Shippo label ' || p_transaction_id || ' cost ' || p_amount_cents::text ||
               ' ' || pg_catalog.upper(p_currency) ||
               ', but this Order has no Stripe transfer. Staff must reconcile the seller payout.',
               10000
             ) ELSE "reviewNote" END
     WHERE id = locked_order.id;

    audit_id := pg_catalog.replace(p_claim_id, 'order-label-claim:', 'order-label-audit:');
    INSERT INTO public."SystemAuditLog" (
      id, "actorType", "actorId", action, "targetType", "targetId", metadata, "createdAt"
    ) VALUES (
      audit_id, 'user', p_actor_user_id,
      CASE WHEN refund_blocks_fulfillment THEN 'ORDER_LABEL_REFUND_RACE_RECORDED'
        ELSE 'ORDER_FULFILLMENT_TRANSITION' END,
      'ORDER', locked_order.id,
      pg_catalog.jsonb_build_object(
        'action', CASE WHEN refund_blocks_fulfillment THEN 'label_refund_race' ELSE 'shipped' END,
        'newStatus', CASE WHEN refund_blocks_fulfillment
          THEN locked_order."fulfillmentStatus"::text ELSE 'SHIPPED' END,
        'trackingCarrier', p_carrier,
        'claimId', p_claim_id, 'claimGeneration', p_claim_generation,
        'rateObjectId', p_provider_rate_object_id, 'amountCents', p_amount_cents,
        'currency', pg_catalog.lower(p_currency), 'transactionId', p_transaction_id,
        'carrier', p_carrier, 'hasTrackingNumber', p_tracking_number IS NOT NULL
      ), now_utc
    );
  END IF;

  SELECT buyer.id, buyer.name, buyer.email, buyer."notificationPreferences"
    INTO buyer_user_id, buyer_name, buyer_email, buyer_notification_preferences
    FROM public."User" AS buyer
   WHERE buyer.id = locked_order."buyerId" AND NOT buyer.banned AND buyer."deletedAt" IS NULL
   FOR SHARE OF buyer;

  -- This label-specific notification is inserted by the same fixed operation
  -- that owns the durable fulfillment transition. The generic Notification
  -- order-family function intentionally still derives seller identity through
  -- mutable Listing rows, so calling it here would let later Listing ownership
  -- drift roll back a valid label purchase. Use the immutable Order seller key,
  -- derive every payload field here, and retain the existing preference and
  -- replay semantics without exposing generic Notification INSERT authority.
  IF NOT refund_blocks_fulfillment
     AND FOUND
     AND buyer_notification_preferences -> 'ORDER_SHIPPED' IS DISTINCT FROM 'false'::jsonb THEN
    notification_replay_material := pg_catalog.concat_ws(
      pg_catalog.chr(31),
      'grainline-notification-v1',
      buyer_user_id,
      'ORDER_SHIPPED',
      'order_fulfillment',
      audit_id,
      p_actor_user_id
    );
    notification_dedup_key :=
      pg_catalog.md5(notification_replay_material)
      || pg_catalog.md5('grainline-notification-v1-secondary' || notification_replay_material);

    INSERT INTO public."Notification" (
      id, "userId", "relatedUserId", type, title, body, link,
      "sourceType", "sourceId", "dedupKey", read, "createdAt"
    ) VALUES (
      pg_catalog.gen_random_uuid()::text,
      buyer_user_id,
      p_actor_user_id,
      'ORDER_SHIPPED'::public."NotificationType",
      'Your piece is on its way!',
      'Shipped via ' || p_carrier,
      '/dashboard/orders/' || locked_order.id,
      'order_fulfillment',
      audit_id,
      notification_dedup_key,
      false,
      pg_catalog.clock_timestamp()
    ) ON CONFLICT ("userId", type, "dedupKey") DO NOTHING;
  END IF;

  SELECT candidate.* INTO locked_order FROM public."Order" AS candidate
   WHERE candidate.id = p_order_id;
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'recorded', 'orderId', locked_order.id,
    'claimId', locked_order."labelClaimId",
    'claimGeneration', locked_order."labelClaimGeneration",
    'clawbackGeneration', locked_order."labelClawbackGeneration",
    'clawbackStatus', locked_order."labelClawbackStatus",
    'stripeTransferId', locked_order."stripeTransferId",
    'transactionId', locked_order."shippoTransactionId",
    'rateObjectId', locked_order."labelClaimRateObjectId",
    'amountCents', locked_order."labelCostCents",
    'currency', locked_order."labelClaimCurrency",
    'carrier', locked_order."labelCarrier",
    'trackingNumber', locked_order."labelTrackingNumber",
    'labelPurchasedAt', locked_order."labelPurchasedAt",
    'fulfillmentStatus', locked_order."fulfillmentStatus"::text,
    'auditLogId', audit_id,
    'buyerUserId', buyer_user_id, 'buyerName', buyer_name, 'buyerEmail', buyer_email,
    'estimatedDeliveryDate', locked_order."estimatedDeliveryDate"
  );
END
$grainline_order_seller_label_provider_record$;



COMMIT;
