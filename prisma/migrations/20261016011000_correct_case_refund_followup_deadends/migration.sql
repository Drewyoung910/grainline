-- Close verified Case-refund recovery dead ends (#710-#714).
-- Function signatures, owners, SECURITY DEFINER settings, search paths, and
-- ACLs are preserved. No table, trigger, constraint, or grant changes occur.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.case.refund-followup-deadends.correction',
    0
  )
);

CREATE TEMP TABLE _case_followup_fn_snapshot (
  sig text PRIMARY KEY, owner text, secdef boolean, cfg text[], acl text
);

DO $preflight$
DECLARE
  expected jsonb := '{"public.grainline_case_staff_resolution_prepare(text,text,public.\"CaseResolution\",integer,jsonb)":{"sha":"151ee58a079a31f106d43d449d22836fda92183cbe338df3a0f733c80f0ab4b6","runtime":true},"public.grainline_case_staff_resolution_finalize(text,text)":{"sha":"7c0033c9bc26e7f42ebec452e808e4aa8ac1a339710a2f25393ba34173fbd7de","runtime":true},"public.grainline_case_staff_resolution_provider_recovery_load(text,text,public.\"CaseResolution\",integer)":{"sha":"e7a810360957b526a2cbc3e3af74d9bde4dca2bc658fccc4c58008b8c34c7ce5","runtime":true},"public.grainline_case_staff_resolution_recovery_finalize(text,text)":{"sha":"3fa0b657266a91846b0dd2294d289c8162248ca2a6b6ec07c09be1683fde86b3","runtime":true},"public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)":{"sha":"382958aba3a01b33431033c3a04370141d380f79b01aed9a1d6492ea58cee3f4","runtime":true},"public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)":{"sha":"9507c46dedf252030f38c62d820fc8569376f9dfb888187980094294a244b96e","runtime":true},"public.grainline_order_payment_projection_state(text)":{"sha":"ad3cd33562a5e92b0639322a28a5675d4264777988153801b0d70ed0983f7f79","runtime":false},"public.grainline_order_ops_health_summary()":{"sha":"37e7214b0963fe011a32be83375a1eac5ed6217fa85b5c53595306ac60b2a323","runtime":true}}'::jsonb;
  item record;
  fn regprocedure;
  actual text;
BEGIN
  FOR item IN
    SELECT key,
           value->>'sha' AS sha,
           (value->>'runtime')::boolean AS runtime
      FROM pg_catalog.jsonb_each(expected)
  LOOP
    fn := pg_catalog.to_regprocedure(item.key);
    IF fn IS NULL THEN
      RAISE EXCEPTION 'case follow-up preflight: % is missing', item.key;
    END IF;
    SELECT pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')),
             'hex'
           )
      INTO actual
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = fn
       AND p.prosecdef
       AND p.proconfig = ARRAY['search_path=pg_catalog']::text[];
    IF actual IS DISTINCT FROM item.sha
       OR pg_catalog.has_function_privilege(
         'grainline_app_runtime', fn, 'EXECUTE'
       ) IS DISTINCT FROM item.runtime
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_proc AS p,
                LATERAL pg_catalog.aclexplode(
                  COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
                ) AS acl
          WHERE p.oid = fn
            AND acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'case follow-up preflight: % drifted', item.key;
    END IF;
    INSERT INTO _case_followup_fn_snapshot
    SELECT item.key, pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef,
           p.proconfig, COALESCE(p.proacl::text, '')
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = fn;
  END LOOP;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_prepare(p_actor_user_id text, p_case_id text, p_resolution "CaseResolution", p_partial_refund_amount_cents integer, p_stock_restore_decision jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  existing_claim record;
  existing_found boolean := false;
  dismissal_takeover boolean := false;
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
  historical_refund_event_id text;
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

  -- #605/#677 separation of duties: staff who are this Case's buyer or
  -- seller may not resolve it. Runs before any provider call.
  IF locked_actor.id = locked_case."sellerId"
     OR locked_actor.id IS NOT DISTINCT FROM locked_case."buyerId" THEN
    RAISE EXCEPTION 'Case staff-resolution actor is a Case party'
      USING ERRCODE = '42501';
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
      claim."orderPaymentEventId",
      claim."createdAt"
      INTO existing_claim
      FROM public."CaseResolutionClaim" AS claim
     WHERE claim.id = locked_order."caseResolutionClaimId"
     FOR SHARE;
    existing_found := FOUND;
    -- #678: a current ADMIN may take over a staged dismissal (no provider
    -- effect) whose preparing staff member is no longer active staff or is a
    -- party of the Case (pre-#677 claim). Only the identical DISMISSED
    -- request is accepted; the claim itself stays immutable.
    IF existing_found
       AND existing_claim."staffActorId" IS DISTINCT FROM locked_actor.id
       AND locked_actor.role = 'ADMIN'::public."Role"
       AND existing_claim.resolution = 'DISMISSED'::public."CaseResolution"
       AND existing_claim.status =
             'LOCAL_READY'::public."CaseResolutionClaimStatus"
       AND p_resolution = 'DISMISSED'::public."CaseResolution" THEN
      dismissal_takeover :=
        existing_claim."staffActorId" IS NOT DISTINCT FROM locked_case."sellerId"
        OR existing_claim."staffActorId" IS NOT DISTINCT FROM locked_case."buyerId"
        OR NOT EXISTS (
          SELECT 1
            FROM public."User" AS original_staff
           WHERE original_staff.id = existing_claim."staffActorId"
             AND NOT original_staff.banned
             AND original_staff."deletedAt" IS NULL
             AND original_staff.role IN (
               'EMPLOYEE'::public."Role",
               'ADMIN'::public."Role"
             )
        );
    END IF;
    IF NOT existing_found
       OR existing_claim."caseId" IS DISTINCT FROM locked_case.id
       OR existing_claim."orderId" IS DISTINCT FROM locked_order.id
       OR (
         existing_claim."staffActorId" IS DISTINCT FROM locked_actor.id
         AND NOT dismissal_takeover
       )
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

    -- #710: repair the exact historical state created when a signed
    -- charge.refunded event overwrote an ambiguous Case marker. The Order is
    -- locked, the active claim is exact, and the signed ledger row must carry
    -- the false pending-local-lock value written by the predecessor after the
    -- ambiguous marker was overwritten.
    IF existing_claim.status =
         'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
       AND locked_order."sellerRefundId" IS NOT NULL
       AND locked_order."sellerRefundId" NOT IN (
         'pending',
         'ambiguous_refund_pending_reconciliation'
       )
       AND locked_order."sellerRefundLockedAt" IS NULL
       AND existing_claim."orderPaymentEventId" IS NULL THEN
      SELECT refund_event.id
        INTO historical_refund_event_id
        FROM public."OrderPaymentEvent" AS refund_event
       WHERE refund_event."orderId" = locked_order.id
         AND refund_event."eventType" = 'REFUND'
         AND refund_event."stripeObjectType" = 'refund'
         AND refund_event."stripeEventId" ~ '^evt_'
         AND refund_event."stripeObjectId" = locked_order."sellerRefundId"
         AND refund_event.currency = existing_claim.currency
         AND refund_event.metadata->>'totalRefundedCents' =
               existing_claim."refundAmountCents"::text
         AND refund_event.metadata->>'pendingLocalRefundLock' = 'false'
         AND refund_event.metadata->>'caseResolutionClaimId' IS NULL
         AND refund_event."createdAt" >= existing_claim."createdAt"
         AND (
           refund_event.status IS NULL
           OR pg_catalog.lower(refund_event.status)
                NOT IN ('failed', 'canceled', 'cancelled')
         )
       ORDER BY refund_event."createdAt" DESC, refund_event.id DESC
       LIMIT 1
       FOR SHARE;
      IF FOUND THEN
        transition_at :=
          pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
        UPDATE public."Order" AS orders
           SET "sellerRefundId" =
                 'ambiguous_refund_pending_reconciliation',
               "reviewNeeded" = true,
               "reviewNote" =
                 'Case refund marker restored for provider reconciliation.'
         WHERE orders.id = locked_order.id
           AND orders."caseResolutionClaimId" = existing_claim.id
           AND orders."sellerRefundId" = locked_order."sellerRefundId"
           AND orders."sellerRefundLockedAt" IS NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Case refund marker repair lease was lost'
            USING ERRCODE = '40001';
        END IF;
        INSERT INTO public."AdminAuditLog" (
          id, "adminId", action, "targetType", "targetId", reason,
          metadata, undone, "createdAt"
        ) VALUES (
          'case-refund-marker-repair-audit:'
            || pg_catalog.gen_random_uuid()::text,
          locked_actor.id,
          'REPAIR_CASE_REFUND_RECONCILIATION_MARKER',
          'CASE_RESOLUTION_CLAIM',
          existing_claim.id,
          'signed_refund_overwrote_ambiguous_marker',
          pg_catalog.jsonb_build_object(
            'caseId', locked_case.id,
            'orderId', locked_order.id,
            'orderPaymentEventId', historical_refund_event_id,
            'overwrittenRefundId', locked_order."sellerRefundId"
          ),
          false,
          transition_at
        );
        locked_order."sellerRefundId" :=
          'ambiguous_refund_pending_reconciliation';
      END IF;
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
              AND NOT (
                refund_event.metadata->>'pendingLocalRefundLock' = 'true'
                AND (
                  refund_event.metadata->>'caseResolutionClaimId'
                    IS NULL
                  OR refund_event.metadata->>'caseResolutionClaimId' =
                       existing_claim.id
                )
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
$function$
;

CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_finalize(p_actor_user_id text, p_resolution_claim_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  skipped_stock_restore_count integer := 0;
  changed_count integer;
  staff_takeover boolean := false;
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
    orders."sellerRefundAmountCents",
    orders."fulfillmentStatus"
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

  -- #605/#677 separation of duties: staff who are this Case's buyer or
  -- seller may not finalize it. Runs before any provider call.
  IF locked_actor.id = locked_case."sellerId"
     OR locked_actor.id IS NOT DISTINCT FROM locked_case."buyerId" THEN
    RAISE EXCEPTION 'Case staff-resolution actor is a Case party'
      USING ERRCODE = '42501';
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
     OR locked_claim."caseId" IS DISTINCT FROM locked_case.id THEN
    RAISE EXCEPTION 'Case finalization claim authority is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF locked_claim."staffActorId" IS DISTINCT FROM locked_actor.id THEN
    -- #678: a current ADMIN may finish a staged dismissal (no provider
    -- effect) whose preparing staff member is no longer active staff, or was
    -- a party of the Case (a pre-#677 claim the preparer can no longer
    -- finalize). Refund claims keep using the ADMIN provider-recovery path.
    IF locked_actor.role <> 'ADMIN'::public."Role"
       OR locked_claim.resolution <> 'DISMISSED'::public."CaseResolution"
       OR locked_claim.status <>
            'LOCAL_READY'::public."CaseResolutionClaimStatus"
       OR (
         -- the preparer is still active, non-party staff: no takeover
         locked_claim."staffActorId" IS DISTINCT FROM locked_case."sellerId"
         AND locked_claim."staffActorId" IS DISTINCT FROM locked_case."buyerId"
         AND EXISTS (
           SELECT 1
             FROM public."User" AS original_staff
            WHERE original_staff.id = locked_claim."staffActorId"
              AND NOT original_staff.banned
              AND original_staff."deletedAt" IS NULL
              AND original_staff.role IN (
                'EMPLOYEE'::public."Role",
                'ADMIN'::public."Role"
              )
         )
       ) THEN
      RAISE EXCEPTION 'Case finalization claim authority is invalid'
        USING ERRCODE = '42501';
    END IF;
    staff_takeover := true;
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
      'skippedStockRestoreCount', 0,
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
   ORDER BY listing.id, item.id
   FOR SHARE OF item
   FOR UPDATE OF listing;

  IF locked_order."fulfillmentStatus" IN (
       'SHIPPED'::public."FulfillmentStatus",
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
     )
     AND EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(
           locked_claim."stockRestorePlan"
         ) AS plan(value)
         JOIN public."Listing" AS listing
           ON listing.id = plan.value->>'listingId'
        WHERE listing."listingType" = 'IN_STOCK'::public."ListingType"
     ) THEN
    RAISE EXCEPTION 'Case finalization cannot restore fulfilled stock'
      USING ERRCODE = '23514';
  END IF;

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
      WHERE item."orderId" = locked_order.id
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

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
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
      IF EXISTS (
        SELECT 1
          FROM public."Listing" AS listing
         WHERE listing.id = plan_listing_id
           AND listing."listingType" <>
                 'IN_STOCK'::public."ListingType"
      ) THEN
        skipped_stock_restore_count := skipped_stock_restore_count + 1;
        CONTINUE;
      END IF;
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
      'originalStaffActorId', locked_claim."staffActorId",
      'staffTakeover', staff_takeover,
      'resolution', locked_claim.resolution::text,
      'refundAmountCents', locked_claim."refundAmountCents",
      'stripeRefundId', stripe_refund_id,
      'resolutionMessageId', message_id,
      'skippedStockRestoreCount', skipped_stock_restore_count,
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
    'skippedStockRestoreCount', skipped_stock_restore_count,
    'status', 'FINALIZED',
    'action', 'finalized'
  );
