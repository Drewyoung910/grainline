-- Correct reviewed Case/Order invariants before continuing Order RLS.
-- This additive migration preserves existing signatures, policies and table
-- grants. It fail-closes on predecessor function-body drift, replaces only the
-- reviewed fixed-authority functions, and reconverges exact EXECUTE grants.

BEGIN;

DO $grainline_case_correctness_preflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (VALUES
      ('public.grainline_case_message_page(text,text,timestamp,text,integer)', 'b7c4d553ba8775ea67956621e934d94ae16fc8910ed1d3c9fa8c2d2972f3c3e8', true),
      ('public.grainline_case_stripe_dispute_apply(text)', '9a4ae92cb4ffe1ba5b6bcf0b4d9aa3dd2cfa9585db34fe10e479569c1ea595f0', true),
      ('public.grainline_case_seller_refund_apply(text,text)', 'b12f31cea071753b539be9f919d9a834884a65b2777ff4dbdfa5c44ceaebf544', false),
      ('public.grainline_case_staff_resolution_prepare(text,text,public."CaseResolution",integer,jsonb)', 'ac1a0b8108eb2fb80430cc98f98ca030d209d8f64bf2bd18a197733dbba379ad', true),
      ('public.grainline_case_staff_resolution_provider_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)', 'de3dd4f70dd90e014a9779bf93b661cdee41008d1c47cf615f6adf149e1973c0', true),
      ('public.grainline_case_staff_resolution_finalize(text,text)', '9a0fe6b594af14a4c836dac40e930dc5d7773f10f81a43cc0e4539d6595f9caf', true),
      ('public.grainline_case_staff_resolution_reconcile(text,text,text,text)', '41881c430c0647b3ad3b91913009bbfc068abe0fbffedb04c01e00c570c872aa', true),
      ('public.grainline_order_buyer_pii_prune_batch(integer)', 'ba07d9d0c2cf644e3d55022d302106f3a010b25f2ccb1875205d6ddf104625a1', true),
      ('public.grainline_case_account_deletion_redact(text)', '4638c92b47399b99572df952b130790bd046953c08579b6138bf03e937c8c9f8', true)
      ) AS expected_functions(identity, source_sha256, runtime_execute)
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Predecessor Case correctness function % is missing',
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
      RAISE EXCEPTION 'Predecessor Case correctness function % drifted',
        expected.identity;
    END IF;

    IF pg_catalog.has_function_privilege(
         'grainline_app_runtime', function_oid, 'EXECUTE'
       ) IS DISTINCT FROM expected.runtime_execute
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
      RAISE EXCEPTION 'Predecessor Case function % grant posture drifted',
        expected.identity;
    END IF;
  END LOOP;
