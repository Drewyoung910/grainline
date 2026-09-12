-- DRAFT ONLY. No migration or production workflow is wired.
-- Expose the immutable UTC purchase clock, not the resetting attempt clock.
-- Preserve claim signature, locking, counters, grants, schema and RLS posture.
-- Production packaging requires exact database, role, ledger and release checks.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $label_clawback_clock_before$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_order_label_clawback_claim_batch(integer)')
       AND CURRENT_USER <> 'grainline_app_runtime'
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = 'a04a965b5b5e7128e3445e7cde9e52ce'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION 'Label clawback clock before authority drifted';
  END IF;
END
$label_clawback_clock_before$;

CREATE OR REPLACE FUNCTION public.grainline_order_label_clawback_claim_batch(
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_label_clawback_claim_batch$
DECLARE
  claimed jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Order label clawback batch limit is invalid' USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT source_order.id
      FROM public."Order" AS source_order
     WHERE source_order."labelStatus"::text = 'PURCHASED'
       AND source_order."labelClaimStatus" = 'PROVIDER_RECORDED'
       AND source_order."labelCostCents" > 0
       AND source_order."stripeTransferId" IS NOT NULL
       AND (
         (source_order."labelClawbackStatus" = 'RETRY_PENDING'
           AND source_order."labelClawbackNextAttemptAt" <=
             (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'))
         OR
         (source_order."labelClawbackStatus" = 'RETRYING'
           AND source_order."labelClawbackLastAttemptAt" <=
             (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '30 minutes')
       )
     ORDER BY source_order."labelClawbackNextAttemptAt" NULLS FIRST,
              source_order."labelPurchasedAt", source_order."createdAt", source_order.id
     FOR UPDATE OF source_order SKIP LOCKED
     LIMIT p_limit
  ), updated AS (
    UPDATE public."Order" AS target_order
       SET "labelClawbackStatus" = 'RETRYING',
           "labelClawbackGeneration" = target_order."labelClawbackGeneration" + 1,
           "labelClawbackRetryCount" = target_order."labelClawbackRetryCount" + 1,
           "labelClawbackLastAttemptAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
           "labelClawbackNextAttemptAt" = NULL
      FROM candidates
     WHERE target_order.id = candidates.id
    RETURNING target_order.*
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'orderId', updated.id,
    'claimId', updated."labelClaimId",
    'claimGeneration', updated."labelClaimGeneration",
    'clawbackGeneration', updated."labelClawbackGeneration",
    'stripeTransferId', updated."stripeTransferId",
    'transactionId', updated."shippoTransactionId",
    'rateObjectId', updated."labelClaimRateObjectId",
    'amountCents', updated."labelCostCents",
    'currency', updated."labelClaimCurrency",
    'attemptCount', updated."labelClawbackRetryCount",
    'labelPurchasedAt', updated."labelPurchasedAt" AT TIME ZONE 'UTC'
  ) ORDER BY updated."labelPurchasedAt", updated."createdAt", updated.id), '[]'::jsonb)
    INTO claimed
    FROM updated;

  RETURN claimed;
END
$grainline_order_label_clawback_claim_batch$;

DO $label_clawback_clock_after$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
     WHERE proc.oid = pg_catalog.to_regprocedure('public.grainline_order_label_clawback_claim_batch(integer)')
       AND CURRENT_USER <> 'grainline_app_runtime'
       AND proc.proowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER)
       AND proc.prokind = 'f' AND proc.prosecdef AND NOT proc.proleakproof
       AND proc.provolatile = 'v' AND proc.proparallel = 'u'
       AND proc.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND pg_catalog.md5(proc.prosrc) = '8e2af62677078c79c4e42f67d9346c1b'
       AND pg_catalog.has_function_privilege('grainline_app_runtime', proc.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proc.proacl,
           pg_catalog.acldefault('f', proc.proowner))) AS acl
          WHERE acl.grantee NOT IN (proc.proowner,
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime'))
             OR (acl.grantee <> proc.proowner AND (acl.is_grantable OR acl.grantor <> proc.proowner))
       )
  ) THEN
    RAISE EXCEPTION 'Label clawback clock after authority drifted';
  END IF;
END
$label_clawback_clock_after$;

COMMIT;
