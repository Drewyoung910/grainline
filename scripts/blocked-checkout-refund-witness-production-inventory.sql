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
), required_witness AS (
  SELECT id FROM active_claim
  UNION
  SELECT id FROM review_note
  UNION
  SELECT id FROM reconciliation
  UNION
  SELECT id FROM recorded_event
), outstanding_witness AS (
  SELECT required_witness.id
    FROM required_witness
    LEFT JOIN recorded_event ON recorded_event.id = required_witness.id
   WHERE recorded_event.id IS NULL
), review_note_only AS (
  SELECT review_note.id
    FROM review_note
    LEFT JOIN active_claim ON active_claim.id = review_note.id
    LEFT JOIN reconciliation ON reconciliation.id = review_note.id
    LEFT JOIN recorded_event ON recorded_event.id = review_note.id
   WHERE active_claim.id IS NULL
     AND reconciliation.id IS NULL
     AND recorded_event.id IS NULL
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
  (SELECT pg_catalog.count(*) FROM required_witness)::bigint
    AS backfill_required_order_count,
  (SELECT pg_catalog.count(*) FROM recorded_event)::bigint
    AS backfill_recorded_order_count,
  (SELECT pg_catalog.count(*) FROM outstanding_witness)::bigint
    AS projected_outstanding_order_count,
  (SELECT pg_catalog.count(*) FROM review_note_only)::bigint
    AS review_note_only_order_count;

ROLLBACK;