END
$function$
;

CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_provider_recovery_load(p_actor_user_id text, p_case_id text, p_resolution "CaseResolution", p_partial_refund_amount_cents integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  locked_actor record;
  source_order_id text;
  locked_order record;
  locked_case record;
  locked_claim record;
  prior_actor record;
  recovery_action text;
  transition_at timestamp(3);
  audit_id text;
  historical_refund_event_id text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_case_id IS NULL
     OR pg_catalog.btrim(p_case_id) = ''
     OR pg_catalog.char_length(p_case_id) > 191
     OR p_resolution NOT IN (
       'REFUND_FULL'::public."CaseResolution",
       'REFUND_PARTIAL'::public."CaseResolution"
     )
     OR (
       p_resolution = 'REFUND_FULL'::public."CaseResolution"
       AND p_partial_refund_amount_cents IS NOT NULL
     )
     OR (
       p_resolution = 'REFUND_PARTIAL'::public."CaseResolution"
       AND (
         p_partial_refund_amount_cents IS NULL
         OR p_partial_refund_amount_cents <= 0
       )
     ) THEN
    RAISE EXCEPTION 'Case provider-recovery load input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.id, actor.role, actor.banned, actor."deletedAt"
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
    RAISE EXCEPTION 'Case provider-recovery actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT case_row."orderId"
    INTO source_order_id
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-recovery Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."caseResolutionClaimId",
    orders.currency,
    orders."itemsSubtotalCents",
    orders."shippingAmountCents",
    orders."giftWrappingPriceCents",
    orders."taxAmountCents",
    orders."stripePaymentIntentId",
    orders."stripeTransferId",
    orders."sellerRefundId",
    orders."sellerRefundLockedAt",
    orders."labelStatus",
    orders."labelClaimStatus",
    orders."paymentOpenDisputeBlocked"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case provider-recovery Order does not exist'
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
  IF NOT FOUND
     OR locked_case.id IS DISTINCT FROM p_case_id
     OR locked_case.status IN (
       'RESOLVED'::public."CaseStatus",
       'CLOSED'::public."CaseStatus"
     )
     OR locked_case."resolvedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case provider-recovery Case is not active'
      USING ERRCODE = '23514';
  END IF;

  -- #605/#677 separation of duties: staff who are this Case's buyer or
  -- seller may not recover it. Runs before any provider call.
  IF locked_actor.id = locked_case."sellerId"
     OR locked_actor.id IS NOT DISTINCT FROM locked_case."buyerId" THEN
    RAISE EXCEPTION 'Case staff-resolution actor is a Case party'
      USING ERRCODE = '42501';
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
    claim."idempotencyScope",
    claim."orderPaymentEventId",
    claim."providerRecoveryActorId",
    claim."providerRecoveryAction",
    claim."providerRecoveryAuthorizedAt",
    claim."providerRecoveryRecordedAt",
    claim."providerRecoveryFinalizedAt",
    claim."createdAt"
    INTO locked_claim
    FROM public."CaseResolutionClaim" AS claim
   WHERE claim.id = locked_order."caseResolutionClaimId"
     AND claim."caseId" = locked_case.id
     AND claim."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_claim.resolution IS DISTINCT FROM p_resolution
     OR (
       p_resolution = 'REFUND_PARTIAL'::public."CaseResolution"
       AND locked_claim."refundAmountCents"
             IS DISTINCT FROM p_partial_refund_amount_cents
     )
     OR locked_claim."refundAmountCents" IS NULL
     OR locked_claim."idempotencyScope" IS NULL
     OR locked_order."stripePaymentIntentId" IS NULL
     OR pg_catalog.btrim(locked_order."stripePaymentIntentId") = '' THEN
    RAISE EXCEPTION 'Case provider-recovery claim identity is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF locked_claim."providerRecoveryActorId" IS NOT NULL THEN
    IF locked_claim."providerRecoveryActorId" IS DISTINCT FROM locked_actor.id THEN
      SELECT actor.id, actor.role, actor.banned, actor."deletedAt"
        INTO prior_actor
        FROM public."User" AS actor
       WHERE actor.id = locked_claim."providerRecoveryActorId"
       FOR SHARE;
      IF NOT FOUND
         OR locked_actor.role <> 'ADMIN'::public."Role"
         OR locked_claim."providerRecoveryAuthorizedAt" IS NULL
         OR locked_claim."providerRecoveryFinalizedAt" IS NOT NULL
         OR (
           prior_actor.role = 'ADMIN'::public."Role"
           AND NOT prior_actor.banned
           AND prior_actor."deletedAt" IS NULL
         ) THEN
        RAISE EXCEPTION 'Case provider-recovery claim is already delegated'
          USING ERRCODE = '42501';
      END IF;

      transition_at :=
        pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
      UPDATE public."CaseResolutionClaim" AS claim
         SET "providerRecoveryActorId" = locked_actor.id,
             "updatedAt" = transition_at
       WHERE claim.id = locked_claim.id
         AND claim."providerRecoveryActorId" =
               locked_claim."providerRecoveryActorId"
         AND claim."providerRecoveryFinalizedAt" IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Case provider-recovery redelegation was lost'
          USING ERRCODE = '40001';
      END IF;

      audit_id :=
        'case-resolution-provider-recovery-redelegate-audit:'
        || pg_catalog.gen_random_uuid()::text;
      INSERT INTO public."AdminAuditLog" (
        id, "adminId", action, "targetType", "targetId", reason,
        metadata, undone, "createdAt"
      )
      VALUES (
        audit_id,
        locked_actor.id,
        'REDELEGATE_CASE_RESOLUTION_PROVIDER_RECOVERY',
        'CASE_RESOLUTION_CLAIM',
        locked_claim.id,
        'prior_recovery_actor_inactive',
        pg_catalog.jsonb_build_object(
          'caseId', locked_case.id,
          'orderId', locked_order.id,
          'originalStaffActorId', locked_claim."staffActorId",
          'priorRecoveryActorId', locked_claim."providerRecoveryActorId",
          'replacementRecoveryActorId', locked_actor.id
        ),
        false,
        transition_at
      );
      locked_claim."providerRecoveryActorId" := locked_actor.id;
    END IF;
    IF locked_claim."providerRecoveryAuthorizedAt" IS NULL
       OR locked_claim."providerRecoveryFinalizedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Case provider-recovery claim is already delegated'
        USING ERRCODE = '42501';
    END IF;
    recovery_action := 'recovered';
  ELSIF locked_claim."staffActorId" = locked_actor.id THEN
    recovery_action := 'replay';
  ELSIF locked_actor.role = 'ADMIN'::public."Role" THEN
    recovery_action := 'recovery_required';
  ELSE
    RAISE EXCEPTION 'Case provider-recovery requires the original actor or an ADMIN'
      USING ERRCODE = '42501';
  END IF;

  -- #710: normalize the same exact historical marker for a successor
  -- ADMIN loading provider recovery directly after prepare returned 23505.
  IF locked_claim.status =
       'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
     AND locked_order."sellerRefundId" IS NOT NULL
     AND locked_order."sellerRefundId" NOT IN (
       'pending',
       'ambiguous_refund_pending_reconciliation'
     )
     AND locked_order."sellerRefundLockedAt" IS NULL
     AND locked_claim."orderPaymentEventId" IS NULL THEN
    SELECT refund_event.id
      INTO historical_refund_event_id
      FROM public."OrderPaymentEvent" AS refund_event
     WHERE refund_event."orderId" = locked_order.id
       AND refund_event."eventType" = 'REFUND'
       AND refund_event."stripeObjectType" = 'refund'
       AND refund_event."stripeEventId" ~ '^evt_'
       AND refund_event."stripeObjectId" = locked_order."sellerRefundId"
       AND refund_event.currency = locked_claim.currency
       AND refund_event.metadata->>'totalRefundedCents' =
             locked_claim."refundAmountCents"::text
       AND refund_event.metadata->>'pendingLocalRefundLock' = 'false'
       AND refund_event.metadata->>'caseResolutionClaimId' IS NULL
       AND refund_event."createdAt" >= locked_claim."createdAt"
       AND (
         refund_event.status IS NULL
         OR pg_catalog.lower(refund_event.status)
              NOT IN ('failed', 'canceled', 'cancelled')
       )
     ORDER BY refund_event."createdAt" DESC, refund_event.id DESC
     LIMIT 1
     FOR SHARE;
    IF FOUND THEN
      transition_at :=
        pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
      UPDATE public."Order" AS orders
         SET "sellerRefundId" =
               'ambiguous_refund_pending_reconciliation',
             "reviewNeeded" = true,
             "reviewNote" =
               'Case refund marker restored for provider reconciliation.'
       WHERE orders.id = locked_order.id
         AND orders."caseResolutionClaimId" = locked_claim.id
         AND orders."sellerRefundId" = locked_order."sellerRefundId"
         AND orders."sellerRefundLockedAt" IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Case refund marker repair lease was lost'
          USING ERRCODE = '40001';
      END IF;
      INSERT INTO public."AdminAuditLog" (
        id, "adminId", action, "targetType", "targetId", reason,
        metadata, undone, "createdAt"
      ) VALUES (
        'case-refund-marker-repair-audit:'
          || pg_catalog.gen_random_uuid()::text,
        locked_actor.id,
        'REPAIR_CASE_REFUND_RECONCILIATION_MARKER',
        'CASE_RESOLUTION_CLAIM',
        locked_claim.id,
        'signed_refund_overwrote_ambiguous_marker',
        pg_catalog.jsonb_build_object(
          'caseId', locked_case.id,
          'orderId', locked_order.id,
          'orderPaymentEventId', historical_refund_event_id,
          'overwrittenRefundId', locked_order."sellerRefundId"
        ),
        false,
        transition_at
      );
      locked_order."sellerRefundId" :=
        'ambiguous_refund_pending_reconciliation';
    END IF;
  END IF;

  IF locked_claim.status =
       'PROVIDER_PENDING'::public."CaseResolutionClaimStatus" THEN
    IF locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
       OR locked_order."sellerRefundLockedAt" IS NULL
       OR locked_claim."orderPaymentEventId" IS NOT NULL
       OR locked_order."labelStatus" = 'PURCHASED'::public."LabelStatus"
       OR locked_order."labelClaimStatus" IN (
         'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
       )
       OR locked_order."paymentOpenDisputeBlocked" THEN
      RAISE EXCEPTION 'Case provider-recovery pending evidence is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF locked_claim.status =
          'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus" THEN
    IF locked_order."sellerRefundId" IS DISTINCT FROM
         'ambiguous_refund_pending_reconciliation'
       OR locked_order."sellerRefundLockedAt" IS NOT NULL
       OR locked_claim."orderPaymentEventId" IS NOT NULL THEN
      RAISE EXCEPTION 'Case provider-recovery reconciliation evidence is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF locked_claim.status =
          'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus" THEN
    IF locked_order."sellerRefundId" IS NULL
       OR locked_order."sellerRefundId" = 'pending'
       OR locked_order."sellerRefundLockedAt" IS NOT NULL
       OR locked_claim."orderPaymentEventId" IS NULL THEN
      RAISE EXCEPTION 'Case provider-recovery recorded evidence is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Case provider-recovery status is invalid'
      USING ERRCODE = '23514';
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
    'stockRestorePlan', locked_claim."stockRestorePlan",
    'status', locked_claim.status::text,
    'idempotencyScope', locked_claim."idempotencyScope",
    'paymentIntentId', locked_order."stripePaymentIntentId",
    'itemsSubtotalCents', locked_order."itemsSubtotalCents",
    'shippingAmountCents', locked_order."shippingAmountCents",
    'giftWrappingPriceCents', locked_order."giftWrappingPriceCents",
    'taxAmountCents', locked_order."taxAmountCents",
    'canReverseTransfer', locked_order."stripeTransferId" IS NOT NULL,
    'action', recovery_action,
    'providerRecoveryAction', locked_claim."providerRecoveryAction"
  );
