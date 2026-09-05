-- Candidate successor: prevent Shippo label purchase and Stripe refund provider effects from being
-- authorized for the same Order at the same time. This is an additive data
-- invariant only: it changes no RLS posture, policy, or table/function grant.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order.provider-claim-exclusion.preparation',
    0
  )
);

LOCK TABLE public."Order" IN SHARE ROW EXCLUSIVE MODE;

DO $grainline_order_provider_claim_exclusion_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_metadata
     WHERE constraint_metadata.conrelid = 'public."Order"'::pg_catalog.regclass
       AND constraint_metadata.conname =
         'Order_provider_claim_mutual_exclusion_check'
  ) THEN
    RAISE EXCEPTION 'Order provider-claim exclusion is not at the clean predecessor';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Order" AS source_order
     WHERE (
       source_order."labelStatus"::text = 'PURCHASED'
       OR source_order."labelClaimStatus" IN (
         'PROVIDER_PENDING',
         'PROVIDER_AMBIGUOUS',
         'PROVIDER_RECORDED'
       )
     )
       AND (
         source_order."sellerRefundId" IS NOT NULL
         OR source_order."refundClaimId" IS NOT NULL
       )
  ) THEN
    RAISE EXCEPTION
      'Order provider-claim exclusion found overlapping label/refund state';
  END IF;
END
$grainline_order_provider_claim_exclusion_preflight$;

ALTER TABLE public."Order"
  ADD CONSTRAINT "Order_provider_claim_mutual_exclusion_check"
  CHECK (
    NOT (
      (
        "labelStatus"::text = 'PURCHASED'
        OR "labelClaimStatus" IN (
          'PROVIDER_PENDING',
          'PROVIDER_AMBIGUOUS',
          'PROVIDER_RECORDED'
        )
      )
      AND (
        "sellerRefundId" IS NOT NULL
        OR "refundClaimId" IS NOT NULL
      )
    )
  ) NOT VALID;

ALTER TABLE public."Order"
  VALIDATE CONSTRAINT "Order_provider_claim_mutual_exclusion_check";

COMMENT ON CONSTRAINT "Order_provider_claim_mutual_exclusion_check"
  ON public."Order" IS
  'A Shippo label purchase/claim and Stripe refund claim/result cannot coexist for one Order.';

COMMIT;