END
$grainline_case_correctness_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_case_message_page(
  p_actor_user_id text,
  p_case_id text,
  p_cursor_created_at timestamp(3),
  p_cursor_id text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  "authorId" text,
  "authorKind" text,
  body text,
  "createdAt" timestamp(3),
  attachments jsonb
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_message_page$
DECLARE
  actor_role public."Role";
  actor_banned boolean;
  actor_deleted_at timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_case_id IS NULL
     OR p_case_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL)
     OR (
       p_cursor_id IS NOT NULL
       AND p_cursor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 51 THEN
    RAISE EXCEPTION 'Case-message page input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config(
       'app.user_id',
       p_actor_user_id,
       true
     ) <> p_actor_user_id THEN
    RAISE EXCEPTION 'Case-message page actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  SELECT actor.role, actor.banned, actor."deletedAt"
    INTO actor_role, actor_banned, actor_deleted_at
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id;
  IF NOT FOUND
     OR actor_banned
     OR actor_deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH page AS MATERIALIZED (
    SELECT
      message.id,
      message."authorId",
      message."authorKind",
      message.body,
      message."createdAt",
      case_row."buyerId",
      case_row."sellerId"
      FROM public."CaseMessage" AS message
      JOIN public."Case" AS case_row
        ON case_row.id = message."caseId"
     WHERE message."caseId" = p_case_id
       AND (
         p_actor_user_id IN (
           case_row."buyerId",
           case_row."sellerId"
         )
         OR actor_role IN (
           'EMPLOYEE'::public."Role",
           'ADMIN'::public."Role"
         )
       )
       AND (
         p_cursor_created_at IS NULL
         OR message."createdAt" < p_cursor_created_at
         OR (
           message."createdAt" = p_cursor_created_at
           AND message.id < p_cursor_id
         )
       )
     ORDER BY message."createdAt" DESC, message.id DESC
     LIMIT p_limit
  )
  SELECT
    page.id,
    page."authorId",
    CASE
      WHEN page."authorKind" IS NOT NULL
        THEN page."authorKind"::text
      WHEN page."authorId" = page."buyerId"
        THEN 'BUYER'::text
      WHEN page."authorId" = page."sellerId"
        THEN 'SELLER'::text
      ELSE 'STAFF'::text
    END,
    page.body::text,
    page."createdAt",
    COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', attachment.id,
            'contentType', attachment."contentType",
            'byteSize', attachment."byteSize",
            'createdAt',
              attachment."createdAt" AT TIME ZONE 'UTC'
          )
          ORDER BY attachment."createdAt", attachment.id
        )
          FROM (
            SELECT
              candidate.id,
              candidate."contentType",
              candidate."byteSize",
              candidate."createdAt"
              FROM public."CaseMessageAttachment" AS candidate
             WHERE candidate."caseMessageId" = page.id
             ORDER BY candidate."createdAt", candidate.id
             LIMIT 4
          ) AS attachment
      ),
      '[]'::jsonb
    )
    FROM page
   ORDER BY page."createdAt" DESC, page.id DESC;
END
$grainline_case_message_page$;

