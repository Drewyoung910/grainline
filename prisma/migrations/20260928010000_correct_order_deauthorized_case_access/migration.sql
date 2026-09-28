-- Keep the durable seller-deauthorization fulfillment hold while
-- giving the affected buyer an immediate Case recovery path. The label-purchase
-- exclusion remains intact, and no table grant or RLS posture changes.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order.deauthorized-case-access', 0)
);

DO $grainline_order_deauthorized_case_access_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure('public.grainline_case_open(text,text,text,text)')
       AND pg_catalog.pg_get_userbyid(routine.proowner) = current_user
       AND routine.prosecdef
       AND routine.provolatile = 'v'
       AND routine.proparallel = 'u'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')),
             'hex'
           ) = 'e1bdb4a86f13c0115e2a450de06cb0881b115a58d9bb7b9c68b6963654649bc9'
       AND pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           )
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
                  COALESCE(
                    routine.proacl,
                    pg_catalog.acldefault('f', routine.proowner)
                  )
                ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'Order deauthorized Case-access function drifted: public.grainline_case_open(text,text,text,text)';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure('public.grainline_order_buyer_detail_v3(text,text)')
       AND pg_catalog.pg_get_userbyid(routine.proowner) = current_user
       AND routine.prosecdef
       AND routine.provolatile = 's'
       AND routine.proparallel = 's'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')),
             'hex'
           ) = 'a70730f1adf31821aaf4b9c46619f3e026b7cd0312900c57b4b796bb93090d2a'
       AND pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           )
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
                  COALESCE(
                    routine.proacl,
                    pg_catalog.acldefault('f', routine.proowner)
                  )
                ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'Order deauthorized Case-access function drifted: public.grainline_order_buyer_detail_v3(text,text)';
  END IF;

  IF NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = 'public."Order"'::pg_catalog.regclass
          AND attribute.attname = 'sellerDeauthorizedAt'
          AND attribute.atttypid = 'pg_catalog.timestamp'::pg_catalog.regtype
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
                = 'timestamp(3) without time zone'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.conrelid =
                'public."Order"'::pg_catalog.regclass
          AND constraint_state.conname = 'Order_sellerDeauthorization_check'
          AND constraint_state.contype = 'c'
          AND constraint_state.convalidated
     ) THEN
    RAISE EXCEPTION 'Order seller-deauthorization witness contract is missing';
  END IF;
