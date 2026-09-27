-- Replace mutable review-note inference with the durable seller deauthorization witness.
-- This successor changes no RLS posture or table grants.

BEGIN;

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
  IF locked_order."sellerRefundId" IS NOT NULL
     OR locked_order."paymentRefundBlocked" THEN
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

COMMIT;