CREATE OR REPLACE FUNCTION public.grainline_case_stripe_dispute_apply(
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
AS $grainline_case_stripe_dispute_apply$
DECLARE
  source_order_id text;
  source_event record;
  latest_event record;
  locked_order record;
  existing_case record;
  existing_application record;
  seller_count integer;
  only_seller_user_id text;
  target_case_id text;
  target_action text;
  audit_id text;
  source_event_created bigint;
  transition_at timestamp(3);
  opening_description text;
BEGIN
  IF p_order_payment_event_id IS NULL
     OR pg_catalog.btrim(p_order_payment_event_id) = ''
     OR pg_catalog.char_length(p_order_payment_event_id) > 191 THEN
    RAISE EXCEPTION 'Case Stripe dispute source id is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- The source row reveals only the Order identity needed to acquire the
  -- canonical Order lock. Re-read and lock the source after the Order lock so
  -- a mutable predecessor cannot switch the relationship between reads.
  SELECT payment_event."orderId"
    INTO source_order_id
    FROM public."OrderPaymentEvent" AS payment_event
   WHERE payment_event.id = p_order_payment_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case Stripe dispute source does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    orders.id,
    orders."buyerId",
    orders."stripeChargeId"
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case Stripe dispute Order does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    payment_event.id,
    payment_event."orderId",
    payment_event."stripeEventId",
    payment_event."stripeObjectId",
    payment_event."stripeObjectType",
    payment_event."eventType",
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
    RAISE EXCEPTION 'Case Stripe dispute source changed Order'
      USING ERRCODE = '40001';
  END IF;

  IF source_event."eventType" <> 'DISPUTE'
     OR source_event."stripeObjectType" IS DISTINCT FROM 'dispute'
     OR source_event."stripeEventId" IS NULL
     OR pg_catalog.btrim(source_event."stripeEventId") = ''
     OR source_event."stripeObjectId" IS NULL
     OR pg_catalog.btrim(source_event."stripeObjectId") = ''
     OR pg_catalog.jsonb_typeof(source_event.metadata) <> 'object'
     OR source_event.metadata->>'stripeEventType'
          IS DISTINCT FROM 'charge.dispute.created'
     OR source_event.metadata->>'chargeId'
          IS DISTINCT FROM locked_order."stripeChargeId"
     OR source_event.metadata->>'disputeId'
          IS DISTINCT FROM source_event."stripeObjectId"
     OR source_event.metadata->>'stripeEventCreated' IS NULL
     OR source_event.metadata->>'stripeEventCreated'
          !~ '^[0-9]{1,12}$'
     OR pg_catalog.lower(COALESCE(source_event.status, '')) IN (
          'won',
          'lost',
          'prevented',
          'warning_closed'
        )
     OR source_event.currency !~ '^[a-z]{3}$' THEN
    RAISE EXCEPTION 'Case Stripe dispute source is invalid'
      USING ERRCODE = '23514';
  END IF;

  source_event_created :=
    (source_event.metadata->>'stripeEventCreated')::bigint;

  -- Preserve the webhook handler's event-time ordering inside the authority
  -- boundary. A valid but older charge.dispute.created event must not reopen
  -- a Case after a newer update or terminal dispute event has been recorded.
  SELECT
    payment_event.id,
    payment_event.status,
    (payment_event.metadata->>'stripeEventCreated')::bigint
      AS stripe_event_created
    INTO latest_event
    FROM public."OrderPaymentEvent" AS payment_event
   WHERE payment_event."orderId" = locked_order.id
     AND payment_event."eventType" = 'DISPUTE'
     AND payment_event."stripeObjectType" = 'dispute'
     AND payment_event."stripeObjectId" = source_event."stripeObjectId"
     AND pg_catalog.jsonb_typeof(payment_event.metadata) = 'object'
     AND payment_event.metadata->>'chargeId'
          IS NOT DISTINCT FROM locked_order."stripeChargeId"
     AND payment_event.metadata->>'disputeId'
          IS NOT DISTINCT FROM source_event."stripeObjectId"
     AND payment_event.metadata->>'stripeEventCreated'
          ~ '^[0-9]{1,12}$'
   ORDER BY
     (payment_event.metadata->>'stripeEventCreated')::bigint DESC,
     CASE
       WHEN pg_catalog.lower(COALESCE(payment_event.status, '')) IN (
         'won',
         'lost',
         'prevented',
         'warning_closed'
       )
       THEN 1
       ELSE 0
     END DESC,
     payment_event."createdAt" DESC,
     payment_event.id DESC
   LIMIT 1
   FOR SHARE;

  IF locked_order."buyerId" IS NULL
     OR locked_order."stripeChargeId" IS NULL
     OR pg_catalog.btrim(locked_order."stripeChargeId") = '' THEN
    RAISE EXCEPTION 'Case Stripe dispute Order lacks retained authority'
      USING ERRCODE = '23514';
  END IF;

  -- Lock the complete retained Order/seller relationship in a stable order
  -- before deriving the one exact seller.
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
     OR locked_order."buyerId" = only_seller_user_id THEN
    RAISE EXCEPTION 'Case Stripe dispute Order has invalid participants'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    case_row.id,
    case_row.status
    INTO existing_case
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = locked_order.id
   FOR UPDATE;

  IF FOUND THEN
    target_case_id := existing_case.id;
    target_action := 'reopen';
  ELSE
    target_case_id := pg_catalog.gen_random_uuid()::text;
    target_action := 'create';
  END IF;

  SELECT
    application."caseId",
    application."orderId",
    application.action
    INTO existing_application
    FROM public."CaseStripeDisputeApplication" AS application
   WHERE application."paymentEventId" = source_event.id
   FOR SHARE;

  IF FOUND THEN
    IF existing_application."caseId" IS DISTINCT FROM target_case_id
       OR existing_application."orderId" IS DISTINCT FROM locked_order.id
       OR existing_application.action NOT IN ('create', 'reopen') THEN
      RAISE EXCEPTION 'Case Stripe dispute replay authority is invalid'
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

  IF latest_event.stripe_event_created > source_event_created
     OR (
       latest_event.stripe_event_created = source_event_created
       AND pg_catalog.lower(COALESCE(latest_event.status, '')) IN (
         'won',
         'lost',
         'prevented',
         'warning_closed'
       )
     ) THEN
    RAISE EXCEPTION 'Case Stripe dispute source is superseded'
      USING ERRCODE = '23514';
  END IF;

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
  opening_description := pg_catalog.left(
    'Stripe payment dispute '
      || source_event."stripeObjectId"
      || CASE
           WHEN source_event.reason IS NULL
             OR pg_catalog.btrim(source_event.reason) = ''
           THEN ''
           ELSE ': ' || source_event.reason
         END,
    5000
  );

  IF target_action = 'create' THEN
    INSERT INTO public."Case" (
      id,
      "orderId",
      "buyerId",
      "sellerId",
      reason,
      description,
      status,
      "sellerRespondBy",
      "openedByPaymentEventId",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      target_case_id,
      locked_order.id,
      locked_order."buyerId",
      only_seller_user_id,
      'OTHER'::public."CaseReason",
      opening_description,
      'UNDER_REVIEW'::public."CaseStatus",
      transition_at + INTERVAL '48 hours',
      source_event.id,
      transition_at,
      transition_at
    );
  ELSE
    UPDATE public."Case" AS case_row
       SET status = 'UNDER_REVIEW'::public."CaseStatus",
           resolution = NULL,
           "refundAmountCents" = NULL,
           "stripeRefundId" = NULL,
           "resolvedAt" = NULL,
           "resolvedById" = NULL,
           "buyerMarkedResolved" = false,
           "sellerMarkedResolved" = false,
           "updatedAt" = transition_at
     WHERE case_row.id = target_case_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case Stripe dispute target disappeared'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  INSERT INTO public."CaseStripeDisputeApplication" (
    "paymentEventId",
    "caseId",
    "orderId",
    action,
    "createdAt"
  )
  VALUES (
    source_event.id,
    target_case_id,
    locked_order.id,
    target_action,
    transition_at
  );

  audit_id :=
    'case-stripe-dispute-audit:' || pg_catalog.gen_random_uuid()::text;
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
    source_event."stripeEventId",
    'CASE_STRIPE_DISPUTE_APPLIED',
    'CASE',
    target_case_id,
    source_event.reason,
    pg_catalog.jsonb_build_object(
      'orderPaymentEventId', source_event.id,
      'orderId', locked_order.id,
      'stripeEventId', source_event."stripeEventId",
      'stripeDisputeId', source_event."stripeObjectId",
      'caseAction', target_action
    ),
    transition_at
  );

  RETURN QUERY SELECT
    target_case_id,
    locked_order.id::text,
    only_seller_user_id,
    locked_order."buyerId"::text,
    source_event.id::text,
    target_action;