END
$grainline_order_deauthorized_case_access_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_case_open(
  p_actor_user_id text,
  p_order_id text,
  p_reason text,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_open$
DECLARE
  locked_actor record;
  locked_order record;
  locked_seller record;
  existing_case record;
  existing_application record;
  opening_message record;
  opening_audit record;
  existing_case_found boolean;
  existing_application_found boolean;
  item_count integer;
  seller_count integer;
  only_seller_user_id text;
  normalized_reason public."CaseReason";
  description_sha256 text;
  window_reference_at timestamp(3);
  transition_at timestamp(3);
  target_case_id text;
  target_message_id text;
  target_audit_id text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_order_id IS NULL
     OR pg_catalog.btrim(p_order_id) = ''
     OR pg_catalog.char_length(p_order_id) > 191
     OR p_reason IS NULL
     OR p_reason NOT IN (
       'NOT_RECEIVED',
       'NOT_AS_DESCRIBED',
       'DAMAGED',
       'WRONG_ITEM',
       'OTHER'
     )
     OR p_description IS NULL
     OR p_description IS DISTINCT FROM pg_catalog.btrim(p_description)
     OR pg_catalog.char_length(p_description) < 20
     OR pg_catalog.char_length(p_description) > 2000
     OR pg_catalog.octet_length(p_description) > 8000 THEN
    RAISE EXCEPTION 'Case-open input is invalid'
      USING ERRCODE = '22023';
  END IF;
  normalized_reason := p_reason::public."CaseReason";
  description_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_description, 'UTF8')),
    'hex'
  );

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
    RAISE EXCEPTION 'Case-open actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    orders.id,
    orders."buyerId",
    orders."paidAt",
    orders."fulfillmentStatus",
    orders."labelStatus",
    orders."estimatedDeliveryDate",
    orders."deliveredAt",
    orders."pickedUpAt",
    orders."reviewNeeded",
    orders."sellerRefundId",
    orders."caseResolutionClaimId",
    orders."sellerDeauthorizedAt"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case-open Order does not exist'
      USING ERRCODE = '23503';
  END IF;
  IF locked_order."buyerId" IS DISTINCT FROM locked_actor.id THEN
    RAISE EXCEPTION 'Case-open buyer authority is invalid'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the complete Order/seller relationship before deriving the one exact
  -- seller. The seller User account state is read after this stable graph; it
  -- is intentionally not locked after Order, avoiding a User/Order lock-order
  -- inversion with seller-owned lifecycle operations.
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(DISTINCT source.seller_user_id)::integer,
    pg_catalog.min(source.seller_user_id)
    INTO item_count, seller_count, only_seller_user_id
    FROM (
      SELECT seller."userId" AS seller_user_id
        FROM public."OrderItem" AS item
        JOIN public."Listing" AS listing ON listing.id = item."listingId"
        JOIN public."SellerProfile" AS seller
          ON seller.id = listing."sellerId"
       WHERE item."orderId" = locked_order.id
       ORDER BY item.id, listing.id, seller.id
       FOR SHARE OF item, listing, seller
    ) AS source;
  IF item_count < 1
     OR seller_count <> 1
     OR only_seller_user_id IS NULL
     OR only_seller_user_id = locked_actor.id THEN
    RAISE EXCEPTION 'Case-open Order has invalid participants'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    seller_user.id,
    seller_user.banned,
    seller_user."deletedAt"
    INTO locked_seller
    FROM public."User" AS seller_user
   WHERE seller_user.id = only_seller_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case-open seller does not exist'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.reason,
    case_row.description,
    case_row.status,
    case_row."openedByPaymentEventId",
    case_row."sellerRespondBy",
    case_row."createdAt"
    INTO existing_case
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = locked_order.id
   FOR UPDATE;
  existing_case_found := FOUND;

  SELECT
    application."orderId",
    application."caseId",
    application."buyerUserId",
    application."sellerUserId",
    application."openingMessageId",
    application.reason,
    application."descriptionSha256",
    application."auditLogId",
    application."createdAt"
    INTO existing_application
    FROM public."CaseOpenApplication" AS application
   WHERE application."orderId" = locked_order.id
   FOR SHARE;
  existing_application_found := FOUND;

  IF existing_case_found OR existing_application_found THEN
    IF NOT existing_case_found
       OR NOT existing_application_found
       OR existing_application."caseId" IS DISTINCT FROM existing_case.id
       OR existing_application."buyerUserId" IS DISTINCT FROM locked_actor.id
       OR existing_application."sellerUserId"
            IS DISTINCT FROM only_seller_user_id
       OR existing_application.reason IS DISTINCT FROM normalized_reason
       OR existing_application."descriptionSha256"
            IS DISTINCT FROM description_sha256
       OR existing_case."orderId" IS DISTINCT FROM locked_order.id
       OR existing_case."buyerId" IS DISTINCT FROM locked_actor.id
       OR existing_case."sellerId" IS DISTINCT FROM only_seller_user_id
       OR existing_case.reason IS DISTINCT FROM normalized_reason
       OR existing_case.description IS DISTINCT FROM p_description
       OR existing_case."openedByPaymentEventId" IS NOT NULL
       OR existing_case."createdAt"
            IS DISTINCT FROM existing_application."createdAt"
       OR existing_case."sellerRespondBy"
            IS DISTINCT FROM
              existing_application."createdAt" + INTERVAL '48 hours' THEN
      RAISE EXCEPTION 'Case-open replay authority is invalid'
        USING ERRCODE = '23505';
    END IF;

    SELECT
      message.id,
      message."caseId",
      message."authorId",
      message."authorKind",
      message.body,
      message."createdAt"
      INTO opening_message
      FROM public."CaseMessage" AS message
     WHERE message.id = existing_application."openingMessageId"
     FOR SHARE;
    IF NOT FOUND
       OR opening_message."caseId" IS DISTINCT FROM existing_case.id
       OR opening_message."authorId" IS DISTINCT FROM locked_actor.id
       OR opening_message."authorKind"
            IS DISTINCT FROM 'BUYER'::public."CaseMessageAuthorKind"
       OR opening_message.body IS DISTINCT FROM p_description
       OR opening_message."createdAt"
            IS DISTINCT FROM existing_application."createdAt" THEN
      RAISE EXCEPTION 'Case-open replay message is invalid'
        USING ERRCODE = '23505';
    END IF;

    SELECT
      audit.id,
      audit."adminId",
      audit.action,
      audit."targetType",
      audit."targetId",
      audit.reason,
      audit.metadata,
      audit.undone,
      audit."undoneAt",
      audit."undoneBy",
      audit."undoneReason",
      audit."createdAt"
      INTO opening_audit
      FROM public."AdminAuditLog" AS audit
     WHERE audit.id = existing_application."auditLogId"
     FOR SHARE;
    IF NOT FOUND
       OR opening_audit."adminId" IS DISTINCT FROM locked_actor.id
       OR opening_audit.action IS DISTINCT FROM 'BUYER_OPEN_CASE'
       OR opening_audit."targetType" IS DISTINCT FROM 'CASE'
       OR opening_audit."targetId" IS DISTINCT FROM existing_case.id
       OR opening_audit.reason IS NOT NULL
       OR opening_audit.undone
       OR opening_audit."undoneAt" IS NOT NULL
       OR opening_audit."undoneBy" IS NOT NULL
       OR opening_audit."undoneReason" IS NOT NULL
       OR opening_audit."createdAt"
            IS DISTINCT FROM existing_application."createdAt"
       OR pg_catalog.jsonb_typeof(opening_audit.metadata) <> 'object'
       OR (
         opening_audit.metadata
           - 'actorKind'
           - 'orderId'
           - 'sellerId'
           - 'reason'
           - 'openingMessageId'
           - 'at'
       ) <> '{}'::jsonb
       OR opening_audit.metadata->>'actorKind' IS DISTINCT FROM 'user'
       OR opening_audit.metadata->>'orderId'
            IS DISTINCT FROM locked_order.id
       OR opening_audit.metadata->>'sellerId'
            IS DISTINCT FROM only_seller_user_id
       OR opening_audit.metadata->>'reason'
            IS DISTINCT FROM normalized_reason::text
       OR opening_audit.metadata->>'openingMessageId'
            IS DISTINCT FROM existing_application."openingMessageId"
       OR opening_audit.metadata->>'at' IS DISTINCT FROM
            pg_catalog.to_char(
              existing_application."createdAt",
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ) THEN
      RAISE EXCEPTION 'Case-open replay audit is invalid'
        USING ERRCODE = '23505';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'caseId', existing_case.id,
      'orderId', locked_order.id,
      'buyerUserId', locked_actor.id,
      'sellerUserId', only_seller_user_id,
      'openingMessageId', existing_application."openingMessageId",
      'auditLogId', existing_application."auditLogId",
      'reason', existing_case.reason::text,
      'status', existing_case.status::text,
      'action', 'replay'
    );
  END IF;

  transition_at := pg_catalog.timezone(
    'UTC',
    pg_catalog.clock_timestamp()
  );
  IF locked_order."paidAt" IS NULL THEN
    RAISE EXCEPTION 'Case-open Order is not paid'
      USING ERRCODE = '23514';
  END IF;
  IF locked_order."caseResolutionClaimId" IS NOT NULL
     OR locked_order."sellerRefundId" IS NOT NULL THEN
    RAISE EXCEPTION 'Case-open conflicts with refund or staff state'
      USING ERRCODE = '23505';
  END IF;
  PERFORM 1
    FROM public."OrderPaymentEvent" AS payment_event
   WHERE payment_event."orderId" = locked_order.id
     AND payment_event."eventType" = 'REFUND'
     AND (
       payment_event.status IS NULL
       OR payment_event.status NOT IN ('failed', 'canceled', 'cancelled')
     )
   LIMIT 1
   FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION 'Case-open Order has refund evidence'
      USING ERRCODE = '23505';
  END IF;

  IF locked_order."labelStatus" = 'PURCHASED'::public."LabelStatus"
     AND locked_order."fulfillmentStatus"
           = 'PENDING'::public."FulfillmentStatus" THEN
    RAISE EXCEPTION 'Case-open label purchase is active'
      USING ERRCODE = '23514';
  END IF;
  IF locked_order."fulfillmentStatus"
       = 'PENDING'::public."FulfillmentStatus"
     AND NOT locked_seller.banned
     AND locked_seller."deletedAt" IS NULL
     AND locked_order."sellerDeauthorizedAt" IS NULL
     AND NOT locked_order."reviewNeeded" THEN
    RAISE EXCEPTION 'Case-open Order has not shipped'
      USING ERRCODE = '23514';
  END IF;
  IF locked_order."estimatedDeliveryDate" IS NOT NULL
     AND locked_order."estimatedDeliveryDate" > transition_at
     AND NOT locked_seller.banned
     AND locked_seller."deletedAt" IS NULL
     AND locked_order."sellerDeauthorizedAt" IS NULL
     AND NOT locked_order."reviewNeeded" THEN
    RAISE EXCEPTION 'Case-open estimated delivery is in the future'
      USING ERRCODE = '23514';
  END IF;

  window_reference_at := CASE
    WHEN locked_order."fulfillmentStatus"
           = 'DELIVERED'::public."FulfillmentStatus"
      THEN COALESCE(
        locked_order."deliveredAt",
        locked_order."estimatedDeliveryDate"
      )
    WHEN locked_order."fulfillmentStatus"
           = 'PICKED_UP'::public."FulfillmentStatus"
      THEN COALESCE(
        locked_order."pickedUpAt",
        locked_order."estimatedDeliveryDate"
      )
    ELSE locked_order."estimatedDeliveryDate"
  END;
  IF window_reference_at IS NOT NULL
     AND window_reference_at + INTERVAL '30 days' < transition_at
     AND NOT (
       locked_order."sellerDeauthorizedAt" IS NOT NULL
       AND locked_order."fulfillmentStatus" =
             'PENDING'::public."FulfillmentStatus"
     ) THEN
    RAISE EXCEPTION 'Case-open window has closed'
      USING ERRCODE = '23514';
  END IF;

  target_case_id := pg_catalog.gen_random_uuid()::text;
  target_message_id := pg_catalog.gen_random_uuid()::text;
  target_audit_id :=
    'case-open-audit:' || pg_catalog.gen_random_uuid()::text;

  INSERT INTO public."Case" (
    id,
    "orderId",
    "buyerId",
    "sellerId",
    reason,
    description,
    status,
    resolution,
    "refundAmountCents",
    "stripeRefundId",
    "sellerRespondBy",
    "discussionStartedAt",
    "escalateUnlocksAt",
    "buyerMarkedResolved",
    "sellerMarkedResolved",
    "resolvedAt",
    "resolvedById",
    "openedByPaymentEventId",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    target_case_id,
    locked_order.id,
    locked_actor.id,
    only_seller_user_id,
    normalized_reason,
    p_description,
    'OPEN'::public."CaseStatus",
    NULL,
    NULL,
    NULL,
    transition_at + INTERVAL '48 hours',
    NULL,
    NULL,
    false,
    false,
    NULL,
    NULL,
    NULL,
    transition_at,
    transition_at
  );

  INSERT INTO public."CaseMessage" (
    id,
    "caseId",
    "authorId",
    "authorKind",
    body,
    "createdAt"
  )
  VALUES (
    target_message_id,
    target_case_id,
    locked_actor.id,
    'BUYER'::public."CaseMessageAuthorKind",
    p_description,
    transition_at
  );

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
    target_audit_id,
    locked_actor.id,
    'BUYER_OPEN_CASE',
    'CASE',
    target_case_id,
    NULL,
    pg_catalog.jsonb_build_object(
      'actorKind', 'user',
      'orderId', locked_order.id,
      'sellerId', only_seller_user_id,
      'reason', normalized_reason::text,
      'openingMessageId', target_message_id,
      'at', pg_catalog.to_char(
        transition_at,
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ),
    false,
    transition_at
  );

  INSERT INTO public."CaseOpenApplication" (
    "orderId",
    "caseId",
    "buyerUserId",
    "sellerUserId",
    "openingMessageId",
    reason,
    "descriptionSha256",
    "auditLogId",
    "createdAt"
  )
  VALUES (
    locked_order.id,
    target_case_id,
    locked_actor.id,
    only_seller_user_id,
    target_message_id,
    normalized_reason,
    description_sha256,
    target_audit_id,
    transition_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'caseId', target_case_id,
    'orderId', locked_order.id,
    'buyerUserId', locked_actor.id,
    'sellerUserId', only_seller_user_id,
    'openingMessageId', target_message_id,
    'auditLogId', target_audit_id,
    'reason', normalized_reason::text,
    'status', 'OPEN',
    'action', 'created'
  );
