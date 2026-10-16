-- Audit #648 historical refund inventory summary.
-- READ ONLY. The result contains aggregate counts and cents only; it does not
-- emit Order, user, seller, claim, reconciliation, or Stripe object ids.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- @query claim-summary
WITH claim AS (
  SELECT
    orders.id AS order_id,
    orders."refundClaimId" AS claim_id,
    orders."refundClaimGeneration" AS claim_generation,
    orders."refundClaimSource" AS claim_source,
    orders."refundClaimSourceId" AS claim_source_id,
    orders."refundClaimSourceGeneration" AS claim_source_generation,
    orders."refundClaimProviderAuthorizedAt" AS provider_authorized_at,
    orders."sellerRefundId" AS refund_sentinel,
    orders."itemsSubtotalCents" + orders."shippingAmountCents"
      + COALESCE(orders."giftWrappingPriceCents", 0)
      + orders."taxAmountCents" AS claim_amount_cents
  FROM public."Order" AS orders
  WHERE orders."refundClaimId" IS NOT NULL
), facts AS (
  SELECT
    claim.*,
    COALESCE(provider_ledger.rows, 0) AS provider_refund_ledger_rows,
    COALESCE(provider_ledger.total_refunded_cents, 0)
      AS provider_total_refunded_cents,
    COALESCE(provider_ledger.total_refunded_cents, 0)
      >= claim.claim_amount_cents AS stripe_refund_confirmed_by_ledger,
    COALESCE(local_record.rows, 0) AS local_record_rows,
    source_event.id IS NOT NULL AS source_event_found,
    source_event."claimGeneration" AS source_event_generation,
    COALESCE(
      source_event."processingStartedAt" IS NOT NULL
        AND source_event."processedAt" IS NULL,
      false
    ) AS source_event_in_progress,
    COALESCE(source_event."processedAt" IS NOT NULL, false)
      AS source_event_processed,
    COALESCE(
      source_event."lastError" ILIKE '%payment evidence is immutable%',
      false
    ) AS source_event_failed_with_648
  FROM claim
  LEFT JOIN LATERAL (
    SELECT
      pg_catalog.count(*)::integer AS rows,
      pg_catalog.max(
        GREATEST(
          COALESCE(payment_event."amountCents", 0)::bigint,
          CASE
            WHEN pg_catalog.jsonb_typeof(
                   payment_event.metadata->'totalRefundedCents'
                 ) = 'number'
              THEN (payment_event.metadata->>'totalRefundedCents')::bigint
            ELSE 0::bigint
          END
        )
      ) AS total_refunded_cents
    FROM public."OrderPaymentEvent" AS payment_event
    WHERE payment_event."orderId" = claim.order_id
      AND payment_event."eventType" = 'REFUND'
      AND payment_event."stripeEventId" ~ '^evt_'
      AND pg_catalog.lower(COALESCE(payment_event.status, ''))
            NOT IN ('failed', 'canceled', 'cancelled')
      AND payment_event."createdAt"
            >= claim.provider_authorized_at - INTERVAL '5 minutes'
  ) AS provider_ledger ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.count(*)::integer AS rows
    FROM public."OrderPaymentEvent" AS payment_event
    WHERE payment_event."orderId" = claim.order_id
      AND payment_event.metadata->>'refundClaimId' = claim.claim_id
  ) AS local_record ON true
  LEFT JOIN public."StripeWebhookEvent" AS source_event
    ON claim.claim_source = 'BLOCKED_CHECKOUT'
   AND source_event.id = claim.claim_source_id
), classified AS (
  SELECT
    facts.*,
    CASE facts.refund_sentinel
      WHEN 'pending' THEN 'PENDING'
      WHEN 'ambiguous_refund_pending_reconciliation' THEN 'AMBIGUOUS'
      ELSE 'UNEXPECTED'
    END AS claim_state,
    CASE
      WHEN facts.provider_authorized_at IS NULL THEN 'NO_PROVIDER_CLOCK'
      WHEN facts.provider_authorized_at
             > (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
        THEN 'FUTURE_PROVIDER_CLOCK'
      WHEN (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
             - facts.provider_authorized_at < INTERVAL '23 hours'
        THEN 'LT_23H'
      WHEN (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
             - facts.provider_authorized_at < INTERVAL '25 hours'
        THEN '23H_TO_25H'
      ELSE 'GE_25H'
    END AS provider_window,
    COALESCE(
      facts.provider_authorized_at >= TIMESTAMP '2026-08-29 00:00:00',
      false
    ) AS inside_648_window,
    CASE
      WHEN facts.local_record_rows > 0
        THEN 'C_STOP_LOCAL_RECORD_ALREADY_PRESENT'
      WHEN facts.refund_sentinel NOT IN (
        'pending',
        'ambiguous_refund_pending_reconciliation'
      )
        THEN 'C_STOP_UNEXPECTED_SENTINEL'
      WHEN facts.claim_source NOT IN ('SELLER', 'BLOCKED_CHECKOUT')
        THEN 'C_STOP_UNEXPECTED_SOURCE'
      WHEN facts.claim_source = 'BLOCKED_CHECKOUT'
           AND NOT facts.source_event_found
        THEN 'C_STOP_SOURCE_EVENT_MISSING'
      WHEN facts.claim_source = 'BLOCKED_CHECKOUT'
           AND facts.source_event_in_progress
        THEN 'C_WAIT_SOURCE_EVENT_IN_PROGRESS'
      WHEN facts.claim_source = 'BLOCKED_CHECKOUT'
           AND facts.source_event_generation
                 IS DISTINCT FROM facts.claim_source_generation
        THEN 'C_ENGINEERING_SOURCE_EVENT_GENERATION_AHEAD'
      WHEN facts.claim_source = 'BLOCKED_CHECKOUT'
           AND facts.source_event_processed
        THEN 'C_ENGINEERING_SOURCE_EVENT_PROCESSED'
      WHEN NOT facts.stripe_refund_confirmed_by_ledger
        THEN 'B_NOT_PROVEN_648_STRIPE_INSPECTION_DECIDES'
      ELSE 'A_RECORD_EXISTING_STRIPE_REFUND'
    END AS repair_class
  FROM facts
)
SELECT
  classified.repair_class,
  classified.claim_source,
  classified.claim_state,
  classified.provider_window,
  classified.inside_648_window,
  classified.source_event_failed_with_648,
  pg_catalog.count(*)::integer AS orders,
  COALESCE(pg_catalog.sum(classified.claim_amount_cents), 0)::bigint
    AS claim_cents,
  COALESCE(
    pg_catalog.sum(classified.provider_total_refunded_cents),
    0
  )::bigint AS provider_refunded_cents,
  COALESCE(
    pg_catalog.sum(classified.provider_refund_ledger_rows),
    0
  )::bigint AS provider_ledger_rows
FROM classified
GROUP BY
  classified.repair_class,
  classified.claim_source,
  classified.claim_state,
  classified.provider_window,
  classified.inside_648_window,
  classified.source_event_failed_with_648
ORDER BY 1, 2, 3, 4, 5, 6;

-- @query lost-claim-summary
WITH provider_refund AS (
  SELECT
    payment_event."orderId" AS order_id,
    pg_catalog.max(
      GREATEST(
        COALESCE(payment_event."amountCents", 0)::bigint,
        CASE
          WHEN pg_catalog.jsonb_typeof(
                 payment_event.metadata->'totalRefundedCents'
               ) = 'number'
            THEN (payment_event.metadata->>'totalRefundedCents')::bigint
          ELSE 0::bigint
        END
      )
    ) AS total_refunded_cents
  FROM public."OrderPaymentEvent" AS payment_event
  WHERE payment_event."eventType" = 'REFUND'
    AND payment_event."stripeEventId" ~ '^evt_'
    AND payment_event.metadata->>'pendingLocalRefundLock' = 'true'
    AND pg_catalog.lower(COALESCE(payment_event.status, ''))
          NOT IN ('failed', 'canceled', 'cancelled')
  GROUP BY payment_event."orderId"
), lost_claim AS (
  SELECT
    orders.id,
    orders."sellerRefundId" IS NULL AS refund_sentinel_cleared,
    orders."caseResolutionClaimId" IS NOT NULL
      AS staff_case_refund_claim_in_flight,
    provider_refund.total_refunded_cents
  FROM provider_refund
  JOIN public."Order" AS orders ON orders.id = provider_refund.order_id
  WHERE orders."refundClaimId" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public."OrderPaymentEvent" AS local_record
      WHERE local_record."orderId" = orders.id
        AND local_record."stripeEventId" ~
              '^local:(seller_refund|blocked_checkout_refund|case_refund)_recorded:'
    )
)
SELECT
  lost_claim.refund_sentinel_cleared,
  lost_claim.staff_case_refund_claim_in_flight,
  pg_catalog.count(*)::integer AS orders,
  COALESCE(pg_catalog.sum(lost_claim.total_refunded_cents), 0)::bigint
    AS provider_refunded_cents
FROM lost_claim
GROUP BY
  lost_claim.refund_sentinel_cleared,
  lost_claim.staff_case_refund_claim_in_flight
ORDER BY 1, 2;

ROLLBACK;
