-- DRAFT ONLY: no migration or production workflow is wired.
-- Add explicit NULL rejection to the two source-bound label outcome writers.
-- Preserve signatures, successful/rejected/ambiguous behavior, ACLs and table posture.
-- Production packaging must bind the exact database, role, ledger and release state.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $label_outcome_before$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_order_seller_label_provider_record(text,text,text,bigint,text,text,text,text,integer,text,text,text,text)')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND CURRENT_USER <> 'grainline_app_runtime'
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = '0a93dbca2ea2eef3cb4a63f9737314e2'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION 'Order label outcome before authority drifted: grainline_order_seller_label_provider_record';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_order_label_clawback_finalize(text,text,bigint,bigint,text,text,text)')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND CURRENT_USER <> 'grainline_app_runtime'
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = '4271129466566891944c904794796d0e'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION 'Order label outcome before authority drifted: grainline_order_label_clawback_finalize';
  END IF;
END
$label_outcome_before$;

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

    IF p_amount_cents = 0 THEN
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
           "fulfillmentMethod" = 'SHIPPING'::public."FulfillmentMethod",
           "fulfillmentStatus" = 'SHIPPED'::public."FulfillmentStatus",
           "shippedAt" = now_utc,
           "trackingCarrier" = p_carrier,
           "trackingNumber" = p_tracking_number,
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
           "reviewNote" = CASE WHEN next_clawback_status = 'MANUAL_REVIEW' THEN
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
      audit_id, 'user', p_actor_user_id, 'ORDER_FULFILLMENT_TRANSITION', 'ORDER', locked_order.id,
      pg_catalog.jsonb_build_object(
        'action', 'shipped', 'newStatus', 'SHIPPED',
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
  IF FOUND
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
    'auditLogId', audit_id,
    'buyerUserId', buyer_user_id, 'buyerName', buyer_name, 'buyerEmail', buyer_email,
    'estimatedDeliveryDate', locked_order."estimatedDeliveryDate"
  );
END
$grainline_order_seller_label_provider_record$;

CREATE OR REPLACE FUNCTION public.grainline_order_label_clawback_finalize(
  p_order_id text,
  p_claim_id text,
  p_claim_generation bigint,
  p_clawback_generation bigint,
  p_outcome text,
  p_reversal_id text,
  p_error_summary text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_label_clawback_finalize$
DECLARE
  locked_order public."Order"%ROWTYPE;
  now_utc timestamp(3) without time zone;
  next_status text;
  next_attempt timestamp(3) without time zone;
  bounded_error text;
BEGIN
  IF p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_id IS NULL OR p_claim_id !~ '^order-label-claim:[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_clawback_generation IS NULL OR p_clawback_generation < 1
     OR p_outcome IS NULL OR p_outcome NOT IN ('SUCCESS', 'FAILED')
     OR (p_reversal_id IS NOT NULL AND p_reversal_id !~ '^[A-Za-z0-9._:-]{1,255}$')
     OR (p_error_summary IS NOT NULL AND pg_catalog.char_length(p_error_summary) > 500)
     OR (p_outcome = 'SUCCESS' AND p_reversal_id IS NULL) THEN
    RAISE EXCEPTION 'Order label clawback result input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT candidate.* INTO locked_order
    FROM public."Order" AS candidate WHERE candidate.id = p_order_id
   FOR UPDATE OF candidate;
  IF NOT FOUND
     OR locked_order."labelClaimId" IS DISTINCT FROM p_claim_id
     OR locked_order."labelClaimGeneration" <> p_claim_generation
     OR locked_order."labelClawbackGeneration" <> p_clawback_generation
     OR locked_order."labelClaimStatus" <> 'PROVIDER_RECORDED'
     OR locked_order."labelClawbackStatus" <> 'RETRYING' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'stale_claim');
  END IF;

  now_utc := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  IF p_outcome = 'SUCCESS' THEN
    UPDATE public."Order"
       SET "labelClawbackStatus" = 'REVERSED',
           "labelClawbackReversalId" = p_reversal_id,
           "labelClawbackLastAttemptAt" = now_utc,
           "labelClawbackNextAttemptAt" = NULL,
           "labelClawbackResolvedAt" = now_utc,
           "labelClaimStatus" = 'FINALIZED'
     WHERE id = locked_order.id;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'finalized', 'orderId', locked_order.id,
      'clawbackStatus', 'REVERSED'
    );
  END IF;

  bounded_error := pg_catalog.left(
    pg_catalog.regexp_replace(COALESCE(p_error_summary, 'Unknown Stripe reversal error'),
      '[[:space:]]+', ' ', 'g'), 500
  );
  IF locked_order."labelClawbackRetryCount" >= 5 THEN
    next_status := 'MANUAL_REVIEW';
    next_attempt := NULL;
  ELSE
    next_status := 'RETRY_PENDING';
    next_attempt := now_utc + CASE locked_order."labelClawbackRetryCount"
      WHEN 1 THEN interval '15 minutes'
      WHEN 2 THEN interval '1 hour'
      WHEN 3 THEN interval '6 hours'
      ELSE interval '24 hours'
    END;
  END IF;

  UPDATE public."Order"
     SET "labelClawbackStatus" = next_status,
         "labelClawbackLastAttemptAt" = now_utc,
         "labelClawbackNextAttemptAt" = next_attempt,
         "labelClawbackResolvedAt" = NULL,
         "reviewNeeded" = true,
         "reviewNote" = pg_catalog.left(
           COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
           'Shippo label ' || COALESCE("shippoTransactionId", 'unknown') ||
           ' cost ' || COALESCE("labelCostCents", 0)::text || ' ' ||
           pg_catalog.upper(currency) ||
           ', but Stripe transfer reversal failed. Stripe error: ' || bounded_error ||
           '. Staff must retry or manually reconcile the seller payout.',
           10000
         ),
         "labelClaimStatus" = CASE
           WHEN next_status = 'MANUAL_REVIEW' THEN 'FINALIZED'
           ELSE "labelClaimStatus"
         END
   WHERE id = locked_order.id;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'recorded_failure', 'orderId', locked_order.id,
    'clawbackStatus', next_status, 'nextAttemptAt', next_attempt
  );
END
$grainline_order_label_clawback_finalize$;

DO $label_outcome_after$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_order_seller_label_provider_record(text,text,text,bigint,text,text,text,text,integer,text,text,text,text)')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND CURRENT_USER <> 'grainline_app_runtime'
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = '15f64d3eed9ffdea5d09c03bc730f33a'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION 'Order label outcome after authority drifted: grainline_order_seller_label_provider_record';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_order_label_clawback_finalize(text,text,bigint,bigint,text,text,text)')
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND CURRENT_USER <> 'grainline_app_runtime'
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = '1b805511f6450535037f7cee1166e0a1'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION 'Order label outcome after authority drifted: grainline_order_label_clawback_finalize';
  END IF;
END
$label_outcome_after$;

COMMIT;