END
$function$
;

CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_recovery_finalize(p_actor_user_id text, p_resolution_claim_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  skipped_stock_restore_count integer := 0;
  changed_count integer;
  recovery_audit_id text;
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
     OR locked_actor.role <> 'ADMIN'::public."Role" THEN
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
    orders."sellerRefundAmountCents",
    orders."fulfillmentStatus"
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

  -- #605/#677 separation of duties: staff who are this Case's buyer or
  -- seller may not recover or finalize it. Runs before any provider call.
  IF locked_actor.id = locked_case."sellerId"
     OR locked_actor.id IS NOT DISTINCT FROM locked_case."buyerId" THEN
    RAISE EXCEPTION 'Case staff-resolution actor is a Case party'
      USING ERRCODE = '42501';
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
     OR locked_claim."providerRecoveryRecordedAt" IS NULL THEN
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
      'skippedStockRestoreCount', 0,
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
   ORDER BY listing.id, item.id
   FOR SHARE OF item
   FOR UPDATE OF listing;

  IF locked_order."fulfillmentStatus" IN (
       'SHIPPED'::public."FulfillmentStatus",
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
     )
     AND EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(
           locked_claim."stockRestorePlan"
         ) AS plan(value)
         JOIN public."Listing" AS listing
           ON listing.id = plan.value->>'listingId'
        WHERE listing."listingType" = 'IN_STOCK'::public."ListingType"
     ) THEN
    RAISE EXCEPTION 'Case finalization cannot restore fulfilled stock'
      USING ERRCODE = '23514';
  END IF;

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
      WHERE item."orderId" = locked_order.id
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

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
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
         "resolvedById" = locked_claim."staffActorId",
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
    -- #676: the original staffActorId may have been demoted, banned or
    -- deleted since the provider effect; it stays in claim + audit metadata.
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
      IF EXISTS (
        SELECT 1
          FROM public."Listing" AS listing
         WHERE listing.id = plan_listing_id
           AND listing."listingType" <>
                 'IN_STOCK'::public."ListingType"
      ) THEN
        skipped_stock_restore_count := skipped_stock_restore_count + 1;
        CONTINUE;
      END IF;
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
    locked_claim."staffActorId",
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
      'skippedStockRestoreCount', skipped_stock_restore_count,
      'at', transition_at
    ),
    false,
    transition_at
  );

  -- #660: the recovery finalization stamp is written with FINALIZED; the
  -- claim is terminal (immutable) after this statement.
  UPDATE public."CaseResolutionClaim" AS claim
     SET status = 'FINALIZED'::public."CaseResolutionClaimStatus",
         "finalizedAt" = transition_at,
         "providerRecoveryFinalizedAt" = transition_at,
         "updatedAt" = transition_at
   WHERE claim.id = locked_claim.id
     AND claim.status IN (
       'LOCAL_READY'::public."CaseResolutionClaimStatus",
       'PROVIDER_RECORDED'::public."CaseResolutionClaimStatus"
     )
     AND claim."providerRecoveryActorId" = locked_actor.id
     AND claim."providerRecoveryRecordedAt" IS NOT NULL
     AND claim."providerRecoveryFinalizedAt" IS NULL;
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

  recovery_audit_id :=
    'case-resolution-provider-recovery-finalize-audit:'
    || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason,
    metadata, undone, "createdAt"
  )
  VALUES (
    recovery_audit_id,
    locked_actor.id,
    'RECOVER_CASE_RESOLUTION_FINALIZE',
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
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'resolution', locked_claim.resolution::text,
    'refundAmountCents', locked_claim."refundAmountCents",
    'currency', locked_claim.currency,
    'resolutionMessageId', message_id,
    'stockStatusRestoredCount', restored_active_count,
    'skippedStockRestoreCount', skipped_stock_restore_count,
    'status', 'FINALIZED',
    'action', 'finalized'
  );