END
$grainline_case_open$;

CREATE FUNCTION public.grainline_order_buyer_detail_v4(
  p_actor_user_id text,
  p_order_id text
)
RETURNS TABLE(
  order_id text,
  created_at_epoch_millis bigint,
  paid_at_epoch_millis bigint,
  currency text,
  items_subtotal_cents integer,
  shipping_title text,
  shipping_amount_cents integer,
  tax_amount_cents integer,
  fulfillment_method text,
  fulfillment_status text,
  tracking_carrier text,
  tracking_number text,
  pickup_ready_at_epoch_millis bigint,
  picked_up_at_epoch_millis bigint,
  shipped_at_epoch_millis bigint,
  delivered_at_epoch_millis bigint,
  estimated_delivery_at_epoch_millis bigint,
  shipping_carrier text,
  shipping_service text,
  review_needed boolean,
  deauthorized_case_access boolean,
  case_open_label_blocked boolean,
  gift_note text,
  gift_wrapping boolean,
  gift_wrapping_price_cents integer,
  buyer_data_purged_at_epoch_millis bigint,
  ship_to_line_1 text,
  ship_to_line_2 text,
  ship_to_city text,
  ship_to_state text,
  ship_to_postal_code text,
  ship_to_country text,
  seller_refund_state text,
  seller_refund_amount_cents integer,
  seller_user_id text,
  items jsonb
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_detail_v4$
  SELECT
    detail.order_id,
    detail.created_at_epoch_millis,
    detail.paid_at_epoch_millis,
    detail.currency,
    detail.items_subtotal_cents,
    detail.shipping_title,
    detail.shipping_amount_cents,
    detail.tax_amount_cents,
    detail.fulfillment_method,
    detail.fulfillment_status,
    detail.tracking_carrier,
    detail.tracking_number,
    detail.pickup_ready_at_epoch_millis,
    detail.picked_up_at_epoch_millis,
    detail.shipped_at_epoch_millis,
    detail.delivered_at_epoch_millis,
    detail.estimated_delivery_at_epoch_millis,
    detail.shipping_carrier,
    detail.shipping_service,
    detail.review_needed,
    source_order."sellerDeauthorizedAt" IS NOT NULL
      AND NOT (
        source_order."labelStatus"::text IS NOT DISTINCT FROM 'PURCHASED'
        AND source_order."fulfillmentStatus"::text IS NOT DISTINCT FROM 'PENDING'
      ),
    source_order."labelStatus"::text IS NOT DISTINCT FROM 'PURCHASED'
      AND source_order."fulfillmentStatus"::text IS NOT DISTINCT FROM 'PENDING',
    detail.gift_note,
    detail.gift_wrapping,
    detail.gift_wrapping_price_cents,
    detail.buyer_data_purged_at_epoch_millis,
    detail.ship_to_line_1,
    detail.ship_to_line_2,
    detail.ship_to_city,
    detail.ship_to_state,
    detail.ship_to_postal_code,
    detail.ship_to_country,
    detail.seller_refund_state,
    detail.seller_refund_amount_cents,
    detail.seller_user_id,
    detail.items
  FROM public.grainline_order_buyer_detail_v3(p_actor_user_id, p_order_id) AS detail
  JOIN public."Order" AS source_order
    ON source_order.id = detail.order_id;
$grainline_order_buyer_detail_v4$;

REVOKE ALL ON FUNCTION public.grainline_order_buyer_detail_v4(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_detail_v4(text, text)
  TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_order_buyer_detail_v4(text, text) IS
  'Returns buyer Order detail plus bounded Case-access signals for durable seller deauthorization and an active purchased-label claim.';

DO $grainline_order_deauthorized_case_access_postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure('public.grainline_case_open(text,text,text,text)')
       AND pg_catalog.pg_get_userbyid(routine.proowner) = current_user
       AND routine.prosecdef
       AND routine.provolatile = 'v'
       AND routine.proparallel = 'u'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')),
             'hex'
           ) = '601c16ca75b6da9d251b88d81c83e69df0568d0f56ffea870122e1c5be0f4e31'
       AND pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           )
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
                  COALESCE(
                    routine.proacl,
                    pg_catalog.acldefault('f', routine.proowner)
                  )
                ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'Order deauthorized Case-access function drifted: public.grainline_case_open(text,text,text,text)';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure('public.grainline_order_buyer_detail_v4(text,text)')
       AND pg_catalog.pg_get_userbyid(routine.proowner) = current_user
       AND routine.prosecdef
       AND routine.provolatile = 's'
       AND routine.proparallel = 's'
       AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc, 'UTF8')),
             'hex'
           ) = 'e5d15680f411f9e0de3233b4d2c48b5e0f00fe682337f8652d3a5ed95ecffc9e'
       AND pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           )
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
                  COALESCE(
                    routine.proacl,
                    pg_catalog.acldefault('f', routine.proowner)
                  )
                ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'Order deauthorized Case-access function drifted: public.grainline_order_buyer_detail_v4(text,text)';
  END IF;
END
$grainline_order_deauthorized_case_access_postflight$;

COMMIT;
