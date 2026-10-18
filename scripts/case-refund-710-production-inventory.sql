-- Audit #710 historical Case-refund marker inventory.
-- READ ONLY. Results contain aggregate counts and cents only; no Order, Case,
-- user, claim, or Stripe identifiers are emitted.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- @query summary
WITH stuck AS (
  SELECT
    claim.id,
    claim."refundAmountCents" AS refund_amount_cents,
    EXISTS (
      SELECT 1
      FROM public."OrderPaymentEvent" AS refund_event
      WHERE refund_event."orderId" = orders.id
        AND refund_event."eventType" = 'REFUND'
        AND refund_event."stripeObjectType" = 'refund'
        AND refund_event."stripeEventId" ~ '^evt_'
        AND refund_event."stripeObjectId" = orders."sellerRefundId"
        AND refund_event.currency = claim.currency
        AND refund_event.metadata->>'totalRefundedCents' =
              claim."refundAmountCents"::text
        AND refund_event.metadata->>'pendingLocalRefundLock' = 'false'
        AND refund_event.metadata->>'caseResolutionClaimId' IS NULL
        AND refund_event."createdAt" >= claim."createdAt"
        AND (
          refund_event.status IS NULL
          OR pg_catalog.lower(refund_event.status)
               NOT IN ('failed', 'canceled', 'cancelled')
        )
    ) AS repairable
  FROM public."CaseResolutionClaim" AS claim
  JOIN public."Order" AS orders
    ON orders.id = claim."orderId"
   AND orders."caseResolutionClaimId" = claim.id
  WHERE claim.status =
          'RECONCILIATION_REQUIRED'::public."CaseResolutionClaimStatus"
    AND claim."orderPaymentEventId" IS NULL
    AND orders."sellerRefundId" IS NOT NULL
    AND orders."sellerRefundId" NOT IN (
      'pending',
      'ambiguous_refund_pending_reconciliation'
    )
    AND orders."sellerRefundLockedAt" IS NULL
)
SELECT
  pg_catalog.count(*) FILTER (WHERE stuck.repairable)::integer
    AS repairable_claims,
  COALESCE(
    pg_catalog.sum(stuck.refund_amount_cents)
      FILTER (WHERE stuck.repairable),
    0
  )::bigint AS repairable_refund_amount_cents,
  pg_catalog.count(*) FILTER (WHERE NOT stuck.repairable)::integer
    AS unrepairable_claims,
  COALESCE(
    pg_catalog.sum(stuck.refund_amount_cents)
      FILTER (WHERE NOT stuck.repairable),
    0
  )::bigint AS unrepairable_refund_amount_cents
FROM stuck;

ROLLBACK;
