-- Audit #664 blocked-checkout refund witness backfill inventory.
-- READ ONLY. The result contains aggregate counts only and emits no Order,
-- user, seller, claim, reconciliation, or Stripe identifiers.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- @query summary
WITH active_claim AS (
  SELECT orders.id
    FROM public."Order" AS orders
   WHERE orders."refundClaimSource" = 'BLOCKED_CHECKOUT'
), review_note AS (
  SELECT orders.id
    FROM public."Order" AS orders
   WHERE pg_catalog.strpos(
           COALESCE(orders."reviewNote", ''),
           'Order was held for staff review.'
         ) > 0
), reconciliation AS (
  SELECT DISTINCT reconciliation."orderId" AS id
    FROM public."OrderRefundReconciliation" AS reconciliation
   WHERE reconciliation."claimSource" = 'BLOCKED_CHECKOUT'
), recorded_event AS (
  SELECT DISTINCT payment_event."orderId" AS id
    FROM public."OrderPaymentEvent" AS payment_event
   WHERE payment_event.metadata->>'localAction'
           = 'BLOCKED_CHECKOUT_REFUND_RECORDED'
), audit_log AS (
  SELECT DISTINCT source_audit."targetId" AS id
    FROM public."SystemAuditLog" AS source_audit
    JOIN public."Order" AS orders
      ON orders.id = source_audit."targetId"
   WHERE source_audit."targetType" = 'ORDER'
     AND source_audit.action = 'STRIPE_CHECKOUT_ORDER_CREATED'
     AND source_audit.reason IS NOT NULL
), refund_evidence AS (
  SELECT orders.id
    FROM public."Order" AS orders
   WHERE orders."paymentRefundBlocked"
      OR (
        orders."sellerRefundId" IS NOT NULL
        AND orders."sellerRefundId" NOT IN (
          'pending', 'ambiguous_refund_pending_reconciliation'
        )
      )
  UNION
  SELECT DISTINCT payment_event."orderId" AS id
    FROM public."OrderPaymentEvent" AS payment_event
   WHERE payment_event."eventType" = 'REFUND'
     AND (
       payment_event.status IS NULL
       OR pg_catalog.lower(payment_event.status)
            NOT IN ('failed', 'canceled', 'cancelled')
     )
), required_witness AS (
  SELECT id FROM active_claim
  UNION
  SELECT id FROM review_note
  UNION
  SELECT id FROM reconciliation
  UNION
  SELECT id FROM recorded_event
  UNION
  SELECT id FROM audit_log
), outstanding_witness AS (
  SELECT required_witness.id
    FROM required_witness
    LEFT JOIN recorded_event ON recorded_event.id = required_witness.id
   WHERE recorded_event.id IS NULL
), outstanding_with_refund_evidence AS (
  SELECT outstanding_witness.id
    FROM outstanding_witness
    JOIN refund_evidence
      ON refund_evidence.id = outstanding_witness.id
), review_note_only AS (
  SELECT review_note.id
    FROM review_note
    LEFT JOIN active_claim ON active_claim.id = review_note.id
    LEFT JOIN reconciliation ON reconciliation.id = review_note.id
    LEFT JOIN recorded_event ON recorded_event.id = review_note.id
    LEFT JOIN audit_log ON audit_log.id = review_note.id
   WHERE active_claim.id IS NULL
     AND reconciliation.id IS NULL
     AND recorded_event.id IS NULL
     AND audit_log.id IS NULL
)
SELECT
  (SELECT pg_catalog.count(*) FROM public."Order")::bigint
    AS total_order_count,
  (SELECT pg_catalog.count(*) FROM active_claim)::bigint
    AS active_claim_order_count,
  (SELECT pg_catalog.count(*) FROM review_note)::bigint
    AS review_note_order_count,
  (SELECT pg_catalog.count(*) FROM reconciliation)::bigint
    AS reconciliation_order_count,
  (SELECT pg_catalog.count(*) FROM recorded_event)::bigint
    AS recorded_event_order_count,
  (SELECT pg_catalog.count(*) FROM audit_log)::bigint
    AS audit_log_order_count,
  (SELECT pg_catalog.count(*) FROM required_witness)::bigint
    AS backfill_required_order_count,
  (SELECT pg_catalog.count(*) FROM recorded_event)::bigint
    AS backfill_recorded_order_count,
  (SELECT pg_catalog.count(*) FROM outstanding_witness)::bigint
    AS projected_outstanding_order_count,
  (SELECT pg_catalog.count(*) FROM outstanding_with_refund_evidence)::bigint
    AS outstanding_with_refund_evidence_order_count,
  (SELECT pg_catalog.count(*) FROM review_note_only)::bigint
    AS review_note_only_order_count;

ROLLBACK;
