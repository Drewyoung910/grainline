-- DRAFT ONLY. Do not apply to any persistent database.
--
-- Move the legacy unordered-checkout Order-existence fence inside the already
-- fixed StripeWebhookEvent claim. The shared advisory lock serializes this
-- check with every compatible Order-creation path for the same Session. This
-- draft changes no table, policy or table grant.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.order.legacy-stock-restore-fence.preparation',
    0
  )
);

CREATE OR REPLACE FUNCTION public.grainline_legacy_stock_restore_claim(
  p_session_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_legacy_stock_restore_claim$
DECLARE
  canonical_event_id text;
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_now timestamp(3) without time zone;
  inserted_count integer;
  order_exists boolean;
BEGIN
  IF p_session_id IS NULL
     OR pg_catalog.char_length(p_session_id) = 0
     OR pg_catalog.char_length(p_session_id) > 255
     OR p_session_id IS DISTINCT FROM pg_catalog.btrim(p_session_id)
     OR p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'Checkout stock restore session id is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  canonical_event_id := 'checkout-stock-restore:' || p_session_id;
  IF pg_catalog.char_length(canonical_event_id) > 255 THEN
    RAISE EXCEPTION 'Checkout stock restore session id is too long'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Order creation and every legacy restore path use this same transaction-
  -- scoped Session lock. The absence check therefore cannot race a compatible
  -- Order commit before the caller finishes restoring stock.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    913337,
    pg_catalog.hashtext(p_session_id)
  );

  SELECT EXISTS (
    SELECT 1
      FROM public."Order" AS source_order
     WHERE source_order."stripeSessionId" = p_session_id
  )
    INTO order_exists;
  IF order_exists THEN
    RETURN false;
  END IF;

  source_now := (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  INSERT INTO public."StripeWebhookEvent" (
    id,
    type,
    "sourceObjectId",
    "claimGeneration",
    "processingStartedAt",
    "processedAt",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    canonical_event_id,
    'checkout.session.stock_restored',
    p_session_id,
    1,
    source_now,
    source_now,
    source_now,
    source_now
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 1 THEN
    RETURN true;
  END IF;

  SELECT event.*
    INTO STRICT source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = canonical_event_id
   FOR UPDATE;

  IF source_event.type IS DISTINCT FROM 'checkout.session.stock_restored'
     OR (
       source_event."sourceObjectId" IS NOT NULL
       AND source_event."sourceObjectId" IS DISTINCT FROM p_session_id
     )
     OR source_event."processedAt" IS NULL THEN
    RAISE EXCEPTION 'Checkout stock restore claim conflicts with an invalid event'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The predecessor function derived the canonical event id from the Session
  -- but did not populate sourceObjectId. Converge that exact legacy shape;
  -- never overwrite a conflicting non-null source witness.
  UPDATE public."StripeWebhookEvent" AS event
     SET "sourceObjectId" = p_session_id,
         "updatedAt" = source_now
   WHERE event.id = canonical_event_id
     AND event."sourceObjectId" IS NULL;

  RETURN false;
END
$grainline_legacy_stock_restore_claim$;

REVOKE ALL ON FUNCTION public.grainline_legacy_stock_restore_claim(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_legacy_stock_restore_claim(text)
  TO grainline_app_runtime;

COMMENT ON FUNCTION public.grainline_legacy_stock_restore_claim(text) IS
  'Claims one legacy stock restore only when the exact Checkout Session has no durable Order under the shared Session lock.';

DO $grainline_legacy_stock_restore_claim_postflight$
DECLARE
  function_oid oid := pg_catalog.to_regprocedure(
    'public.grainline_legacy_stock_restore_claim(text)'
  );
  runtime_role oid := 'grainline_app_runtime'::pg_catalog.regrole;
  named_runtime_function_count integer;
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
    RAISE EXCEPTION 'Legacy stock restore claim posture is incomplete';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO named_runtime_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'grainline_legacy_stock_restore_claim'
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     );
  IF named_runtime_function_count <> 1 THEN
    RAISE EXCEPTION
      'Legacy stock restore claim overload set drifted: %',
      named_runtime_function_count;
  END IF;
END
$grainline_legacy_stock_restore_claim_postflight$;

COMMIT;
