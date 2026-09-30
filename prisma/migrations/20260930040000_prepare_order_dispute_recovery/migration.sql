-- Durable Stripe-dispute seller-transfer recovery. The signed dispute writer
-- records immutable payment evidence first; this migration adds a private,
-- generation-fenced provider claim that can reverse the seller transfer and
-- restore only the amount Grainline actually recovered when Stripe reinstates
-- the disputed funds.

DO $grainline_order_dispute_recovery_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."OrderDisputeRecovery"') IS NOT NULL
     OR pg_catalog.to_regtype('public."OrderDisputeRecoveryStatus"') IS NOT NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_order_dispute_recovery_event_claim(text)'
        ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_order_dispute_recovery_finalize(text,bigint,text,text,integer,text,text)'
        ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_order_dispute_recovery_claim_batch(integer)'
        ) IS NOT NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_order_dispute_recovery_health_summary()'
        ) IS NOT NULL THEN
    RAISE EXCEPTION 'Order dispute recovery is not at the clean predecessor';
  END IF;
END
$grainline_order_dispute_recovery_preflight$;

CREATE TYPE public."OrderDisputeRecoveryStatus" AS ENUM (
  'REVERSAL_PENDING',
  'REVERSING',
  'REVERSED',
  'RESTORE_PENDING',
  'RESTORING',
  'RESTORED',
  'NO_REVERSAL_REQUIRED',
  'MANUAL_REVIEW'
);

