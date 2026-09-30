BEGIN;

-- Count only actionable Order-domain operational states. Runtime receives no
-- row identity or business data, and keeps zero direct table authority after
-- Order and the related operational ledgers entered FORCE RLS.
CREATE FUNCTION public.grainline_order_ops_health_summary()
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
         WHERE source_order."sellerRefundId" = 'pending'
           AND COALESCE(
             source_order."refundClaimProviderAuthorizedAt",
             source_order."sellerRefundLockedAt",
             source_order."paidAt",
             source_order."createdAt"
           ) < source_clock.now_utc - interval '30 minutes'
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

REVOKE ALL ON FUNCTION public.grainline_order_ops_health_summary()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_ops_health_summary()
  TO grainline_app_runtime;

COMMIT;