END
$function$
;

CREATE OR REPLACE FUNCTION public.grainline_order_payment_signed_refund_apply(
  p_event_id text,
  p_claim_generation bigint,
  p_charge_id text,
  p_event_created_seconds bigint,
  p_amount_refunded_cents integer,
  p_currency text,
  p_refund_id text,
  p_refund_amount_cents integer,
  p_refund_status text,
  p_refund_created_seconds bigint,
  p_refund_reason text
)
RETURNS TABLE (
  action text,
  "paymentEventId" text,
  "orderId" text,
  "orderUpdated" boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_signed_refund_apply$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  existing_payment public."OrderPaymentEvent"%ROWTYPE;
  local_refund_evidence public."OrderPaymentEvent"%ROWTYPE;
  local_refund_evidence_count integer := 0;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  source_now_seconds bigint :=
    pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::bigint;
  payment_event_id text;
  refund_object_id text;
  event_amount integer;
  effective_refund_id text := p_refund_id;
  effective_refund_amount_cents integer := p_refund_amount_cents;
  local_refund_evidence_id text;
  local_refund_evidence_action text;
  local_refund_identity_derived boolean := false;
  order_total integer;
  normalized_currency text := pg_catalog.lower(pg_catalog.btrim(p_currency));
  normalized_status text :=
    COALESCE(NULLIF(pg_catalog.lower(pg_catalog.btrim(p_refund_status)), ''), 'refunded');
  normalized_reason text := NULLIF(pg_catalog.btrim(p_refund_reason), '');
  classification_reason text;
  event_description text;
  event_metadata jsonb;
  has_local_refund boolean;
  has_active_claim boolean;
  is_known_local_refund boolean;
  is_additional_external_refund boolean;
  refund_exceeds_order_total boolean;
  did_update boolean := false;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_charge_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_charge_id)) NOT BETWEEN 1 AND 255
     OR p_event_created_seconds IS NULL
     OR p_event_created_seconds < source_now_seconds - (31 * 24 * 60 * 60)
     OR p_event_created_seconds > source_now_seconds + (10 * 60)
     OR p_amount_refunded_cents IS NULL OR p_amount_refunded_cents <= 0
     OR p_currency IS NULL OR normalized_currency !~ '^[a-z]{3}$'
     OR (
       p_refund_id IS NOT NULL
       AND (
         p_refund_id !~ '^re_[A-Za-z0-9]+$'
         OR pg_catalog.char_length(p_refund_id) > 220
       )
     )
     OR (p_refund_id IS NULL AND (
       p_refund_amount_cents IS NOT NULL
       OR p_refund_status IS NOT NULL
       OR p_refund_created_seconds IS NOT NULL
       OR p_refund_reason IS NOT NULL
     ))
     OR (
       p_refund_id IS NOT NULL
       AND (p_refund_amount_cents IS NULL OR p_refund_amount_cents <= 0)
     )
     OR (
       p_refund_amount_cents IS NOT NULL
       AND p_refund_amount_cents > p_amount_refunded_cents
     )
     OR (
       p_refund_status IS NOT NULL
       AND pg_catalog.char_length(pg_catalog.btrim(p_refund_status)) NOT BETWEEN 1 AND 100
     )
     OR (
       p_refund_created_seconds IS NOT NULL
       AND (
         p_refund_created_seconds < 1
         OR p_refund_created_seconds > p_event_created_seconds
       )
     )
     OR (p_refund_reason IS NOT NULL AND pg_catalog.char_length(p_refund_reason) > 255) THEN
    RAISE EXCEPTION 'Signed refund input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type IS DISTINCT FROM 'charge.refunded'
     OR source_event."sourceObjectId" IS DISTINCT FROM p_charge_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Signed refund source lease is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(p_charge_id));

  SELECT orders.*
    INTO source_order
    FROM public."Order" AS orders
   WHERE orders."stripeChargeId" = p_charge_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_order.currency IS NULL
     OR pg_catalog.lower(source_order.currency) IS DISTINCT FROM normalized_currency THEN
    RAISE EXCEPTION 'Signed refund Order source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  order_total :=
      source_order."itemsSubtotalCents"
    + source_order."shippingAmountCents"
    + COALESCE(source_order."giftWrappingPriceCents", 0)
    + source_order."taxAmountCents";
  IF order_total <= 0 OR order_total > 2147483647 THEN
    RAISE EXCEPTION 'Signed refund Order total is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_refund_id IS NULL
     AND source_order."sellerRefundId" ~ '^re_[A-Za-z0-9]+$'
     AND source_order."sellerRefundAmountCents"
          IS NOT DISTINCT FROM p_amount_refunded_cents THEN
    SELECT pg_catalog.count(*)::integer
      INTO local_refund_evidence_count
      FROM public."OrderPaymentEvent" AS payment
     WHERE payment."orderId" = source_order.id
       AND payment."stripeObjectId" = source_order."sellerRefundId"
       AND payment."stripeObjectType" = 'refund'
       AND payment."eventType" = 'REFUND'
       AND payment."amountCents" = p_amount_refunded_cents
       AND pg_catalog.lower(payment.currency) = normalized_currency
       AND payment.status IS NOT NULL
       AND pg_catalog.char_length(pg_catalog.btrim(payment.status)) BETWEEN 1 AND 100
       AND pg_catalog.jsonb_typeof(payment.metadata) = 'object'
       AND payment.metadata->>'localAction' IN (
         'SELLER_REFUND_RECORDED',
         'CASE_REFUND_RECORDED',
         'BLOCKED_CHECKOUT_REFUND_RECORDED'
       )
       AND payment.reason = CASE payment.metadata->>'localAction'
         WHEN 'SELLER_REFUND_RECORDED' THEN 'seller_refund'
         WHEN 'CASE_REFUND_RECORDED' THEN 'case_resolution_refund'
         WHEN 'BLOCKED_CHECKOUT_REFUND_RECORDED' THEN 'blocked_checkout'
       END
       AND payment."stripeEventId" =
         'local:' || pg_catalog.lower(payment.metadata->>'localAction')
         || ':' || source_order."sellerRefundId"
       AND pg_catalog.jsonb_typeof(payment.metadata->'refundIds') = 'array'
       AND payment.metadata->'refundIds'
            @> pg_catalog.jsonb_build_array(source_order."sellerRefundId")
       AND EXISTS (
         SELECT 1
           FROM public."SystemAuditLog" AS audit
          WHERE audit.action = payment.metadata->>'localAction'
            AND audit."targetType" = 'ORDER'
            AND audit."targetId" = source_order.id
            AND audit.metadata->>'orderPaymentEventId' = payment.id
            AND audit.metadata->>'stripeRefundId' = source_order."sellerRefundId"
            AND audit.metadata->>'amountCents' = p_amount_refunded_cents::text
            AND pg_catalog.lower(audit.metadata->>'currency') = normalized_currency
       );

    IF local_refund_evidence_count = 1 THEN
      SELECT payment.*
        INTO local_refund_evidence
        FROM public."OrderPaymentEvent" AS payment
       WHERE payment."orderId" = source_order.id
         AND payment."stripeObjectId" = source_order."sellerRefundId"
         AND payment."stripeObjectType" = 'refund'
         AND payment."eventType" = 'REFUND'
         AND payment."amountCents" = p_amount_refunded_cents
         AND pg_catalog.lower(payment.currency) = normalized_currency
         AND payment.status IS NOT NULL
         AND pg_catalog.char_length(pg_catalog.btrim(payment.status)) BETWEEN 1 AND 100
         AND pg_catalog.jsonb_typeof(payment.metadata) = 'object'
         AND payment.metadata->>'localAction' IN (
           'SELLER_REFUND_RECORDED',
           'CASE_REFUND_RECORDED',
           'BLOCKED_CHECKOUT_REFUND_RECORDED'
         )
         AND payment.reason = CASE payment.metadata->>'localAction'
           WHEN 'SELLER_REFUND_RECORDED' THEN 'seller_refund'
           WHEN 'CASE_REFUND_RECORDED' THEN 'case_resolution_refund'
           WHEN 'BLOCKED_CHECKOUT_REFUND_RECORDED' THEN 'blocked_checkout'
         END
         AND payment."stripeEventId" =
           'local:' || pg_catalog.lower(payment.metadata->>'localAction')
           || ':' || source_order."sellerRefundId"
         AND pg_catalog.jsonb_typeof(payment.metadata->'refundIds') = 'array'
         AND payment.metadata->'refundIds'
              @> pg_catalog.jsonb_build_array(source_order."sellerRefundId")
         AND EXISTS (
           SELECT 1
             FROM public."SystemAuditLog" AS audit
            WHERE audit.action = payment.metadata->>'localAction'
              AND audit."targetType" = 'ORDER'
              AND audit."targetId" = source_order.id
              AND audit.metadata->>'orderPaymentEventId' = payment.id
              AND audit.metadata->>'stripeRefundId' = source_order."sellerRefundId"
              AND audit.metadata->>'amountCents' = p_amount_refunded_cents::text
              AND pg_catalog.lower(audit.metadata->>'currency') = normalized_currency
         )
       FOR SHARE;
      effective_refund_id := local_refund_evidence."stripeObjectId";
      effective_refund_amount_cents := local_refund_evidence."amountCents";
      normalized_status := COALESCE(
        NULLIF(pg_catalog.lower(pg_catalog.btrim(local_refund_evidence.status)), ''),
        'refunded'
      );
      local_refund_evidence_id := local_refund_evidence.id;
      local_refund_evidence_action :=
        local_refund_evidence.metadata->>'localAction';
      local_refund_identity_derived := true;
    END IF;
  END IF;

  refund_object_id := COALESCE(
    effective_refund_id,
    'external:' || p_event_id
  );
  event_amount := COALESCE(
    effective_refund_amount_cents,
    p_amount_refunded_cents
  );

  SELECT payment.*
    INTO existing_payment
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."stripeEventId" = p_event_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_payment."orderId" IS DISTINCT FROM source_order.id
       OR existing_payment."stripeObjectType" IS DISTINCT FROM 'refund'
       OR existing_payment."eventType" IS DISTINCT FROM 'REFUND'
       OR existing_payment.currency IS DISTINCT FROM normalized_currency
       OR existing_payment."stripeEventCreatedSeconds"
            IS DISTINCT FROM p_event_created_seconds
       OR existing_payment.metadata->>'chargeId' IS DISTINCT FROM p_charge_id
       OR existing_payment.metadata->>'totalRefundedCents'
            IS DISTINCT FROM p_amount_refunded_cents::text
       OR existing_payment.metadata->>'refundCreatedSeconds'
            IS DISTINCT FROM p_refund_created_seconds::text
       OR existing_payment.metadata->>'refundReason'
            IS DISTINCT FROM normalized_reason
       OR NOT (
         (
           existing_payment."stripeObjectId" IS NOT DISTINCT FROM refund_object_id
           AND existing_payment."amountCents" IS NOT DISTINCT FROM event_amount
           AND existing_payment.status IS NOT DISTINCT FROM normalized_status
           AND existing_payment.metadata->>'latestRefundId'
                IS NOT DISTINCT FROM effective_refund_id
           AND existing_payment.metadata->>'latestRefundAmountCents'
                IS NOT DISTINCT FROM effective_refund_amount_cents::text
           AND existing_payment.metadata->>'localRefundEvidenceId'
                IS NOT DISTINCT FROM local_refund_evidence_id
           AND existing_payment.metadata->>'localRefundEvidenceAction'
                IS NOT DISTINCT FROM local_refund_evidence_action
         )
         OR (
           p_refund_id IS NULL
           AND local_refund_identity_derived
           AND existing_payment."stripeObjectId" = 'external:' || p_event_id
           AND existing_payment."amountCents" = p_amount_refunded_cents
           AND existing_payment.status = 'refunded'
           AND existing_payment.metadata->>'latestRefundId' IS NULL
           AND existing_payment.metadata->>'latestRefundAmountCents' IS NULL
           AND existing_payment.metadata->>'localRefundEvidenceId' IS NULL
           AND existing_payment.metadata->>'localRefundEvidenceAction' IS NULL
         )
       ) THEN
      RAISE EXCEPTION 'Signed refund replay payload is inconsistent'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY SELECT
      'replay'::text,
      existing_payment.id::text,
      source_order.id::text,
      false;
    RETURN;
  END IF;

  has_local_refund :=
    source_order."sellerRefundId" IS NOT NULL
    AND source_order."sellerRefundId" NOT IN (
      'pending',
      'ambiguous_refund_pending_reconciliation'
    )
    AND source_order."sellerRefundId" NOT LIKE 'external:%';
  has_active_claim :=
    source_order."refundClaimId" IS NOT NULL
    OR (
      source_order."caseResolutionClaimId" IS NOT NULL
      AND source_order."sellerRefundId" IN (
        'pending',
        'ambiguous_refund_pending_reconciliation'
      )
    )
    OR (
      source_order."sellerRefundId" = 'pending'
      AND source_order."sellerRefundLockedAt" IS NOT NULL
      AND source_order."sellerRefundLockedAt" >= source_now - INTERVAL '15 minutes'
    );
  is_known_local_refund :=
    has_local_refund AND source_order."sellerRefundId" = refund_object_id;
  is_additional_external_refund :=
    has_local_refund AND NOT is_known_local_refund;
  refund_exceeds_order_total := p_amount_refunded_cents > order_total;

  classification_reason := CASE
    WHEN has_active_claim THEN 'local_refund_pending_confirmation'
    WHEN normalized_reason IS NOT NULL THEN normalized_reason
    WHEN is_known_local_refund THEN 'local_refund_confirmed'
    WHEN is_additional_external_refund THEN 'additional_external_refund'
    ELSE 'external_refund'
  END;
  event_description := CASE
    WHEN is_known_local_refund THEN
      'Stripe confirmed a Grainline-tracked refund.'
    WHEN has_active_claim THEN
      'Stripe reported a refund while Grainline was recording local refund side effects.'
    WHEN is_additional_external_refund THEN
      'Stripe reported an additional refund outside the local Grainline refund record.'
    ELSE
      'Stripe reported a refund created outside Grainline.'
  END;
  event_metadata := pg_catalog.jsonb_build_object(
    'chargeId', p_charge_id,
    'latestRefundId', effective_refund_id,
    'latestRefundAmountCents', effective_refund_amount_cents,
    'localRefundEvidenceId', local_refund_evidence_id,
    'localRefundEvidenceAction', local_refund_evidence_action,
    'totalRefundedCents', p_amount_refunded_cents,
    'refundCreatedSeconds', p_refund_created_seconds,
    'refundReason', normalized_reason,
    'preservedLocalRefundId', CASE
      WHEN is_additional_external_refund THEN source_order."sellerRefundId"
      ELSE NULL
    END,
    'pendingLocalRefundLock', has_active_claim,
    'caseResolutionClaimId', CASE
      WHEN has_active_claim THEN source_order."caseResolutionClaimId"
      ELSE NULL
    END,
    'orderTotalCents', order_total,
    'refundExceedsOrderTotal', refund_exceeds_order_total,
    'stripeEventType', source_event.type
  );

  payment_event_id := pg_catalog.gen_random_uuid()::text;
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
    "stripeEventCreatedSeconds",
    "createdAt",
    "updatedAt"
  ) VALUES (
    payment_event_id,
    source_order.id,
    p_event_id,
    refund_object_id,
    'refund',
    'REFUND',
    event_amount,
    normalized_currency,
    normalized_status,
    classification_reason,
    event_description,
    event_metadata,
    p_event_created_seconds,
    source_now,
    source_now
  );

  IF source_order."sellerRefundId" = refund_object_id OR has_active_claim THEN
    did_update := false;
  ELSIF is_additional_external_refund THEN
    UPDATE public."Order" AS orders
       SET "sellerRefundAmountCents" = GREATEST(
             COALESCE(orders."sellerRefundAmountCents", 0),
             p_amount_refunded_cents
           ),
           "sellerRefundLockedAt" = NULL,
           "reviewNeeded" = true,
           "reviewNote" = CASE
             WHEN refund_exceeds_order_total THEN
               'Additional Stripe refund was detected outside Grainline; total refunded exceeds the order total and staff must reconcile before fulfillment. Local refund audit ID was preserved.'
             ELSE
               'Additional Stripe refund was detected outside Grainline; local refund audit ID was preserved.'
           END
     WHERE orders.id = source_order.id;
    did_update := true;
  ELSE
    UPDATE public."Order" AS orders
       SET "sellerRefundId" = refund_object_id,
           "sellerRefundAmountCents" = p_amount_refunded_cents,
           "sellerRefundLockedAt" = NULL,
           "reviewNeeded" = true,
           "reviewNote" = CASE
             WHEN refund_exceeds_order_total THEN
               'Stripe refund was created outside Grainline; total refunded exceeds the order total and staff must reconcile before fulfillment.'
             ELSE
               'Stripe refund was created outside Grainline.'
           END
     WHERE orders.id = source_order.id;
    did_update := true;
  END IF;

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
  ) VALUES (
    'signed-refund-audit:' || pg_catalog.gen_random_uuid()::text,
    'webhook',
    p_event_id,
    'STRIPE_REFUND_RECORDED',
    'ORDER',
    source_order.id,
    classification_reason,
    pg_catalog.jsonb_build_object(
      'orderPaymentEventId', payment_event_id,
      'stripeEventType', source_event.type,
      'stripeChargeId', p_charge_id,
      'stripeRefundId', refund_object_id,
      'amountCents', event_amount,
      'currency', normalized_currency,
      'status', normalized_status,
      'hasOrderUpdate', did_update
    ),
    source_now
  );

  RETURN QUERY SELECT
    'inserted'::text,
    payment_event_id,
    source_order.id::text,
    did_update;
