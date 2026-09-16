-- Compatible Order authority candidate: expose only the provider-authorized
-- clock of one exact active refund claim. This replaces an ordinary-runtime
-- base-table read without changing Order RLS or table grants.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order.refund-claim-clock-authority.preparation',
    0
  )
);

CREATE FUNCTION public.grainline_order_refund_claim_provider_clock(
  p_claim_id text,
  p_claim_generation bigint,
  p_claim_source text,
  p_claim_source_id text,
  p_claim_source_generation bigint,
  p_idempotency_scope text
)
RETURNS TABLE(provider_authorized_at timestamp(3) without time zone)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_refund_claim_provider_clock$
BEGIN
  IF p_claim_id IS NULL
     OR pg_catalog.char_length(p_claim_id) NOT BETWEEN 1 AND 255
     OR p_claim_id IS DISTINCT FROM pg_catalog.btrim(p_claim_id)
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_claim_source NOT IN ('SELLER', 'BLOCKED_CHECKOUT')
     OR p_claim_source_id IS NULL
     OR pg_catalog.char_length(p_claim_source_id) NOT BETWEEN 1 AND 255
     OR p_claim_source_id IS DISTINCT FROM pg_catalog.btrim(p_claim_source_id)
     OR p_idempotency_scope IS NULL
     OR pg_catalog.char_length(p_idempotency_scope) NOT BETWEEN 1 AND 191
     OR p_idempotency_scope IS DISTINCT FROM pg_catalog.btrim(p_idempotency_scope)
     OR (p_claim_source = 'SELLER' AND p_claim_source_generation IS NOT NULL)
     OR (p_claim_source = 'BLOCKED_CHECKOUT'
         AND (p_claim_source_generation IS NULL OR p_claim_source_generation < 1)) THEN
    RAISE EXCEPTION 'Order refund claim provider clock input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT source_order."refundClaimProviderAuthorizedAt"
    FROM public."Order" AS source_order
   WHERE source_order."sellerRefundId" = 'pending'
     AND source_order."refundClaimId" = p_claim_id
     AND source_order."refundClaimGeneration" = p_claim_generation
     AND source_order."refundClaimSource" = p_claim_source
     AND source_order."refundClaimSourceId" = p_claim_source_id
     AND source_order."refundClaimSourceGeneration"
           IS NOT DISTINCT FROM p_claim_source_generation
     AND source_order."refundClaimIdempotencyScope" = p_idempotency_scope
     AND source_order."refundClaimProviderAuthorizedAt" IS NOT NULL;
END
$grainline_order_refund_claim_provider_clock$;

REVOKE ALL ON FUNCTION
  public.grainline_order_refund_claim_provider_clock(
    text, bigint, text, text, bigint, text
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_refund_claim_provider_clock(
    text, bigint, text, text, bigint, text
  )
  TO grainline_app_runtime;

COMMENT ON FUNCTION
  public.grainline_order_refund_claim_provider_clock(
    text, bigint, text, text, bigint, text
  ) IS
  'Returns only the provider-authorized clock for one exact active refund claim.';

DO $grainline_order_refund_claim_provider_clock_postflight$
DECLARE
  function_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_order_refund_claim_provider_clock(text,bigint,text,text,bigint,text)'
  );
  runtime_role oid := 'grainline_app_runtime'::pg_catalog.regrole;
BEGIN
  IF function_oid IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = function_oid
       AND procedure.prosecdef
       AND procedure.provolatile = 's'
       AND procedure.proparallel = 's'
       AND procedure.proowner <> runtime_role
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.has_function_privilege(
         'grainline_app_runtime', procedure.oid, 'EXECUTE'
       )
       AND NOT pg_catalog.has_function_privilege(
         'public', procedure.oid, 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'Order refund claim provider clock posture is incomplete';
  END IF;
END
$grainline_order_refund_claim_provider_clock_postflight$;

COMMIT;
