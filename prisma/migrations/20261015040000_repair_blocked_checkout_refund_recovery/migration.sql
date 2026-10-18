-- Recover an exact blocked-checkout refund claim after signed refund evidence
-- blocks ordinary checkout completion, and let immutable ADMIN reconciliation
-- record a provider refund from a processed or later-generation source event.

BEGIN;

DO $grainline_blocked_checkout_refund_recovery_preflight$
DECLARE
  order_owner oid;
  runtime_role oid;
  accepted_functions integer;
BEGIN
  SELECT table_row.relowner
    INTO order_owner
    FROM pg_catalog.pg_class AS table_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = table_row.relnamespace
   WHERE namespace.nspname = 'public'
     AND table_row.relname = 'Order'
     AND table_row.relkind = 'r';
  SELECT role_row.oid
    INTO runtime_role
    FROM pg_catalog.pg_roles AS role_row
   WHERE role_row.rolname = 'grainline_app_runtime';
  IF order_owner IS NULL OR runtime_role IS NULL THEN
    RAISE EXCEPTION 'Blocked-checkout refund recovery roles or Order table are missing';
  END IF;

  WITH expected(function_identity, source_md5) AS (
    VALUES
      (
        'public.grainline_stripe_checkout_order_existing(text,bigint,text)',
        '4bd7580c27318ff118ea9640c3dd72b0'
      ),
      (
        'public.grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)',
        'fb4e95894e189462ff2a1d8f953c248d'
      )
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_functions
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE namespace.nspname = 'public'
     AND language.lanname = 'plpgsql'
     AND procedure.prokind = 'f'
     AND procedure.proowner = order_owner
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') = 0
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee <> procedure.proowner
     ) = 1
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee = runtime_role
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
     ) = 1;
  IF accepted_functions <> 2 THEN
    RAISE EXCEPTION
      'Blocked-checkout refund recovery predecessor catalog drifted: accepted=%',
      accepted_functions;
  END IF;