END
$grainline_order_payment_signed_refund_apply$;

CREATE OR REPLACE FUNCTION public.grainline_order_payment_signed_dispute_apply(
  p_event_id text,
  p_claim_generation bigint,
  p_charge_id text,
  p_dispute_id text,
  p_event_created_seconds bigint,
  p_amount_cents integer,
  p_currency text,
  p_reason text,
  p_status text
)
RETURNS TABLE (
  action text,
  "paymentEventId" text,
  "orderId" text,
  "sellerUserId" text,
  "buyerUserId" text,
  "caseId" text,
  "caseAction" text,
  "notificationAuthorized" boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_signed_dispute_apply$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  source_seller_user_id text;
  existing_payment public."OrderPaymentEvent"%ROWTYPE;
  latest_payment record;
  case_result record;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  source_now_seconds bigint :=
    pg_catalog.floor(EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()))::bigint;
  payment_event_id text;
  normalized_currency text := pg_catalog.lower(pg_catalog.btrim(p_currency));
  normalized_reason text := NULLIF(pg_catalog.btrim(p_reason), '');
  normalized_status text := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_status)), '');
  event_description text;
  event_metadata jsonb;
  result_action text;
  should_apply boolean := false;
  is_terminal boolean;
  case_id text;
  case_action text;
  notification_authorized boolean := false;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_charge_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_charge_id)) NOT BETWEEN 1 AND 255
     OR p_dispute_id IS NULL
     OR p_dispute_id !~ '^du_[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_dispute_id) > 220
     OR p_event_created_seconds IS NULL
     OR p_event_created_seconds < source_now_seconds - (31 * 24 * 60 * 60)
     OR p_event_created_seconds > source_now_seconds + (10 * 60)
     OR p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_currency IS NULL OR normalized_currency !~ '^[a-z]{3}$'
     OR (p_reason IS NOT NULL AND pg_catalog.char_length(p_reason) > 255)
     OR normalized_status IS NULL
     OR pg_catalog.char_length(normalized_status) > 100 THEN
    RAISE EXCEPTION 'Signed dispute input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type NOT IN (
       'charge.dispute.created',
       'charge.dispute.updated',
       'charge.dispute.closed',
       'charge.dispute.funds_withdrawn',
       'charge.dispute.funds_reinstated'
     )
     OR source_event."sourceObjectId" IS DISTINCT FROM p_dispute_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Signed dispute source lease is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(p_charge_id));

  SELECT orders.*
    INTO source_order
    FROM public."Order" AS orders
   WHERE orders."stripeChargeId" = p_charge_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_order."buyerId" IS NULL
     OR source_order."sellerProfileId" IS NULL
     OR source_order.currency IS NULL
     OR pg_catalog.lower(source_order.currency) IS DISTINCT FROM normalized_currency THEN
    RAISE EXCEPTION 'Signed dispute Order source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT seller."userId"
    INTO source_seller_user_id
    FROM public."SellerProfile" AS seller
   WHERE seller.id = source_order."sellerProfileId"
   FOR SHARE;
  IF NOT FOUND
     OR source_seller_user_id IS NULL
     OR source_seller_user_id = source_order."buyerId" THEN
    RAISE EXCEPTION 'Signed dispute participant source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_dispute_id, 824030003)
  );

  SELECT payment.*
    INTO existing_payment
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."stripeEventId" = p_event_id
   FOR SHARE;
  IF FOUND THEN
    IF existing_payment."orderId" IS DISTINCT FROM source_order.id
       OR existing_payment."stripeObjectId" IS DISTINCT FROM p_dispute_id
       OR existing_payment."stripeObjectType" IS DISTINCT FROM 'dispute'
       OR existing_payment."eventType" IS DISTINCT FROM 'DISPUTE'
       OR existing_payment."amountCents" IS DISTINCT FROM p_amount_cents
       OR existing_payment.currency IS DISTINCT FROM normalized_currency
       OR existing_payment.status IS DISTINCT FROM normalized_status
       OR existing_payment.reason IS DISTINCT FROM normalized_reason
       OR existing_payment."stripeEventCreatedSeconds"
            IS DISTINCT FROM p_event_created_seconds
       OR existing_payment.metadata->>'chargeId' IS DISTINCT FROM p_charge_id
       OR existing_payment.metadata->>'disputeId' IS DISTINCT FROM p_dispute_id
       OR existing_payment.metadata->>'stripeEventType'
            IS DISTINCT FROM source_event.type
       OR existing_payment.metadata->>'stripeEventCreated'
            IS DISTINCT FROM p_event_created_seconds::text THEN
      RAISE EXCEPTION 'Signed dispute replay payload is inconsistent'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN QUERY SELECT
      'replay'::text,
      existing_payment.id::text,
      source_order.id::text,
      source_seller_user_id,
      source_order."buyerId"::text,
      NULL::text,
      NULL::text,
      false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."OrderPaymentEvent" AS legacy_payment
     WHERE legacy_payment."orderId" = source_order.id
       AND legacy_payment."eventType" = 'DISPUTE'
       AND legacy_payment."stripeObjectId" = p_dispute_id
       AND legacy_payment."stripeEventCreatedSeconds" IS NULL
       AND (
         pg_catalog.jsonb_typeof(legacy_payment.metadata) IS DISTINCT FROM 'object'
         OR legacy_payment.metadata->>'stripeEventCreated' IS NULL
         OR legacy_payment.metadata->>'stripeEventCreated' !~ '^[0-9]{1,12}$'
       )
  ) THEN
    RAISE EXCEPTION 'Signed dispute legacy ordering requires reconciliation'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT
    payment."stripeEventId",
    payment."amountCents",
    payment.currency,
    payment.status,
    payment.reason,
    payment.metadata->>'stripeEventType' AS stripe_event_type,
    COALESCE(
      payment."stripeEventCreatedSeconds",
      CASE
        WHEN payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
        THEN (payment.metadata->>'stripeEventCreated')::bigint
        ELSE NULL
      END
    ) AS stripe_event_created
    INTO latest_payment
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment."orderId" = source_order.id
     AND payment."eventType" = 'DISPUTE'
     AND payment."stripeObjectType" = 'dispute'
     AND payment."stripeObjectId" = p_dispute_id
   ORDER BY
     COALESCE(
       payment."stripeEventCreatedSeconds",
       CASE
         WHEN payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
         THEN (payment.metadata->>'stripeEventCreated')::bigint
         ELSE NULL
       END
     ) DESC NULLS LAST,
     payment.id DESC
   LIMIT 1
   FOR SHARE;

  IF NOT FOUND THEN
    result_action := 'applied';
    should_apply := true;
  ELSIF p_event_created_seconds > latest_payment.stripe_event_created THEN
    result_action := 'applied';
    should_apply := true;
  ELSIF p_event_created_seconds < latest_payment.stripe_event_created THEN
    result_action := 'stale_recorded';
  ELSIF EXISTS (
    SELECT 1
      FROM public."OrderPaymentEvent" AS equal_payment
     WHERE equal_payment."orderId" = source_order.id
       AND equal_payment."eventType" = 'DISPUTE'
       AND equal_payment."stripeObjectType" = 'dispute'
       AND equal_payment."stripeObjectId" = p_dispute_id
       AND COALESCE(
             equal_payment."stripeEventCreatedSeconds",
             CASE
               WHEN equal_payment.metadata->>'stripeEventCreated' ~ '^[0-9]{1,12}$'
               THEN (equal_payment.metadata->>'stripeEventCreated')::bigint
               ELSE NULL
             END
           ) = p_event_created_seconds
       AND (
         equal_payment."amountCents" IS DISTINCT FROM p_amount_cents
         OR equal_payment.currency IS DISTINCT FROM normalized_currency
         OR equal_payment.status IS DISTINCT FROM normalized_status
         OR equal_payment.reason IS DISTINCT FROM normalized_reason
         OR (
           source_event.type = 'charge.dispute.created'
           AND equal_payment.metadata->>'stripeEventType'
                 IS DISTINCT FROM source_event.type
           AND NOT EXISTS (
             SELECT 1
               FROM public."Case" AS case_row
              WHERE case_row."orderId" = source_order.id
           )
         )
       )
  ) THEN
    result_action := 'conflict_recorded';
  ELSE
    result_action := 'same_second_recorded';
  END IF;

  event_description := pg_catalog.left(
    'Stripe dispute '
      || source_event.type
      || CASE
           WHEN normalized_reason IS NULL THEN ''
           ELSE ': ' || normalized_reason
         END,
    5000
  );
  event_metadata := pg_catalog.jsonb_build_object(
    'chargeId', p_charge_id,
    'disputeId', p_dispute_id,
    'stripeEventType', source_event.type,
    'stripeEventCreated', p_event_created_seconds,
    'orderingAction', result_action
  );

  payment_event_id := pg_catalog.gen_random_uuid()::text;
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
    "stripeEventCreatedSeconds",
    "createdAt",
    "updatedAt"
  ) VALUES (
    payment_event_id,
    source_order.id,
    p_event_id,
    p_dispute_id,
    'dispute',
    'DISPUTE',
    p_amount_cents,
    normalized_currency,
    normalized_status,
    normalized_reason,
    event_description,
    event_metadata,
    p_event_created_seconds,
    source_now,
    source_now
  );

  is_terminal := normalized_status IN (
    'won',
    'lost',
    'prevented',
    'warning_closed'
  );
  IF result_action = 'conflict_recorded' THEN
    UPDATE public."Order" AS orders
       SET "reviewNeeded" = true,
           "reviewNote" =
             'Stripe reported conflicting dispute states at the same provider second; staff must reconcile before further automated dispute actions.'
     WHERE orders.id = source_order.id;
  ELSIF should_apply THEN
    UPDATE public."Order" AS orders
       SET "reviewNeeded" = true,
           "reviewNote" = event_description,
           "sellerRefundLockedAt" = CASE
             WHEN is_terminal
              AND orders."sellerRefundId" = 'pending'
              AND orders."refundClaimId" IS NULL
              AND orders."caseResolutionClaimId" IS NULL
              AND (
                orders."sellerRefundLockedAt" IS NULL
                OR orders."sellerRefundLockedAt" < source_now - INTERVAL '15 minutes'
              )
             THEN NULL
             ELSE orders."sellerRefundLockedAt"
           END
     WHERE orders.id = source_order.id;

    IF source_event.type = 'charge.dispute.created' THEN
      SELECT application.*
        INTO case_result
        FROM public.grainline_case_stripe_dispute_apply(payment_event_id)
          AS application;
      IF NOT FOUND
         OR case_result."orderId" IS DISTINCT FROM source_order.id
         OR case_result."sellerUserId" IS DISTINCT FROM source_seller_user_id
         OR case_result."buyerUserId" IS DISTINCT FROM source_order."buyerId"
         OR case_result."paymentEventId" IS DISTINCT FROM payment_event_id
         OR case_result.action NOT IN ('create', 'reopen', 'replay') THEN
        RAISE EXCEPTION 'Signed dispute Case result is invalid'
          USING ERRCODE = 'check_violation';
      END IF;
      case_id := case_result."caseId";
      case_action := case_result.action;
      notification_authorized := case_result.action IN ('create', 'reopen');
    END IF;
  END IF;

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
  ) VALUES (
    'signed-dispute-audit:' || pg_catalog.gen_random_uuid()::text,
    'webhook',
    p_event_id,
    'STRIPE_DISPUTE_RECORDED',
    'ORDER',
    source_order.id,
    normalized_reason,
    pg_catalog.jsonb_build_object(
      'orderPaymentEventId', payment_event_id,
      'stripeEventType', source_event.type,
      'stripeChargeId', p_charge_id,
      'stripeDisputeId', p_dispute_id,
      'amountCents', p_amount_cents,
      'currency', normalized_currency,
      'status', normalized_status,
      'caseAction', COALESCE(case_action, 'none'),
      'hasOrderUpdate', should_apply OR result_action = 'conflict_recorded',
      'disputeSideEffectsApplied', should_apply,
      'orderingAction', result_action,
      'latestRecordedStripeEventId', latest_payment."stripeEventId",
      'latestRecordedStripeEventCreated', latest_payment.stripe_event_created
    ),
    source_now
  );

  RETURN QUERY SELECT
    result_action,
    payment_event_id,
    source_order.id::text,
    source_seller_user_id,
    source_order."buyerId"::text,
    case_id,
    case_action,
    notification_authorized;