CREATE TABLE public."OrderDisputeRecovery" (
  id text PRIMARY KEY,
  "orderId" text NOT NULL,
  "stripeDisputeId" varchar(255) NOT NULL,
  "stripeTransferId" varchar(255),
  "disputedAmountCents" integer NOT NULL,
  currency varchar(3) NOT NULL,
  status public."OrderDisputeRecoveryStatus" NOT NULL,
  "claimGeneration" bigint NOT NULL DEFAULT 0,
  "attemptCount" integer NOT NULL DEFAULT 0,
  "reversalId" varchar(255),
  "reversedAmountCents" integer,
  "sellerStripeAccountId" varchar(255),
  "restoreTransferId" varchar(255),
  "sourcePaymentEventId" text NOT NULL,
  "latestPaymentEventId" text NOT NULL,
  "lastStripeEventCreatedSeconds" bigint NOT NULL,
  "lastAttemptAt" timestamp(3),
  "nextAttemptAt" timestamp(3),
  "resolvedAt" timestamp(3),
  "errorSummary" varchar(500),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderDisputeRecovery_order_fkey"
    FOREIGN KEY ("orderId") REFERENCES public."Order"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderDisputeRecovery_source_event_order_fkey"
    FOREIGN KEY ("sourcePaymentEventId", "orderId")
    REFERENCES public."OrderPaymentEvent"(id, "orderId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderDisputeRecovery_latest_event_order_fkey"
    FOREIGN KEY ("latestPaymentEventId", "orderId")
    REFERENCES public."OrderPaymentEvent"(id, "orderId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderDisputeRecovery_dispute_id_check"
    CHECK ("stripeDisputeId" ~ '^du_[A-Za-z0-9]+$'),
  CONSTRAINT "OrderDisputeRecovery_transfer_id_check"
    CHECK ("stripeTransferId" IS NULL OR "stripeTransferId" ~ '^tr_[A-Za-z0-9]+$'),
  CONSTRAINT "OrderDisputeRecovery_money_check"
    CHECK (
      "disputedAmountCents" > 0
      AND currency ~ '^[a-z]{3}$'
      AND "claimGeneration" >= 0
      AND "attemptCount" >= 0
      AND ("reversedAmountCents" IS NULL OR "reversedAmountCents" > 0)
    ),
  CONSTRAINT "OrderDisputeRecovery_provider_identity_check"
    CHECK (
      ("reversalId" IS NULL AND "reversedAmountCents" IS NULL
        AND "sellerStripeAccountId" IS NULL)
      OR
      ("reversalId" ~ '^trr_[A-Za-z0-9]+$'
        AND "reversedAmountCents" > 0
        AND "sellerStripeAccountId" ~ '^acct_[A-Za-z0-9]+$')
    ),
  CONSTRAINT "OrderDisputeRecovery_restore_id_check"
    CHECK ("restoreTransferId" IS NULL OR "restoreTransferId" ~ '^tr_[A-Za-z0-9]+$'),
  CONSTRAINT "OrderDisputeRecovery_state_check"
    CHECK (
      (status IN ('REVERSAL_PENDING', 'REVERSING', 'NO_REVERSAL_REQUIRED', 'MANUAL_REVIEW')
        AND "restoreTransferId" IS NULL)
      OR
      (status IN ('REVERSED', 'RESTORE_PENDING', 'RESTORING')
        AND "reversalId" IS NOT NULL AND "restoreTransferId" IS NULL)
      OR
      (status = 'RESTORED'
        AND "reversalId" IS NOT NULL AND "restoreTransferId" IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX "OrderDisputeRecovery_stripeDisputeId_key"
  ON public."OrderDisputeRecovery"("stripeDisputeId");
CREATE UNIQUE INDEX "OrderDisputeRecovery_reversalId_key"
  ON public."OrderDisputeRecovery"("reversalId") WHERE "reversalId" IS NOT NULL;
CREATE UNIQUE INDEX "OrderDisputeRecovery_restoreTransferId_key"
  ON public."OrderDisputeRecovery"("restoreTransferId") WHERE "restoreTransferId" IS NOT NULL;
CREATE UNIQUE INDEX "OrderDisputeRecovery_sourcePaymentEventId_key"
  ON public."OrderDisputeRecovery"("sourcePaymentEventId");
CREATE UNIQUE INDEX "OrderDisputeRecovery_latestPaymentEventId_key"
  ON public."OrderDisputeRecovery"("latestPaymentEventId");
CREATE INDEX "OrderDisputeRecovery_orderId_createdAt_idx"
  ON public."OrderDisputeRecovery"("orderId", "createdAt");
CREATE INDEX "OrderDisputeRecovery_status_nextAttemptAt_createdAt_idx"
  ON public."OrderDisputeRecovery"(status, "nextAttemptAt", "createdAt");

ALTER TABLE public."OrderDisputeRecovery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderDisputeRecovery" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."OrderDisputeRecovery" FROM PUBLIC, grainline_app_runtime;

CREATE FUNCTION public.grainline_order_dispute_recovery_event_claim(
  p_payment_event_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_dispute_recovery_event_claim$
DECLARE
  source_event public."OrderPaymentEvent"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  recovery public."OrderDisputeRecovery"%ROWTYPE;
  event_type text;
  event_status text;
  ordering_action text;
  wants_reversal boolean;
  wants_restore boolean;
  next_status public."OrderDisputeRecoveryStatus";
  now_utc timestamp(3) without time zone;
BEGIN
  IF p_payment_event_id IS NULL
     OR p_payment_event_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Order dispute recovery event input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT payment.* INTO source_event
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment.id = p_payment_event_id;
  IF NOT FOUND
     OR source_event."eventType" <> 'DISPUTE'
     OR source_event."stripeObjectType" IS DISTINCT FROM 'dispute'
     OR source_event."stripeObjectId" IS NULL
     OR source_event."stripeObjectId" !~ '^du_[A-Za-z0-9]+$'
     OR source_event."amountCents" IS NULL
     OR source_event."amountCents" <= 0
     OR source_event.currency !~ '^[a-z]{3}$'
     OR source_event."stripeEventCreatedSeconds" IS NULL
     OR pg_catalog.jsonb_typeof(source_event.metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Order dispute recovery event source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  event_type := source_event.metadata->>'stripeEventType';
  ordering_action := source_event.metadata->>'orderingAction';
  event_status := pg_catalog.lower(COALESCE(source_event.status, ''));
  IF event_type NOT IN (
       'charge.dispute.created',
       'charge.dispute.updated',
       'charge.dispute.closed',
       'charge.dispute.funds_withdrawn',
       'charge.dispute.funds_reinstated'
     )
     OR ordering_action NOT IN (
       'applied', 'stale_recorded', 'same_second_recorded', 'conflict_recorded'
     ) THEN
    RAISE EXCEPTION 'Order dispute recovery event metadata is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  IF ordering_action <> 'applied' THEN
    RETURN NULL;
  END IF;

  SELECT source_order.* INTO locked_order
    FROM public."Order" AS source_order
   WHERE source_order.id = source_event."orderId"
   FOR UPDATE OF source_order;
  IF NOT FOUND
     OR locked_order."stripeChargeId" IS NULL
     OR locked_order.currency IS DISTINCT FROM source_event.currency THEN
    RAISE EXCEPTION 'Order dispute recovery Order source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(source_event."stripeObjectId", 1080300400)
  );
  now_utc := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  wants_restore := event_type = 'charge.dispute.funds_reinstated'
    OR event_status = 'won';
  wants_reversal := NOT wants_restore AND (
    event_type = 'charge.dispute.funds_withdrawn'
    OR event_status IN ('needs_response', 'under_review', 'lost')
  );

  SELECT candidate.* INTO recovery
    FROM public."OrderDisputeRecovery" AS candidate
   WHERE candidate."stripeDisputeId" = source_event."stripeObjectId"
   FOR UPDATE OF candidate;

  IF NOT FOUND THEN
    next_status := CASE
      WHEN locked_order."stripeTransferId" IS NULL THEN 'MANUAL_REVIEW'
      WHEN wants_restore THEN 'NO_REVERSAL_REQUIRED'
      WHEN wants_reversal THEN 'REVERSAL_PENDING'
      ELSE 'NO_REVERSAL_REQUIRED'
    END;
    INSERT INTO public."OrderDisputeRecovery" (
      id, "orderId", "stripeDisputeId", "stripeTransferId",
      "disputedAmountCents", currency, status,
      "sourcePaymentEventId", "latestPaymentEventId",
      "lastStripeEventCreatedSeconds", "nextAttemptAt", "resolvedAt",
      "errorSummary", "createdAt", "updatedAt"
    ) VALUES (
      'order-dispute-recovery:' || pg_catalog.gen_random_uuid()::text,
      locked_order.id,
      source_event."stripeObjectId",
      locked_order."stripeTransferId",
      source_event."amountCents",
      source_event.currency,
      next_status,
      source_event.id,
      source_event.id,
      source_event."stripeEventCreatedSeconds",
      CASE WHEN next_status = 'REVERSAL_PENDING' THEN now_utc ELSE NULL END,
      CASE WHEN next_status = 'NO_REVERSAL_REQUIRED' THEN now_utc ELSE NULL END,
      CASE WHEN locked_order."stripeTransferId" IS NULL
        THEN 'Order has no recorded Stripe seller transfer; staff must reconcile the dispute manually.'
        ELSE NULL END,
      now_utc,
      now_utc
    )
    RETURNING * INTO recovery;
  ELSE
    IF recovery."orderId" IS DISTINCT FROM locked_order.id
       OR recovery."disputedAmountCents" IS DISTINCT FROM source_event."amountCents"
       OR recovery.currency IS DISTINCT FROM source_event.currency THEN
      UPDATE public."OrderDisputeRecovery"
         SET status = 'MANUAL_REVIEW',
             "nextAttemptAt" = NULL,
             "resolvedAt" = NULL,
             "errorSummary" =
               'Stripe dispute identity or amount changed; staff must reconcile provider state.',
             "latestPaymentEventId" = source_event.id,
             "lastStripeEventCreatedSeconds" = source_event."stripeEventCreatedSeconds",
             "updatedAt" = now_utc
       WHERE id = recovery.id;
      RETURN NULL;
    END IF;

    IF source_event."stripeEventCreatedSeconds" < recovery."lastStripeEventCreatedSeconds" THEN
      RETURN NULL;
    END IF;

    next_status := recovery.status;
    IF locked_order."stripeTransferId" IS NULL THEN
      next_status := 'MANUAL_REVIEW';
    ELSIF wants_restore THEN
      next_status := CASE
        WHEN recovery.status = 'REVERSED' THEN 'RESTORE_PENDING'
        WHEN recovery.status = 'REVERSAL_PENDING' THEN 'NO_REVERSAL_REQUIRED'
        ELSE recovery.status
      END;
    ELSIF wants_reversal THEN
      next_status := CASE
        WHEN recovery.status = 'NO_REVERSAL_REQUIRED' THEN 'REVERSAL_PENDING'
        WHEN recovery.status = 'RESTORE_PENDING' THEN 'REVERSED'
        WHEN recovery.status = 'RESTORED' THEN 'MANUAL_REVIEW'
        ELSE recovery.status
      END;
    END IF;

    UPDATE public."OrderDisputeRecovery"
       SET "stripeTransferId" = COALESCE("stripeTransferId", locked_order."stripeTransferId"),
           status = next_status,
           "latestPaymentEventId" = source_event.id,
           "lastStripeEventCreatedSeconds" = source_event."stripeEventCreatedSeconds",
           "nextAttemptAt" = CASE
             WHEN next_status IN ('REVERSAL_PENDING', 'RESTORE_PENDING') THEN now_utc
             WHEN next_status IN ('REVERSING', 'RESTORING') THEN "nextAttemptAt"
             ELSE NULL
           END,
           "resolvedAt" = CASE
             WHEN next_status IN ('RESTORED', 'NO_REVERSAL_REQUIRED') THEN now_utc
             ELSE NULL
           END,
           "errorSummary" = CASE
             WHEN next_status = 'MANUAL_REVIEW' THEN COALESCE(
               "errorSummary",
               'Stripe dispute changed after restored seller funds; staff must reconcile provider state.'
             )
             ELSE "errorSummary"
           END,
           "updatedAt" = now_utc
     WHERE id = recovery.id
     RETURNING * INTO recovery;
  END IF;

  IF recovery.status NOT IN ('REVERSAL_PENDING', 'RESTORE_PENDING') THEN
    IF recovery.status = 'MANUAL_REVIEW' THEN
      UPDATE public."Order"
         SET "reviewNeeded" = true,
             "reviewNote" = pg_catalog.left(
               COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
               COALESCE(recovery."errorSummary", 'Stripe dispute recovery requires manual review.'),
               10000
             )
       WHERE id = recovery."orderId";
    END IF;
    RETURN NULL;
  END IF;

  UPDATE public."OrderDisputeRecovery"
     SET status = CASE
           WHEN recovery.status = 'REVERSAL_PENDING' THEN 'REVERSING'
           ELSE 'RESTORING'
         END,
         "claimGeneration" = "claimGeneration" + 1,
         "attemptCount" = "attemptCount" + 1,
         "lastAttemptAt" = now_utc,
         "nextAttemptAt" = NULL,
         "updatedAt" = now_utc
   WHERE id = recovery.id
  RETURNING * INTO recovery;

  RETURN pg_catalog.jsonb_build_object(
    'recoveryId', recovery.id,
    'orderId', recovery."orderId",
    'disputeId', recovery."stripeDisputeId",
    'action', CASE WHEN recovery.status = 'REVERSING' THEN 'REVERSE' ELSE 'RESTORE' END,
    'claimGeneration', recovery."claimGeneration",
    'attemptCount', recovery."attemptCount",
    'stripeTransferId', recovery."stripeTransferId",
    'amountCents', recovery."disputedAmountCents",
    'currency', recovery.currency,
    'reversalId', recovery."reversalId",
    'reversedAmountCents', recovery."reversedAmountCents",
    'sellerStripeAccountId', recovery."sellerStripeAccountId"
  );
END
$grainline_order_dispute_recovery_event_claim$;

CREATE FUNCTION public.grainline_order_dispute_recovery_finalize(
  p_recovery_id text,
  p_claim_generation bigint,
  p_outcome text,
  p_provider_object_id text,
  p_amount_cents integer,
  p_seller_account_id text,
  p_error_summary text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_dispute_recovery_finalize$
DECLARE
  recovery public."OrderDisputeRecovery"%ROWTYPE;
  latest_event public."OrderPaymentEvent"%ROWTYPE;
  now_utc timestamp(3) without time zone;
  next_status public."OrderDisputeRecoveryStatus";
  next_attempt timestamp(3) without time zone;
  bounded_error text;
  wants_reversal boolean;
  wants_restore boolean;
  action_name text;
BEGIN
  IF p_recovery_id IS NULL
     OR p_recovery_id !~ '^order-dispute-recovery:[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_outcome NOT IN ('SUCCESS', 'NOOP', 'FAILED')
     OR (p_provider_object_id IS NOT NULL
       AND p_provider_object_id !~ '^(trr|tr)_[A-Za-z0-9]+$')
     OR (p_amount_cents IS NOT NULL AND p_amount_cents <= 0)
     OR (p_seller_account_id IS NOT NULL
       AND p_seller_account_id !~ '^acct_[A-Za-z0-9]+$')
     OR (p_error_summary IS NOT NULL
       AND pg_catalog.char_length(p_error_summary) > 500) THEN
    RAISE EXCEPTION 'Order dispute recovery result input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT candidate.* INTO recovery
    FROM public."OrderDisputeRecovery" AS candidate
   WHERE candidate.id = p_recovery_id
   FOR UPDATE OF candidate;
  IF NOT FOUND
     OR recovery."claimGeneration" <> p_claim_generation
     OR recovery.status NOT IN ('REVERSING', 'RESTORING') THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'stale_claim');
  END IF;
  action_name := CASE WHEN recovery.status = 'REVERSING' THEN 'REVERSE' ELSE 'RESTORE' END;
  now_utc := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';

  SELECT payment.* INTO latest_event
    FROM public."OrderPaymentEvent" AS payment
   WHERE payment.id = recovery."latestPaymentEventId"
     AND payment."orderId" = recovery."orderId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order dispute recovery latest event is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  wants_restore := latest_event.metadata->>'stripeEventType' =
      'charge.dispute.funds_reinstated'
    OR pg_catalog.lower(COALESCE(latest_event.status, '')) = 'won';
  wants_reversal := NOT wants_restore AND (
    latest_event.metadata->>'stripeEventType' = 'charge.dispute.funds_withdrawn'
    OR pg_catalog.lower(COALESCE(latest_event.status, '')) IN
      ('needs_response', 'under_review', 'lost')
  );

  IF p_outcome = 'FAILED' THEN
    bounded_error := pg_catalog.left(
      pg_catalog.regexp_replace(
        COALESCE(p_error_summary, 'Unknown Stripe dispute recovery error'),
        '[[:space:]]+', ' ', 'g'
      ),
      500
    );
    IF recovery."attemptCount" >= 5 THEN
      next_status := 'MANUAL_REVIEW';
      next_attempt := NULL;
    ELSE
      next_status := CASE WHEN recovery.status = 'REVERSING'
        THEN 'REVERSAL_PENDING' ELSE 'RESTORE_PENDING' END;
      next_attempt := now_utc + CASE recovery."attemptCount"
        WHEN 1 THEN interval '15 minutes'
        WHEN 2 THEN interval '1 hour'
        WHEN 3 THEN interval '6 hours'
        ELSE interval '24 hours'
      END;
    END IF;
    UPDATE public."OrderDisputeRecovery"
       SET status = next_status,
           "lastAttemptAt" = now_utc,
           "nextAttemptAt" = next_attempt,
           "resolvedAt" = NULL,
           "errorSummary" = bounded_error,
           "updatedAt" = now_utc
     WHERE id = recovery.id;
    IF next_status = 'MANUAL_REVIEW' THEN
      UPDATE public."Order"
         SET "reviewNeeded" = true,
             "reviewNote" = pg_catalog.left(
               COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
               'Stripe dispute ' || recovery."stripeDisputeId" ||
               ' seller-funds recovery failed after five attempts. Staff must reconcile Stripe. Error: ' ||
               bounded_error,
               10000
             )
       WHERE id = recovery."orderId";
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'recorded_failure', 'recoveryId', recovery.id,
      'status', next_status, 'nextAttemptAt', next_attempt
    );
  END IF;

  IF recovery.status = 'REVERSING' THEN
    IF p_outcome = 'NOOP' THEN
      IF p_provider_object_id IS NOT NULL OR p_amount_cents IS NOT NULL
         OR p_seller_account_id IS NOT NULL THEN
        RAISE EXCEPTION 'Order dispute recovery no-effect evidence is invalid'
          USING ERRCODE = '22023';
      END IF;
      UPDATE public."OrderDisputeRecovery"
         SET status = 'NO_REVERSAL_REQUIRED',
             "lastAttemptAt" = now_utc,
             "nextAttemptAt" = NULL,
             "resolvedAt" = now_utc,
             "errorSummary" = NULL,
             "updatedAt" = now_utc
       WHERE id = recovery.id;
      next_status := 'NO_REVERSAL_REQUIRED';
    ELSE
      IF p_provider_object_id IS NULL OR p_provider_object_id !~ '^trr_[A-Za-z0-9]+$'
         OR p_amount_cents IS NULL OR p_amount_cents > recovery."disputedAmountCents"
         OR p_seller_account_id IS NULL THEN
        RAISE EXCEPTION 'Order dispute reversal evidence is invalid'
          USING ERRCODE = '22023';
      END IF;
      next_status := CASE WHEN wants_restore THEN 'RESTORE_PENDING' ELSE 'REVERSED' END;
      UPDATE public."OrderDisputeRecovery"
         SET status = next_status,
             "reversalId" = p_provider_object_id,
             "reversedAmountCents" = p_amount_cents,
             "sellerStripeAccountId" = p_seller_account_id,
             "lastAttemptAt" = now_utc,
             "nextAttemptAt" = CASE WHEN wants_restore THEN now_utc ELSE NULL END,
             "resolvedAt" = NULL,
             "errorSummary" = NULL,
             "updatedAt" = now_utc
       WHERE id = recovery.id;
    END IF;
  ELSE
    IF p_outcome <> 'SUCCESS'
       OR p_provider_object_id IS NULL
       OR p_provider_object_id !~ '^tr_[A-Za-z0-9]+$'
       OR p_amount_cents IS DISTINCT FROM recovery."reversedAmountCents"
       OR p_seller_account_id IS DISTINCT FROM recovery."sellerStripeAccountId" THEN
      RAISE EXCEPTION 'Order dispute restoration evidence is invalid'
        USING ERRCODE = '22023';
    END IF;
    next_status := CASE WHEN wants_reversal THEN 'MANUAL_REVIEW' ELSE 'RESTORED' END;
    UPDATE public."OrderDisputeRecovery"
       SET status = next_status,
           "restoreTransferId" = p_provider_object_id,
           "lastAttemptAt" = now_utc,
           "nextAttemptAt" = NULL,
           "resolvedAt" = CASE WHEN next_status = 'RESTORED' THEN now_utc ELSE NULL END,
           "errorSummary" = CASE WHEN next_status = 'MANUAL_REVIEW'
             THEN 'Stripe withdrew dispute funds again while the seller restoration was in flight; staff must reconcile provider state.'
             ELSE NULL END,
           "updatedAt" = now_utc
     WHERE id = recovery.id;
    IF next_status = 'MANUAL_REVIEW' THEN
      UPDATE public."Order"
         SET "reviewNeeded" = true,
             "reviewNote" = pg_catalog.left(
               COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
               'Stripe dispute funds changed while seller restoration was in flight; staff must reconcile provider state.',
               10000
             )
       WHERE id = recovery."orderId";
    END IF;
  END IF;

  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId",
    reason, metadata, "createdAt"
  ) VALUES (
    'order-dispute-recovery-audit:' || pg_catalog.gen_random_uuid()::text,
    'system', recovery."stripeDisputeId", 'ORDER_DISPUTE_RECOVERY_PROVIDER_RECORDED',
    'ORDER', recovery."orderId", NULL,
    pg_catalog.jsonb_build_object(
      'recoveryId', recovery.id, 'action', action_name,
      'providerObjectId', p_provider_object_id,
      'amountCents', p_amount_cents, 'status', next_status
    ),
    now_utc
  );

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'finalized', 'recoveryId', recovery.id, 'status', next_status
  );
END
$grainline_order_dispute_recovery_finalize$;

CREATE FUNCTION public.grainline_order_dispute_recovery_claim_batch(
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_dispute_recovery_claim_batch$
DECLARE
  claimed jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Order dispute recovery batch input is invalid'
      USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT source.id
      FROM public."OrderDisputeRecovery" AS source
     WHERE (
       (source.status IN ('REVERSAL_PENDING', 'RESTORE_PENDING')
         AND source."nextAttemptAt" <=
           (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'))
       OR
       (source.status IN ('REVERSING', 'RESTORING')
         AND source."lastAttemptAt" <=
           (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '30 minutes')
     )
     ORDER BY source."nextAttemptAt" NULLS FIRST, source."createdAt", source.id
     FOR UPDATE OF source SKIP LOCKED
     LIMIT p_limit
  ), updated AS (
    UPDATE public."OrderDisputeRecovery" AS target
       SET status = CASE
             WHEN target.status IN ('REVERSAL_PENDING', 'REVERSING') THEN 'REVERSING'
             ELSE 'RESTORING'
           END,
           "claimGeneration" = target."claimGeneration" + 1,
           "attemptCount" = target."attemptCount" + 1,
           "lastAttemptAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
           "nextAttemptAt" = NULL,
           "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      FROM candidates
     WHERE target.id = candidates.id
    RETURNING target.*
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'recoveryId', updated.id,
    'orderId', updated."orderId",
    'disputeId', updated."stripeDisputeId",
    'action', CASE WHEN updated.status = 'REVERSING' THEN 'REVERSE' ELSE 'RESTORE' END,
    'claimGeneration', updated."claimGeneration",
    'attemptCount', updated."attemptCount",
    'stripeTransferId', updated."stripeTransferId",
    'amountCents', updated."disputedAmountCents",
    'currency', updated.currency,
    'reversalId', updated."reversalId",
    'reversedAmountCents', updated."reversedAmountCents",
    'sellerStripeAccountId', updated."sellerStripeAccountId"
  ) ORDER BY updated."createdAt", updated.id), '[]'::jsonb)
    INTO claimed
    FROM updated;
  RETURN claimed;
END
$grainline_order_dispute_recovery_claim_batch$;

CREATE FUNCTION public.grainline_order_dispute_recovery_health_summary()
RETURNS TABLE (
  manual_review_count bigint,
  overdue_retry_count bigint
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_dispute_recovery_health_summary$
  SELECT
    pg_catalog.count(*) FILTER (WHERE recovery.status = 'MANUAL_REVIEW')::bigint,
    pg_catalog.count(*) FILTER (
      WHERE recovery.status IN ('REVERSAL_PENDING', 'RESTORE_PENDING')
        AND recovery."nextAttemptAt" <
          (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '15 minutes'
    )::bigint
  FROM public."OrderDisputeRecovery" AS recovery;
$grainline_order_dispute_recovery_health_summary$;

REVOKE ALL ON FUNCTION public.grainline_order_dispute_recovery_event_claim(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_dispute_recovery_finalize(
  text, bigint, text, text, integer, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_dispute_recovery_claim_batch(integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_dispute_recovery_health_summary()
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_order_dispute_recovery_event_claim(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_dispute_recovery_finalize(
  text, bigint, text, text, integer, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_dispute_recovery_claim_batch(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_dispute_recovery_health_summary()
  TO grainline_app_runtime;

DO $grainline_order_dispute_recovery_postflight$
DECLARE
  relation_oid oid := pg_catalog.to_regclass('public."OrderDisputeRecovery"');
  function_oid oid;
  expected regprocedure;
BEGIN
  IF relation_oid IS NULL
     OR NOT (SELECT class.relrowsecurity FROM pg_catalog.pg_class AS class
              WHERE class.oid = relation_oid)
     OR NOT (SELECT class.relforcerowsecurity FROM pg_catalog.pg_class AS class
              WHERE class.oid = relation_oid)
     OR pg_catalog.has_table_privilege('grainline_app_runtime', relation_oid, 'SELECT')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', relation_oid, 'INSERT')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', relation_oid, 'UPDATE')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', relation_oid, 'DELETE') THEN
    RAISE EXCEPTION 'Order dispute recovery table posture is invalid';
  END IF;

  FOREACH expected IN ARRAY ARRAY[
    'public.grainline_order_dispute_recovery_event_claim(text)'::pg_catalog.regprocedure,
    'public.grainline_order_dispute_recovery_finalize(text,bigint,text,text,integer,text,text)'::pg_catalog.regprocedure,
    'public.grainline_order_dispute_recovery_claim_batch(integer)'::pg_catalog.regprocedure,
    'public.grainline_order_dispute_recovery_health_summary()'::pg_catalog.regprocedure
  ] LOOP
    function_oid := expected::oid;
    IF NOT (SELECT routine.prosecdef FROM pg_catalog.pg_proc AS routine
             WHERE routine.oid = function_oid)
       OR (SELECT routine.proconfig FROM pg_catalog.pg_proc AS routine
            WHERE routine.oid = function_oid)
            IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
       OR NOT pg_catalog.has_function_privilege(
            'grainline_app_runtime', function_oid, 'EXECUTE'
          ) THEN
      RAISE EXCEPTION 'Order dispute recovery function posture is invalid: %', expected;
    END IF;
  END LOOP;
END
$grainline_order_dispute_recovery_postflight$;