END
$grainline_blocked_checkout_refund_recovery_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_stripe_checkout_order_existing(
  p_event_id text,
  p_claim_generation bigint,
  p_session_id text
)
RETURNS TABLE(
  outcome text,
  order_id text,
  retry_reason text,
  seller_user_ids text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  source_marker_position integer;
  source_retry_reason text;
  source_seller_user_id text;
  source_refund_lock_stale boolean;
  source_blocked_checkout_refund_required boolean;
  source_has_refund_evidence boolean;
BEGIN
  IF p_event_id IS NULL OR p_event_id = '' OR pg_catalog.length(p_event_id) > 255
     OR p_claim_generation IS NULL OR p_claim_generation <= 0
     OR p_session_id IS NULL OR p_session_id = '' OR pg_catalog.length(p_session_id) > 255 THEN
    RAISE EXCEPTION 'Checkout existing identity is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR source_event."sourceObjectId" IS DISTINCT FROM p_session_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Checkout existing event authority is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT source.*
    INTO source_order
    FROM public."Order" AS source
   WHERE source."stripeSessionId" = p_session_id
   FOR SHARE;
  IF NOT FOUND THEN
    outcome := 'absent';
    order_id := NULL;
    retry_reason := NULL;
    seller_user_ids := ARRAY[]::text[];
    RETURN NEXT;
    RETURN;
  END IF;

  order_id := source_order.id;
  retry_reason := NULL;
  seller_user_ids := ARRAY[]::text[];
  source_marker_position := pg_catalog.strpos(
    COALESCE(source_order."reviewNote", ''),
    'Order was held for staff review.'
  );
  IF source_order."reviewNeeded" AND source_marker_position > 0 THEN
    source_retry_reason := NULLIF(
      pg_catalog.btrim(
        pg_catalog.substr(source_order."reviewNote", 1, source_marker_position - 1)
      ),
      ''
    );
  END IF;

  source_blocked_checkout_refund_required :=
    source_order."blockedCheckoutRefundRequiredAt" IS NOT NULL
    AND source_order."blockedCheckoutRefundRecordedAt" IS NULL;
  IF source_blocked_checkout_refund_required THEN
    source_retry_reason := COALESCE(
      source_retry_reason,
      'Checkout became ineligible after payment and requires a full refund.'
    );
    source_refund_lock_stale := source_order."sellerRefundId" = 'pending'
      AND (
        source_order."sellerRefundLockedAt" IS NULL
        OR source_order."sellerRefundLockedAt" < (
          pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
        ) - INTERVAL '15 minutes'
      );
    SELECT source_order."paymentRefundBlocked"
      OR (
        source_order."sellerRefundId" IS NOT NULL
        AND source_order."sellerRefundId" NOT IN (
          'pending', 'ambiguous_refund_pending_reconciliation'
        )
      )
      OR EXISTS (
        SELECT 1
          FROM public."OrderPaymentEvent" AS payment_event
         WHERE payment_event."orderId" = source_order.id
           AND payment_event."eventType" = 'REFUND'
           AND (
             payment_event.status IS NULL
             OR pg_catalog.lower(payment_event.status)
               NOT IN ('failed', 'canceled', 'cancelled')
           )
      )
      INTO source_has_refund_evidence;
    IF source_order."refundClaimId" IS NOT NULL THEN
      IF source_order."paymentRefundBlocked"
         AND source_order."sellerRefundId" = 'pending'
         AND source_order."refundClaimSource" = 'BLOCKED_CHECKOUT'
         AND source_order."refundClaimSourceId" = p_event_id
         AND source_order."refundClaimSourceGeneration" IS NOT NULL
         AND source_order."refundClaimSourceGeneration" <= p_claim_generation
         AND source_order."refundClaimProviderAuthorizedAt" IS NOT NULL THEN
        -- A signed charge.refunded event may set paymentRefundBlocked before
        -- the checkout event retries after a local finalize failure. Resume
        -- only the exact provider-authorized claim so the existing provider
        -- refund can be recorded; do not create another refund.
        outcome := 'retry';
      ELSIF source_order."paymentRefundBlocked" THEN
        outcome := 'processing';
      ELSIF source_order."sellerRefundId" = 'pending'
         AND source_order."refundClaimSource" = 'BLOCKED_CHECKOUT'
         AND source_order."refundClaimSourceId" = p_event_id THEN
        outcome := 'retry';
      ELSE
        outcome := 'processing';
      END IF;
    ELSIF source_order."sellerRefundId" = 'pending' THEN
      outcome := CASE WHEN source_refund_lock_stale THEN 'retry' ELSE 'processing' END;
    ELSIF source_order."sellerRefundId"
          = 'ambiguous_refund_pending_reconciliation' THEN
      outcome := 'processing';
    ELSIF source_has_refund_evidence THEN
      outcome := 'complete';
    ELSIF source_order."sellerRefundId" IS NULL THEN
      outcome := 'retry';
    ELSE
      outcome := 'processing';
    END IF;
  ELSE
    outcome := 'complete';
  END IF;

  IF outcome = 'retry' THEN
    retry_reason := source_retry_reason;
    SELECT seller."userId"
      INTO source_seller_user_id
      FROM public."SellerProfile" AS seller
     WHERE seller.id = source_order."sellerProfileId";
    seller_user_ids := CASE
      WHEN source_seller_user_id IS NULL THEN ARRAY[]::text[]
      ELSE ARRAY[source_seller_user_id]
    END;
  END IF;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
  p_reconciliation_id text,
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
AS $grainline_blocked_checkout_refund_reconciliation_record$
DECLARE
  source_reconciliation public."OrderRefundReconciliation"%ROWTYPE;
  source_actor public."User"%ROWTYPE;
  locked_event public."StripeWebhookEvent"%ROWTYPE;
  record_result jsonb;
  already_recorded boolean;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_reconciliation_id IS NULL
     OR p_reconciliation_id !~ '^order-refund-reconcile:[0-9a-f-]{36}$'
     OR p_claim_id IS NULL
     OR p_claim_id !~ '^order_refund_claim_[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_refund_id IS NULL
     OR p_refund_id !~ '^re_[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_refund_id) > 220 THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation record input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT reconciliation.*
    INTO source_reconciliation
    FROM public."OrderRefundReconciliation" AS reconciliation
   WHERE reconciliation.id = p_reconciliation_id
     AND reconciliation."claimId" = p_claim_id
     AND reconciliation."claimGeneration" = p_claim_generation
   FOR SHARE;
  IF NOT FOUND
     OR source_reconciliation."claimSource" <> 'BLOCKED_CHECKOUT'
     OR source_reconciliation."claimSourceGeneration" IS NULL
     OR source_reconciliation.action NOT IN (
       'RETRY_EXISTING_SCOPE',
       'CONFIRMED_PROVIDER_EFFECT'
     ) THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation authority is invalid'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT actor.*
    INTO source_actor
    FROM public."User" AS actor
   WHERE actor.id = source_reconciliation."actorUserId"
   FOR SHARE;
  IF NOT FOUND
     OR source_actor.role <> 'ADMIN'::public."Role"
     OR source_actor.banned
     OR source_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation requires a current ADMIN'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT source_event.*
    INTO locked_event
    FROM public."StripeWebhookEvent" AS source_event
   WHERE source_event.id = source_reconciliation."claimSourceId"
   FOR UPDATE;
  IF NOT FOUND
     OR locked_event.type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR locked_event."claimGeneration"
          < source_reconciliation."claimSourceGeneration"
     OR (
       locked_event."processingStartedAt" IS NOT NULL
       AND locked_event."processedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Blocked-checkout reconciliation source event is not recoverable'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF locked_event."claimGeneration"
       > source_reconciliation."claimSourceGeneration" THEN
    SELECT EXISTS (
      SELECT 1
        FROM public."OrderPaymentEvent" AS payment_event
       WHERE payment_event."stripeEventId"
             = 'local:blocked_checkout_refund_recorded:' || p_refund_id
    )
      INTO already_recorded;
  END IF;

  IF locked_event."claimGeneration"
       > source_reconciliation."claimSourceGeneration"
     AND NOT COALESCE(already_recorded, false) THEN
    UPDATE public."Order" AS orders
       SET "refundClaimSourceGeneration" = locked_event."claimGeneration"
     WHERE orders."refundClaimId" = p_claim_id
       AND orders."refundClaimGeneration" = p_claim_generation
       AND orders."refundClaimSource" = 'BLOCKED_CHECKOUT'
       AND orders."refundClaimSourceId" = locked_event.id
       AND orders."refundClaimSourceGeneration"
             = source_reconciliation."claimSourceGeneration"
       AND orders."refundClaimIdempotencyScope"
             = source_reconciliation."idempotencyScope"
       AND orders."refundClaimProviderAuthorizedAt" IS NOT NULL
       AND orders."stripeSessionId" = locked_event."sourceObjectId"
       AND orders."sellerRefundId" = 'pending'
       AND orders."blockedCheckoutRefundRequiredAt" IS NOT NULL
       AND orders."blockedCheckoutRefundRecordedAt" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Blocked-checkout reconciliation generation inheritance raced'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;

  record_result := public.grainline_blocked_checkout_refund_record_core(
    locked_event.id,
    locked_event."claimGeneration",
    p_claim_id,
    p_claim_generation,
    p_refund_id,
    p_refund_status,
    p_transfer_reversal_id,
    p_transfer_reversal_amount_cents
  );

  IF locked_event."processedAt" IS NULL THEN
    UPDATE public."StripeWebhookEvent" AS source_event
       SET "processedAt" = source_now,
           "processingStartedAt" = NULL,
           "lastError" = NULL,
           "updatedAt" = source_now
     WHERE source_event.id = locked_event.id
       AND source_event."claimGeneration" = locked_event."claimGeneration"
       AND source_event."processedAt" IS NULL
       AND source_event."processingStartedAt" IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Blocked-checkout reconciliation completion raced'
        USING ERRCODE = 'serialization_failure';
    END IF;
  END IF;

  RETURN record_result;
END
$grainline_blocked_checkout_refund_reconciliation_record$;

REVOKE ALL ON FUNCTION public.grainline_stripe_checkout_order_existing(
  text, bigint, text
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_stripe_checkout_order_existing(
  text, bigint, text
) TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
  text, text, bigint, text, text, text, integer
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
  text, text, bigint, text, text, text, integer
) TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_blocked_checkout_refund_reconciliation_record(
  text, text, bigint, text, text, text, integer
) IS 'Records an ADMIN-verified blocked-checkout refund after a failed, processed, or later-generation checkout event without creating another provider refund.';

DO $grainline_blocked_checkout_refund_recovery_postflight$
DECLARE
  order_owner oid;
  runtime_role oid;
  accepted_functions integer;
BEGIN
  SELECT table_row.relowner
    INTO order_owner
    FROM pg_catalog.pg_class AS table_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = table_row.relnamespace
   WHERE namespace.nspname = 'public'
     AND table_row.relname = 'Order'
     AND table_row.relkind = 'r';
  SELECT role_row.oid
    INTO runtime_role
    FROM pg_catalog.pg_roles AS role_row
   WHERE role_row.rolname = 'grainline_app_runtime';
  IF order_owner IS NULL OR runtime_role IS NULL THEN
    RAISE EXCEPTION 'Blocked-checkout refund recovery roles or Order table are missing';
  END IF;

  WITH expected(function_identity, source_md5) AS (
    VALUES
      (
        'public.grainline_stripe_checkout_order_existing(text,bigint,text)',
        'c11a02db980fdda7a9d57bf67f5d8628'
      ),
      (
        'public.grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)',
        '68d493ab39967224cb2958e36e243c71'
      )
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_functions
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE namespace.nspname = 'public'
     AND language.lanname = 'plpgsql'
     AND procedure.prokind = 'f'
     AND procedure.proowner = order_owner
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = 'v'
     AND procedure.proparallel = 'u'
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') = 0
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee <> procedure.proowner
     ) = 1
     AND (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee = runtime_role
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
     ) = 1;
  IF accepted_functions <> 2 THEN
    RAISE EXCEPTION
      'Blocked-checkout refund recovery postflight catalog drifted: accepted=%',
      accepted_functions;
  END IF;
END
$grainline_blocked_checkout_refund_recovery_postflight$;

COMMIT;
