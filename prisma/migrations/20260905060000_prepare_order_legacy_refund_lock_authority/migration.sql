-- Compatible Order authority replacing the broad runtime update used to retire pre-generation
-- `sellerRefundId = 'pending'` locks with three narrowly sourced operations:
-- one active signed Stripe event, one authenticated staff Case, or one bounded
-- maintenance batch. This migration changes no table, policy or table grant.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order.legacy-refund-lock-authority.preparation',
    0
  )
);

CREATE OR REPLACE FUNCTION
  public.grainline_blocked_checkout_legacy_refund_lock_release(
    p_event_id text,
    p_event_claim_generation bigint,
    p_session_id text,
    p_order_id text
  )
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_blocked_checkout_legacy_refund_lock_release$
DECLARE
  locked_event public."StripeWebhookEvent"%ROWTYPE;
  locked_order public."Order"%ROWTYPE;
BEGIN
  IF p_event_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_event_id)) NOT BETWEEN 1 AND 255
     OR p_event_claim_generation IS NULL OR p_event_claim_generation < 1
     OR p_session_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_session_id)) NOT BETWEEN 1 AND 255
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Blocked-checkout legacy refund-lock input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT source_event.*
    INTO locked_event
    FROM public."StripeWebhookEvent" AS source_event
   WHERE source_event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_event.type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR locked_event."claimGeneration" IS DISTINCT FROM p_event_claim_generation
     OR locked_event."processingStartedAt" IS NULL
     OR locked_event."processedAt" IS NOT NULL
     OR locked_event."sourceObjectId" IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'Blocked-checkout legacy refund-lock source lease is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = p_order_id
     AND orders."stripeSessionId" = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blocked-checkout legacy refund-lock Order source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
     OR locked_order."caseResolutionClaimId" IS NOT NULL
     OR locked_order."refundClaimId" IS NOT NULL
     OR (
       locked_order."sellerRefundLockedAt" IS NOT NULL
       AND locked_order."sellerRefundLockedAt" >= (
         pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       ) - interval '15 minutes'
     ) THEN
    RETURN false;
  END IF;

  UPDATE public."Order" AS orders
     SET "sellerRefundId" = NULL,
         "sellerRefundLockedAt" = NULL
   WHERE orders.id = locked_order.id
     AND orders."stripeSessionId" = p_session_id
     AND orders."sellerRefundId" = 'pending'
     AND orders."caseResolutionClaimId" IS NULL
     AND orders."refundClaimId" IS NULL
     AND (
       orders."sellerRefundLockedAt" IS NULL
       OR orders."sellerRefundLockedAt" < (
         pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       ) - interval '15 minutes'
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blocked-checkout legacy refund-lock release raced'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN true;
END
$grainline_blocked_checkout_legacy_refund_lock_release$;

CREATE OR REPLACE FUNCTION public.grainline_case_legacy_refund_lock_release(
  p_actor_user_id text,
  p_case_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_legacy_refund_lock_release$
DECLARE
  locked_actor public."User"%ROWTYPE;
  source_order_id text;
  locked_order public."Order"%ROWTYPE;
  locked_case public."Case"%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_case_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_case_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Case legacy refund-lock input is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT actor.*
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL
     OR locked_actor.role::text NOT IN ('EMPLOYEE', 'ADMIN') THEN
    RAISE EXCEPTION 'Case legacy refund-lock staff authority is invalid'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT source_case."orderId"
    INTO source_order_id
    FROM public."Case" AS source_case
   WHERE source_case.id = p_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case legacy refund-lock Case does not exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT orders.*
    INTO locked_order
    FROM public."Order" AS orders
   WHERE orders.id = source_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case legacy refund-lock Order does not exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT source_case.*
    INTO locked_case
    FROM public."Case" AS source_case
   WHERE source_case.id = p_case_id
     AND source_case."orderId" = locked_order.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case legacy refund-lock source changed Order'
      USING ERRCODE = 'serialization_failure';
  END IF;
  IF locked_case.status::text IN ('RESOLVED', 'CLOSED')
     OR locked_case."resolvedAt" IS NOT NULL THEN
    RETURN false;
  END IF;

  IF locked_order."sellerRefundId" IS DISTINCT FROM 'pending'
     OR locked_order."caseResolutionClaimId" IS NOT NULL
     OR locked_order."refundClaimId" IS NOT NULL
     OR (
       locked_order."sellerRefundLockedAt" IS NOT NULL
       AND locked_order."sellerRefundLockedAt" >= (
         pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       ) - interval '15 minutes'
     ) THEN
    RETURN false;
  END IF;

  UPDATE public."Order" AS orders
     SET "sellerRefundId" = NULL,
         "sellerRefundLockedAt" = NULL
   WHERE orders.id = locked_order.id
     AND orders."sellerRefundId" = 'pending'
     AND orders."caseResolutionClaimId" IS NULL
     AND orders."refundClaimId" IS NULL
     AND (
       orders."sellerRefundLockedAt" IS NULL
       OR orders."sellerRefundLockedAt" < (
         pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       ) - interval '15 minutes'
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case legacy refund-lock release raced'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN true;
END
$grainline_case_legacy_refund_lock_release$;

CREATE OR REPLACE FUNCTION public.grainline_order_legacy_refund_lock_prune(
  p_batch_size integer
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_legacy_refund_lock_prune$
DECLARE
  released_count integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Order legacy refund-lock prune batch is invalid'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH candidates AS (
    SELECT orders.id
      FROM public."Order" AS orders
     WHERE orders."sellerRefundId" = 'pending'
       AND orders."caseResolutionClaimId" IS NULL
       AND orders."refundClaimId" IS NULL
       AND (
         orders."sellerRefundLockedAt" IS NULL
         OR orders."sellerRefundLockedAt" < (
           pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
         ) - interval '15 minutes'
       )
     ORDER BY orders."sellerRefundLockedAt" ASC NULLS FIRST, orders.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_batch_size
  ), released AS (
    UPDATE public."Order" AS orders
       SET "sellerRefundId" = NULL,
           "sellerRefundLockedAt" = NULL
      FROM candidates
     WHERE orders.id = candidates.id
       AND orders."sellerRefundId" = 'pending'
       AND orders."caseResolutionClaimId" IS NULL
       AND orders."refundClaimId" IS NULL
       AND (
         orders."sellerRefundLockedAt" IS NULL
         OR orders."sellerRefundLockedAt" < (
           pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
         ) - interval '15 minutes'
       )
    RETURNING orders.id
  )
  SELECT pg_catalog.count(*)::integer
    INTO released_count
    FROM released;
  RETURN released_count;
END
$grainline_order_legacy_refund_lock_prune$;

REVOKE ALL ON FUNCTION
  public.grainline_blocked_checkout_legacy_refund_lock_release(
    text, bigint, text, text
  )
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_case_legacy_refund_lock_release(
  text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_legacy_refund_lock_prune(
  integer
) FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_blocked_checkout_legacy_refund_lock_release(
    text, bigint, text, text
  )
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_case_legacy_refund_lock_release(
  text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_legacy_refund_lock_prune(
  integer
) TO grainline_app_runtime;

COMMENT ON FUNCTION
  public.grainline_blocked_checkout_legacy_refund_lock_release(
    text, bigint, text, text
  ) IS
  'Releases only an exact stale pre-generation refund lock under an active signed blocked-checkout webhook lease.';
COMMENT ON FUNCTION public.grainline_case_legacy_refund_lock_release(
  text, text
) IS
  'Releases only an exact stale pre-generation refund lock for a nonterminal Case under active staff authority.';
COMMENT ON FUNCTION public.grainline_order_legacy_refund_lock_prune(
  integer
) IS
  'Releases a bounded SKIP LOCKED batch of stale pre-generation refund locks that have no modern refund or Case claim.';

DO $grainline_order_legacy_refund_lock_authority_postflight$
DECLARE
  accepted_function_count integer;
  named_runtime_function_count integer;
  runtime_role oid := 'grainline_app_runtime'::pg_catalog.regrole;
BEGIN
  WITH expected(proname, identity_arguments) AS (
    VALUES
      (
        'grainline_blocked_checkout_legacy_refund_lock_release'::name,
        'text, bigint, text, text'::text
      ),
      (
        'grainline_case_legacy_refund_lock_release'::name,
        'text, text'::text
      ),
      (
        'grainline_order_legacy_refund_lock_prune'::name,
        'integer'::text
      )
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.proname
     AND pg_catalog.oidvectortypes(procedure.proargtypes)
           = expected.identity_arguments
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
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
     );
  IF accepted_function_count <> 3 THEN
    RAISE EXCEPTION
      'Order legacy refund-lock authority posture is incomplete: %',
      accepted_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO named_runtime_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_blocked_checkout_legacy_refund_lock_release',
       'grainline_case_legacy_refund_lock_release',
       'grainline_order_legacy_refund_lock_prune'
     )
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     );
  IF named_runtime_function_count <> 3 THEN
    RAISE EXCEPTION
      'Order legacy refund-lock authority overload set drifted: %',
      named_runtime_function_count;
  END IF;
END
$grainline_order_legacy_refund_lock_authority_postflight$;

COMMIT;
