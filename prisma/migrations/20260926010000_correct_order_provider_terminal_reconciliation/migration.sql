-- Permit durable recording of a provider refund after a shipping label has
-- already been purchased. Active refund claims remain mutually exclusive with
-- every active or completed label state, but a terminal Stripe observation
-- must be recordable because rejecting the database write cannot undo the
-- provider-side refund.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order.provider-terminal-reconciliation.correction',
    0
  )
);

LOCK TABLE public."Order" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public."Order"
  DROP CONSTRAINT "Order_provider_claim_mutual_exclusion_check";

DO $grainline_order_provider_claim_exclusion_preflight$
BEGIN
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
       AND source_order."refundClaimId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Order provider-claim correction found overlapping active claims';
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
      AND "refundClaimId" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE public."Order"
  VALIDATE CONSTRAINT "Order_provider_claim_mutual_exclusion_check";

COMMENT ON CONSTRAINT "Order_provider_claim_mutual_exclusion_check"
  ON public."Order" IS
  'An active Stripe refund claim cannot coexist with a Shippo label purchase/claim. Terminal provider refund evidence remains recordable after a label purchase.';

COMMIT;