END
$grainline_order_payment_signed_dispute_apply$;

CREATE OR REPLACE FUNCTION public.grainline_order_payment_projection_state(
  p_order_id text
)
RETURNS TABLE (
  refund_blocked boolean,
  conversion_dispute_blocked boolean
)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_payment_projection_state$
  SELECT
    EXISTS (
      SELECT 1
        FROM public."OrderPaymentEvent" AS payment
       WHERE payment."orderId" = p_order_id
         AND payment."eventType" = 'REFUND'
         AND (
           payment.status IS NULL
           OR pg_catalog.lower(payment.status) NOT IN (
             'failed', 'canceled', 'cancelled'
           )
         )
    ) AS refund_blocked,
    EXISTS (
      SELECT 1
        FROM (
          SELECT latest_time."stripeObjectId"
            FROM (
              SELECT payment."stripeObjectId",
                     pg_catalog.max(
                       payment."stripeEventCreatedSeconds"
                     ) AS latest_seconds
                FROM public."OrderPaymentEvent" AS payment
               WHERE payment."orderId" = p_order_id
                 AND payment."eventType" = 'DISPUTE'
               GROUP BY payment."stripeObjectId"
            ) AS latest_time
            JOIN public."OrderPaymentEvent" AS payment
              ON payment."orderId" = p_order_id
             AND payment."eventType" = 'DISPUTE'
             AND payment."stripeObjectId" = latest_time."stripeObjectId"
             AND payment."stripeEventCreatedSeconds" =
                 latest_time.latest_seconds
           GROUP BY latest_time."stripeObjectId"
          HAVING pg_catalog.bool_or(
                   payment.status IS NULL
                   OR pg_catalog.lower(payment.status) NOT IN (
                     'won', 'warning_closed'
                   )
                 )
              OR pg_catalog.count(DISTINCT pg_catalog.jsonb_build_array(
                   payment."amountCents",
                   payment.currency,
                   payment.status,
                   payment.reason
                 )) > 1
        ) AS blocking_dispute
    ) AS conversion_dispute_blocked
