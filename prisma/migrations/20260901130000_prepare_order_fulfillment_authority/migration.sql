-- Compatible fixed write authority for seller fulfillment, buyer receipt and
-- seller-private Order notes. This migration changes no RLS posture or table
-- grants; predecessor direct writes remain compatible until application
-- conversion and a separately reviewed activation release.

BEGIN;

CREATE FUNCTION public.grainline_order_seller_fulfillment_transition(
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
  IF locked_order."reviewNeeded"
     AND COALESCE(locked_order."reviewNote", '') LIKE
       'Seller Stripe account was deauthorized after payment.%' THEN
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

CREATE FUNCTION public.grainline_order_buyer_receipt_confirm(
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

CREATE FUNCTION public.grainline_order_seller_notes_update(
  p_actor_user_id text,
  p_order_id text,
  p_seller_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_notes_update$
DECLARE
  locked_actor public."User"%ROWTYPE;
  source_seller_id text;
  locked_order public."Order"%ROWTYPE;
  transition_at timestamp(3) without time zone;
  audit_id text;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_seller_notes IS NOT NULL AND pg_catalog.char_length(p_seller_notes) > 2000) THEN
    RAISE EXCEPTION 'Order seller-note input is invalid'
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

  SELECT seller.id
    INTO source_seller_id
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
  IF NOT FOUND OR locked_order."sellerProfileId" IS DISTINCT FROM source_seller_id THEN
    RETURN NULL;
  END IF;

  IF locked_order."paidAt" IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'unpaid');
  END IF;
  IF p_seller_notes IS NOT NULL AND locked_order."buyerDataPurgedAt" IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'buyer_data_purged');
  END IF;

  transition_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."Order" AS target_order
     SET "sellerNotes" = p_seller_notes
   WHERE target_order.id = locked_order.id;

  audit_id := 'order-seller-note-audit:' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId", metadata,
    "createdAt"
  ) VALUES (
    audit_id,
    'user',
    locked_actor.id,
    'ORDER_SELLER_NOTES_UPDATED',
    'ORDER',
    locked_order.id,
    pg_catalog.jsonb_build_object('hasNotes', p_seller_notes IS NOT NULL),
    transition_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'changed',
    'orderId', locked_order.id,
    'auditLogId', audit_id,
    'hasNotes', p_seller_notes IS NOT NULL
  );
END
$grainline_order_seller_notes_update$;

REVOKE ALL ON FUNCTION public.grainline_order_seller_fulfillment_transition(
  text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_buyer_receipt_confirm(
  text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_notes_update(
  text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_order_seller_fulfillment_transition(
  text, text, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_receipt_confirm(
  text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_notes_update(
  text, text, text
) TO grainline_app_runtime;

COMMIT;
