-- Compatible Order authority candidate: classify one seller-owned refund
-- attempt and release only that Order's stale predecessor lock. The claim and
-- finalization functions remain the authority for provider side effects.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order.seller-refund-preflight-authority.preparation',
    0
  )
);

CREATE FUNCTION public.grainline_seller_refund_preflight(
  p_actor_user_id text,
  p_order_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_refund_preflight$
DECLARE
  locked_actor public."User"%ROWTYPE;
  locked_seller public."SellerProfile"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(p_actor_user_id) NOT BETWEEN 1 AND 191
     OR p_actor_user_id IS DISTINCT FROM pg_catalog.btrim(p_actor_user_id)
     OR p_order_id IS NULL
     OR pg_catalog.char_length(p_order_id) NOT BETWEEN 1 AND 191
     OR p_order_id IS DISTINCT FROM pg_catalog.btrim(p_order_id) THEN
    RAISE EXCEPTION 'Seller refund preflight input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT actor.*
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR UPDATE;
  IF NOT FOUND OR locked_actor."deletedAt" IS NOT NULL OR locked_actor.banned THEN
    RETURN 'FORBIDDEN';
  END IF;

  SELECT seller.*
    INTO locked_seller
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = locked_actor.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'FORBIDDEN';
  END IF;

  SELECT source_order.*
    INTO locked_order
    FROM public."Order" AS source_order
   WHERE source_order.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_order."sellerProfileId" IS DISTINCT FROM locked_seller.id THEN
    RETURN 'NOT_FOUND';
  END IF;

  -- This is the exact predecessor cleanup formerly performed through broad
  -- runtime UPDATE. Modern generation-fenced and Case claims are never aged
  -- out by wall-clock time.
  IF locked_order."sellerRefundId" = 'pending'
     AND locked_order."caseResolutionClaimId" IS NULL
     AND locked_order."refundClaimId" IS NULL
     AND (
       locked_order."sellerRefundLockedAt" IS NULL
       OR locked_order."sellerRefundLockedAt" < source_now - interval '15 minutes'
     ) THEN
    UPDATE public."Order" AS source_order
       SET "sellerRefundId" = NULL,
           "sellerRefundLockedAt" = NULL
     WHERE source_order.id = locked_order.id
       AND source_order."sellerRefundId" = 'pending'
       AND source_order."caseResolutionClaimId" IS NULL
       AND source_order."refundClaimId" IS NULL
       AND (
         source_order."sellerRefundLockedAt" IS NULL
         OR source_order."sellerRefundLockedAt" < source_now - interval '15 minutes'
       )
    RETURNING source_order.* INTO locked_order;
  END IF;

  IF locked_order."paymentOpenDisputeBlocked" THEN
    RETURN 'OPEN_DISPUTE';
  ELSIF locked_order."sellerRefundId" = 'pending' THEN
    RETURN 'PROCESSING';
  ELSIF locked_order."sellerRefundId" =
        'ambiguous_refund_pending_reconciliation' THEN
    RETURN 'AMBIGUOUS';
  ELSIF locked_order."sellerRefundId" IS NOT NULL
        OR locked_order."paymentRefundBlocked" THEN
    RETURN 'RECORDED';
  ELSIF locked_order."labelStatus"::text = 'PURCHASED'
        OR locked_order."labelClaimStatus" IN (
          'PROVIDER_PENDING',
          'PROVIDER_AMBIGUOUS',
          'PROVIDER_RECORDED'
        ) THEN
    RETURN 'LABEL_BLOCKED';
  ELSIF locked_order."stripePaymentIntentId" IS NULL THEN
    RETURN 'NO_PAYMENT';
  ELSIF locked_order."paidAt" IS NULL
        OR locked_order."sellerRefundLockedAt" IS NOT NULL
        OR locked_order."caseResolutionClaimId" IS NOT NULL
        OR locked_order."refundClaimId" IS NOT NULL THEN
    RETURN 'STATE_CHANGED';
  END IF;

  RETURN 'READY';
END
$grainline_seller_refund_preflight$;

REVOKE ALL ON FUNCTION
  public.grainline_seller_refund_preflight(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_refund_preflight(text, text)
  TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_seller_refund_preflight(text, text) IS
  'Classifies one seller-owned refund attempt and releases only its stale legacy lock.';

DO $grainline_seller_refund_preflight_postflight$
DECLARE
  function_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_seller_refund_preflight(text,text)'
  );
  runtime_role oid := 'grainline_app_runtime'::pg_catalog.regrole;
BEGIN
  IF function_oid IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = function_oid
       AND procedure.prosecdef
       AND procedure.provolatile = 'v'
       AND procedure.proparallel = 'u'
       AND procedure.proowner <> runtime_role
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.has_function_privilege(
         'grainline_app_runtime', procedure.oid, 'EXECUTE'
       )
       AND NOT pg_catalog.has_function_privilege(
         'public', procedure.oid, 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'Seller refund preflight posture is incomplete';
  END IF;
END
$grainline_seller_refund_preflight_postflight$;

COMMIT;