$grainline_order_payment_projection_state$;

CREATE OR REPLACE FUNCTION public.grainline_order_ops_health_summary()
RETURNS TABLE(
  ambiguous_refund_count bigint,
  stale_refund_claim_count bigint,
  manual_review_label_clawback_count bigint,
  overdue_label_clawback_retry_count bigint,
  aging_review_needed_count bigint,
  stale_checkout_reservation_count bigint,
  recent_payout_failure_count bigint,
  issue_count bigint
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_ops_health_summary$
  WITH source_clock AS (
    SELECT pg_catalog.statement_timestamp() AT TIME ZONE 'UTC' AS now_utc
  ), counts AS (
    SELECT
      (
        SELECT pg_catalog.count(*)
          FROM public."Order" AS source_order
         WHERE source_order."sellerRefundId" =
           'ambiguous_refund_pending_reconciliation'
      ) AS ambiguous_refund_count,
      (
        SELECT pg_catalog.count(*)
          FROM public."Order" AS source_order
         WHERE (
           source_order."sellerRefundId" = 'pending'
           AND COALESCE(
             source_order."refundClaimProviderAuthorizedAt",
             source_order."sellerRefundLockedAt",
             source_order."paidAt",
             source_order."createdAt"
           ) < source_clock.now_utc - interval '30 minutes'
         )
         OR EXISTS (
           SELECT 1
             FROM public."CaseResolutionClaim" AS case_claim
            WHERE case_claim.id = source_order."caseResolutionClaimId"
              AND case_claim.status NOT IN (
                'FINALIZED'::public."CaseResolutionClaimStatus",
                'RELEASED_NO_PROVIDER_EFFECT'::public."CaseResolutionClaimStatus"
              )
              AND case_claim."createdAt" <
                    source_clock.now_utc - interval '1 hour'
         )
      ) AS stale_refund_claim_count,
      (
        SELECT pg_catalog.count(*)
          FROM public."Order" AS source_order
         WHERE source_order."labelClawbackStatus" = 'MANUAL_REVIEW'
      ) AS manual_review_label_clawback_count,
      (
        SELECT pg_catalog.count(*)
          FROM public."Order" AS source_order
         WHERE source_order."labelClawbackStatus" = 'RETRY_PENDING'
           AND source_order."labelClawbackNextAttemptAt" IS NOT NULL
           AND source_order."labelClawbackNextAttemptAt" <
             source_clock.now_utc - interval '30 minutes'
      ) AS overdue_label_clawback_retry_count,
      (
        SELECT pg_catalog.count(*)
          FROM public."Order" AS source_order
         WHERE source_order."reviewNeeded" = true
           AND COALESCE(source_order."paidAt", source_order."createdAt") <
             source_clock.now_utc - interval '24 hours'
      ) AS aging_review_needed_count,
      (
        SELECT pg_catalog.count(*)
          FROM public."CheckoutStockReservation" AS reservation
         WHERE reservation.status IN ('RESERVED', 'SESSION_CREATED')
           AND (
             reservation."expiresAt" <
               source_clock.now_utc - interval '2 hours 30 minutes'
             OR (
               reservation."repairClaimedAt" IS NOT NULL
               AND reservation."repairClaimedAt" <
                 source_clock.now_utc - interval '15 minutes'
             )
             OR (
               reservation."lastRepairError" IS NOT NULL
               AND reservation."lastRepairAttemptAt" IS NOT NULL
               AND reservation."lastRepairAttemptAt" <
                 source_clock.now_utc - interval '30 minutes'
             )
           )
      ) AS stale_checkout_reservation_count,
      (
        SELECT pg_catalog.count(*)
          FROM public."SellerPayoutEvent" AS payout
         WHERE payout.status = 'failed'
           AND payout."updatedAt" >=
             source_clock.now_utc - interval '24 hours'
      ) AS recent_payout_failure_count
      FROM source_clock
  )
  SELECT
    counts.ambiguous_refund_count,
    counts.stale_refund_claim_count,
    counts.manual_review_label_clawback_count,
    counts.overdue_label_clawback_retry_count,
    counts.aging_review_needed_count,
    counts.stale_checkout_reservation_count,
    counts.recent_payout_failure_count,
    counts.ambiguous_refund_count
      + counts.stale_refund_claim_count
      + counts.manual_review_label_clawback_count
      + counts.overdue_label_clawback_retry_count
      + counts.aging_review_needed_count
      + counts.stale_checkout_reservation_count
      + counts.recent_payout_failure_count AS issue_count
    FROM counts;
$grainline_order_ops_health_summary$;

DO $postflight$
DECLARE
  expected jsonb := '{"public.grainline_case_staff_resolution_prepare(text,text,public.\"CaseResolution\",integer,jsonb)":"f70e758f6b40f8e65fbacd046d4259587c0a5d26232281b46110a9f0658df59e","public.grainline_case_staff_resolution_finalize(text,text)":"824f2752ea9c7f260a1eb63de6c9756a4b4086a1d9cb7d72c39d5f0c843e24c9","public.grainline_case_staff_resolution_provider_recovery_load(text,text,public.\"CaseResolution\",integer)":"7b993cc8527ffed03901a36d70ba6883ecf9200ed2b98a86dd5af588498b7cfe","public.grainline_case_staff_resolution_recovery_finalize(text,text)":"02509c7304e27a7e0a7cfa11a9a5a05dd65aff4aa37d8670666fb95de773b460","public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)":"16b15e4f2592143a56111ec709a0bb85c7f2e406b25b28dd5fb09e6cec22a4da","public.grainline_order_payment_signed_dispute_apply(text,bigint,text,text,bigint,integer,text,text,text)":"43524d057ced65d3cc426dcc4358acf55199d55ed40400ef68828f9ac73f0c5c","public.grainline_order_payment_projection_state(text)":"ab504babac584349f4800b6be2a16d8c8176d9677844973dd33074ba7596915a","public.grainline_order_ops_health_summary()":"35529b05c04015c3c6caab0fe6ef59043a92c57a6d6fe16f65b39b1a0a234cac"}'::jsonb;
  item record;
  snap record;
  cur record;
BEGIN
  FOR item IN SELECT key, value #>> '{}' AS sha FROM pg_catalog.jsonb_each(expected) LOOP
    SELECT * INTO snap FROM _case_followup_fn_snapshot WHERE sig = item.key;
    SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner,
           p.prosecdef AS secdef,
           p.proconfig AS cfg,
           COALESCE(p.proacl::text, '') AS acl,
           pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')),
             'hex'
           ) AS sha
      INTO cur
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = pg_catalog.to_regprocedure(item.key);
    IF snap.sig IS NULL
       OR cur.owner IS DISTINCT FROM snap.owner
       OR cur.secdef IS DISTINCT FROM snap.secdef
       OR cur.cfg IS DISTINCT FROM snap.cfg
       OR cur.acl IS DISTINCT FROM snap.acl
       OR cur.sha IS DISTINCT FROM item.sha THEN
      RAISE EXCEPTION 'case follow-up postflight: % drifted', item.key;
    END IF;
  END LOOP;
END
$postflight$;

DROP TABLE _case_followup_fn_snapshot;

COMMIT;