END
$grainline_case_stripe_dispute_apply$;

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

  transition_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
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

  IF pg_catalog.jsonb_array_length(locked_claim."stockRestorePlan") > 0
     AND locked_order."fulfillmentStatus" IN (
       'SHIPPED'::public."FulfillmentStatus",
       'DELIVERED'::public."FulfillmentStatus",
       'PICKED_UP'::public."FulfillmentStatus"
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

CREATE OR REPLACE FUNCTION public.grainline_order_buyer_pii_prune_batch(
  p_batch_size integer
)
RETURNS TABLE (
  purged bigint,
  cutoff timestamp without time zone
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_pii_prune_batch$
DECLARE
  fixed_cutoff timestamp(3) without time zone;
  purged_count bigint;
BEGIN
  IF p_batch_size IS NULL
     OR p_batch_size < 1
     OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'Order buyer-PII prune batch size is invalid'
      USING ERRCODE = '22023';
  END IF;

  fixed_cutoff :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
    - INTERVAL '90 days';

  WITH pii_candidates AS MATERIALIZED (
    SELECT order_row.id
      FROM public."Order" AS order_row
     WHERE order_row."reviewNeeded" = false
       AND order_row."paymentOpenDisputeBlocked" = false
       AND order_row."fulfillmentStatus" IN (
         'DELIVERED'::public."FulfillmentStatus",
         'PICKED_UP'::public."FulfillmentStatus"
       )
       AND COALESCE(
         order_row."deliveredAt",
         order_row."pickedUpAt"
       ) IS NOT NULL
       AND COALESCE(
         order_row."deliveredAt",
         order_row."pickedUpAt"
       ) < fixed_cutoff
       AND NOT EXISTS (
         SELECT 1
           FROM public."Case" AS case_row
          WHERE case_row."orderId" = order_row.id
            AND case_row.status IN (
              'OPEN'::public."CaseStatus",
              'IN_DISCUSSION'::public."CaseStatus",
              'PENDING_CLOSE'::public."CaseStatus",
              'UNDER_REVIEW'::public."CaseStatus"
            )
       )
       AND (
         order_row."buyerEmail" IS NOT NULL OR
         order_row."buyerName" IS NOT NULL OR
         order_row."shipToLine1" IS NOT NULL OR
         order_row."shipToLine2" IS NOT NULL OR
         order_row."shipToCity" IS NOT NULL OR
         order_row."shipToState" IS NOT NULL OR
         order_row."shipToPostalCode" IS NOT NULL OR
         order_row."shipToCountry" IS NOT NULL OR
         order_row."quotedToLine1" IS NOT NULL OR
         order_row."quotedToLine2" IS NOT NULL OR
         order_row."quotedToCity" IS NOT NULL OR
         order_row."quotedToState" IS NOT NULL OR
         order_row."quotedToPostalCode" IS NOT NULL OR
         order_row."quotedToCountry" IS NOT NULL OR
         order_row."quotedToName" IS NOT NULL OR
         order_row."quotedToPhone" IS NOT NULL OR
         order_row."trackingCarrier" IS NOT NULL OR
         order_row."trackingNumber" IS NOT NULL OR
         order_row."sellerNotes" IS NOT NULL OR
         order_row."shippoShipmentId" IS NOT NULL OR
         order_row."shippoRateObjectId" IS NOT NULL OR
         order_row."shippoTransactionId" IS NOT NULL OR
         order_row."labelUrl" IS NOT NULL OR
         order_row."labelCarrier" IS NOT NULL OR
         order_row."labelTrackingNumber" IS NOT NULL OR
         order_row."giftNote" IS NOT NULL OR
         EXISTS (
           SELECT 1
             FROM public."OrderShippingRateQuote" AS quote
            WHERE quote."orderId" = order_row.id
         )
       )
     ORDER BY
       COALESCE(order_row."deliveredAt", order_row."pickedUpAt") ASC,
       order_row.id ASC
     FOR UPDATE OF order_row SKIP LOCKED
     LIMIT p_batch_size
  ),
  deleted_quotes AS (
    DELETE FROM public."OrderShippingRateQuote" AS quote
     USING pii_candidates
     WHERE quote."orderId" = pii_candidates.id
     RETURNING quote.id
  ),
  updated_orders AS (
    UPDATE public."Order" AS order_row
       SET
         "buyerEmail" = NULL,
         "buyerName" = NULL,
         "shipToLine1" = NULL,
         "shipToLine2" = NULL,
         "shipToCity" = NULL,
         "shipToState" = NULL,
         "shipToPostalCode" = NULL,
         "shipToCountry" = NULL,
         "quotedToLine1" = NULL,
         "quotedToLine2" = NULL,
         "quotedToCity" = NULL,
         "quotedToState" = NULL,
         "quotedToPostalCode" = NULL,
         "quotedToCountry" = NULL,
         "quotedToName" = NULL,
         "quotedToPhone" = NULL,
         "trackingCarrier" = NULL,
         "trackingNumber" = NULL,
         "sellerNotes" = NULL,
         "shippoShipmentId" = NULL,
         "shippoRateObjectId" = NULL,
         "shippoTransactionId" = NULL,
         "labelUrl" = NULL,
         "labelCarrier" = NULL,
         "labelTrackingNumber" = NULL,
         "giftNote" = NULL,
         "buyerDataPurgedAt" =
           pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      FROM pii_candidates
     WHERE order_row.id = pii_candidates.id
     RETURNING order_row.id
  )
  SELECT pg_catalog.count(*)::bigint
    INTO purged_count
    FROM updated_orders;

  RETURN QUERY SELECT purged_count, fixed_cutoff;
END
$grainline_order_buyer_pii_prune_batch$;

CREATE OR REPLACE FUNCTION public.grainline_case_account_deletion_redact(
  p_account_deletion_side_effect_id text
)
RETURNS TABLE (
  "sideEffectId" text,
  "userId" text,
  "authoredMessagesRedacted" integer,
  "quotedMessagesRedacted" integer,
  "buyerDescriptionsRedacted" integer,
  "participantDescriptionsRedacted" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_account_deletion_redact$
DECLARE
  discovered_effect record;
  locked_user record;
  locked_effect record;
  sensitive_values text[];
  active_case_count bigint;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION
      'Case account-deletion redaction requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;
  IF p_account_deletion_side_effect_id IS NULL
     OR pg_catalog.btrim(p_account_deletion_side_effect_id) = ''
     OR pg_catalog.char_length(p_account_deletion_side_effect_id) > 191 THEN
    RAISE EXCEPTION 'Case account-deletion side effect is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- This unlocked read discovers the canonical User lock target only. The
  -- side effect and every source predicate are re-read after the User lock.
  SELECT
    effect.id,
    effect."userId"
    INTO discovered_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_account_deletion_side_effect_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case account-deletion side effect does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT
    account_user.id,
    account_user."deletedAt"
    INTO locked_user
    FROM public."User" AS account_user
   WHERE account_user.id = discovered_effect."userId"
   FOR UPDATE;
  IF NOT FOUND OR locked_user."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case account-deletion User is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    effect.id,
    effect."userId",
    effect.kind,
    effect."dedupKey",
    effect.payload,
    effect.status
    INTO locked_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_account_deletion_side_effect_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_effect."userId" IS DISTINCT FROM locked_user.id THEN
    RAISE EXCEPTION 'Case account-deletion source changed'
      USING ERRCODE = '40001';
  END IF;
  IF locked_effect.kind IS DISTINCT FROM 'LOCAL_ANONYMIZE'
     OR locked_effect."dedupKey"
          IS DISTINCT FROM 'account-delete:local:' || locked_user.id
     OR locked_effect.payload IS DISTINCT FROM '{}'::jsonb
     OR locked_effect.status IS NULL
     OR locked_effect.status NOT IN ('PENDING', 'PROCESSING', 'FAILED') THEN
    RAISE EXCEPTION 'Case account-deletion source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  -- The earlier account-deletion preflight is advisory. Lock every Order
  -- involving this buyer or seller in canonical id order before the final
  -- Case check. Buyer Case-open already blocks on the User lock; seller
  -- Case-open blocks on its Order lock, then observes the completed deletion.
  PERFORM order_row.id
    FROM public."Order" AS order_row
   WHERE order_row."buyerId" = locked_user.id
      OR EXISTS (
        SELECT 1
          FROM public."SellerProfile" AS seller
         WHERE seller.id = order_row."sellerProfileId"
           AND seller."userId" = locked_user.id
      )
   ORDER BY order_row.id
   FOR UPDATE OF order_row;

  -- Use a fresh READ COMMITTED statement snapshot after the Order locks so
  -- a concurrently committed Case is visible before any redaction begins.
  SELECT pg_catalog.count(*)::bigint
    INTO active_case_count
    FROM public."Case" AS case_row
   WHERE (
       case_row."buyerId" = locked_user.id
       OR case_row."sellerId" = locked_user.id
     )
     AND case_row.status IN (
       'OPEN'::public."CaseStatus",
       'IN_DISCUSSION'::public."CaseStatus",
       'PENDING_CLOSE'::public."CaseStatus",
       'UNDER_REVIEW'::public."CaseStatus"
     );
  IF active_case_count > 0 THEN
    RAISE EXCEPTION
      'Case account-deletion redaction is blocked by an active Case'
      USING ERRCODE = '55000';
  END IF;

  -- This is intentionally byte-equivalent in purpose to the already-live
  -- Conversation/Message deletion derivation. Values come only from the
  -- locked account, its SellerProfile and unclaimed email history; the
  -- runtime cannot provide redaction needles.
  WITH raw_sensitive_value(value) AS (
    SELECT profile_value.value
      FROM public."User" AS account_user
      LEFT JOIN public."SellerProfile" AS seller
        ON seller."userId" = account_user.id
      CROSS JOIN LATERAL pg_catalog.unnest(ARRAY[
        account_user.id,
        account_user."clerkId",
        account_user.email,
        account_user.name,
        account_user."shippingName",
        account_user."shippingLine1",
        account_user."shippingLine2",
        account_user."shippingCity",
        account_user."shippingState",
        account_user."shippingPostalCode",
        account_user."shippingPhone",
        seller.id,
        seller."displayName",
        seller.city,
        seller.state,
        seller."shipFromName",
        seller."shipFromLine1",
        seller."shipFromLine2",
        seller."shipFromCity",
        seller."shipFromState",
        seller."shipFromPostal",
        seller.tagline,
        seller."bannerImageUrl",
        seller."avatarImageUrl",
        seller."workshopImageUrl",
        seller."instagramUrl",
        seller."facebookUrl",
        seller."pinterestUrl",
        seller."tiktokUrl",
        seller."websiteUrl"
      ]::text[]) AS profile_value(value)
     WHERE account_user.id = locked_user.id

    UNION ALL

    SELECT address.email
      FROM public."UserEmailAddress" AS address
     WHERE address."userId" = locked_user.id
       AND NOT EXISTS (
         SELECT 1
           FROM public."User" AS other_user
          WHERE other_user.id <> locked_user.id
            AND other_user."deletedAt" IS NULL
            AND public.grainline_account_deletion_email_key_core(
                  other_user.email
                ) = public.grainline_account_deletion_email_key_core(
                  address.email
                )
       )
  ),
  normalized_sensitive_value AS (
    SELECT DISTINCT pg_catalog.lower(pg_catalog.btrim(value)) AS value
      FROM raw_sensitive_value
     WHERE value IS NOT NULL
       AND pg_catalog.char_length(
             pg_catalog.lower(pg_catalog.btrim(value))
           ) >= 2
  )
  SELECT COALESCE(
           pg_catalog.array_agg(
             value
             ORDER BY pg_catalog.char_length(value) DESC, value
           ),
           ARRAY[]::text[]
         )
    INTO sensitive_values
    FROM normalized_sensitive_value;

  UPDATE public."CaseMessage" AS message
     SET body = '[Message deleted]'
   WHERE message."authorId" = locked_user.id
     AND message.body IS DISTINCT FROM '[Message deleted]';
  GET DIAGNOSTICS "authoredMessagesRedacted" = ROW_COUNT;

  WITH redaction AS (
    SELECT
      message.id,
      public.grainline_account_deletion_redact_text_core(
        message.body,
        sensitive_values
      ) AS redacted_body
      FROM public."CaseMessage" AS message
     WHERE message."authorId" IS DISTINCT FROM locked_user.id
       AND EXISTS (
         SELECT 1
           FROM public."Case" AS parent_case
          WHERE parent_case.id = message."caseId"
            AND (
              parent_case."buyerId" = locked_user.id
              OR parent_case."sellerId" = locked_user.id
            )
       )
  )
  UPDATE public."CaseMessage" AS message
     SET body = redaction.redacted_body
    FROM redaction
   WHERE message.id = redaction.id
     AND message.body IS DISTINCT FROM redaction.redacted_body;
  GET DIAGNOSTICS "quotedMessagesRedacted" = ROW_COUNT;

  UPDATE public."Case" AS case_row
     SET description = '[Case description deleted]'
   WHERE case_row."buyerId" = locked_user.id
     AND case_row.description
           IS DISTINCT FROM '[Case description deleted]';
  GET DIAGNOSTICS "buyerDescriptionsRedacted" = ROW_COUNT;

  WITH redaction AS (
    SELECT
      case_row.id,
      public.grainline_account_deletion_redact_text_core(
        case_row.description,
        sensitive_values
      ) AS redacted_description
      FROM public."Case" AS case_row
     WHERE case_row."sellerId" = locked_user.id
       AND case_row."buyerId" IS DISTINCT FROM locked_user.id
       AND case_row.description IS NOT NULL
  )
  UPDATE public."Case" AS case_row
     SET description = redaction.redacted_description
    FROM redaction
   WHERE case_row.id = redaction.id
     AND case_row.description
           IS DISTINCT FROM redaction.redacted_description;
  GET DIAGNOSTICS "participantDescriptionsRedacted" = ROW_COUNT;

  "sideEffectId" := locked_effect.id;
  "userId" := locked_user.id;
  RETURN NEXT;
END
$grainline_case_account_deletion_redact$;

REVOKE ALL ON FUNCTION
  public.grainline_case_message_page(text, text, timestamp, text, integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_message_page(text, text, timestamp, text, integer)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_stripe_dispute_apply(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_stripe_dispute_apply(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_seller_refund_apply(text, text)
  FROM PUBLIC, grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_prepare(text, text, public."CaseResolution", integer, jsonb)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_prepare(text, text, public."CaseResolution", integer, jsonb)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_provider_record(text, text, text, text, text[], text[], text, integer, boolean, boolean)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_provider_record(text, text, text, text, text[], text[], text, integer, boolean, boolean)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_finalize(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_finalize(text, text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_resolution_reconcile(text, text, text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_resolution_reconcile(text, text, text, text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_order_buyer_pii_prune_batch(integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_buyer_pii_prune_batch(integer)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_case_account_deletion_redact(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_account_deletion_redact(text)
  TO grainline_app_runtime;

DO $grainline_case_correctness_postflight$
DECLARE
  expected record;
  function_oid oid;
  actual_hash text;
BEGIN
  FOR expected IN
    SELECT *
      FROM (VALUES
      ('public.grainline_case_message_page(text,text,timestamp,text,integer)', 'be41b07f88b91a3aa29219998ea7fc5c4fc6e4d4e5f84deca921a4d33b2d9286', true),
      ('public.grainline_case_stripe_dispute_apply(text)', '0ccbd8bbd0daf6a519618c87e4c3b1b352b314cc99d43c38c53805b4289b74a1', true),
      ('public.grainline_case_seller_refund_apply(text,text)', '1298be7c5b6750d24ff295909f8188c347745b94396c9311649cdba4848e477e', false),
      ('public.grainline_case_staff_resolution_prepare(text,text,public."CaseResolution",integer,jsonb)', 'c433e9d779eb6f482ab7ed34ee9d341220dec8a426f69e1954fa1002167b49ae', true),
      ('public.grainline_case_staff_resolution_provider_record(text,text,text,text,text[],text[],text,integer,boolean,boolean)', '721ab18d24daa5e9c65f77a33c132dc9f5ad5096d366f5fadb5758d301c74af5', true),
      ('public.grainline_case_staff_resolution_finalize(text,text)', '7b7ff76969a059f6bd4a947a790dc3482d6c1aaabfb14eaf3bafc953b51782c8', true),
      ('public.grainline_case_staff_resolution_reconcile(text,text,text,text)', '20407470f8702837f7f98bab8a5ce684e084cc067d07ea0db013f7011b8e39a2', true),
      ('public.grainline_order_buyer_pii_prune_batch(integer)', '148d3a7041af2b92f159ece8c8be3999bc4906b47f578231990322d8dc456e0b', true),
      ('public.grainline_case_account_deletion_redact(text)', 'cf1f9284608b9204cfe7538ec38f86e92ce0a712aad1c2d777c5d018b5d1b4c8', true)
      ) AS expected_functions(identity, source_sha256, runtime_execute)
  LOOP
    function_oid := pg_catalog.to_regprocedure(expected.identity);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Corrected Case correctness function % is missing',
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
      RAISE EXCEPTION 'Corrected Case correctness function % drifted',
        expected.identity;
    END IF;

    IF pg_catalog.has_function_privilege(
         'grainline_app_runtime', function_oid, 'EXECUTE'
       ) IS DISTINCT FROM expected.runtime_execute
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
      RAISE EXCEPTION 'Corrected Case function % grant posture drifted',
        expected.identity;
    END IF;
  END LOOP;
END
$grainline_case_correctness_postflight$;

COMMIT;
