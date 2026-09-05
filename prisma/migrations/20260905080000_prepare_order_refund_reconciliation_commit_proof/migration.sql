-- Exact Order refund-reconciliation commit proof.
-- Compatible database-first authority; changes no table RLS or grant posture.

CREATE OR REPLACE FUNCTION public.grainline_order_refund_reconciliation_committed(
  p_order_id text,
  p_claim_id text,
  p_claim_generation bigint
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_refund_reconciliation_committed$
BEGIN
  IF p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191
     OR p_claim_id IS NULL
     OR p_claim_id !~ '^order_refund_claim_[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1 THEN
    RAISE EXCEPTION 'Order refund reconciliation commit proof input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public."OrderRefundReconciliation" AS reconciliation
      JOIN public."Order" AS source_order
        ON source_order.id = reconciliation."orderId"
     WHERE reconciliation."orderId" = p_order_id
       AND reconciliation."claimId" = p_claim_id
       AND reconciliation."claimGeneration" = p_claim_generation
       AND reconciliation.action IN (
         'RETRY_EXISTING_SCOPE',
         'CONFIRMED_PROVIDER_EFFECT'
       )
       AND source_order."refundClaimGeneration" = p_claim_generation
       AND source_order."refundClaimId" IS NULL
       AND source_order."refundClaimSource" IS NULL
       AND source_order."refundClaimSourceId" IS NULL
       AND source_order."refundClaimSourceGeneration" IS NULL
       AND source_order."refundClaimIdempotencyScope" IS NULL
       AND source_order."refundClaimProviderAuthorizedAt" IS NULL
       AND source_order."sellerRefundId" ~ '^re_[A-Za-z0-9]+$'
       AND source_order."sellerRefundAmountCents" IS NOT NULL
       AND source_order."sellerRefundAmountCents" > 0
  );
END
$grainline_order_refund_reconciliation_committed$;

REVOKE ALL ON FUNCTION
  public.grainline_order_refund_reconciliation_committed(text, text, bigint)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_refund_reconciliation_committed(text, text, bigint)
  TO grainline_app_runtime;
