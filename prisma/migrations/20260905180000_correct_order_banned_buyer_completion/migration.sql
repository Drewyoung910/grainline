-- Preserve a paid, banned buyer's blocked Order and refund path. The
-- reservation keeps the checkout-time buyer ID; the paid Order must not.
-- This migration changes one existing SECURITY DEFINER body only.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.order.banned-buyer-completion', 0)
);

DO $grainline_banned_buyer_completion_preflight$
DECLARE
  source_function pg_catalog.pg_proc%ROWTYPE;
BEGIN
  IF current_user <> 'neondb_owner' OR session_user <> 'neondb_owner' THEN
    RAISE EXCEPTION 'Banned-buyer completion requires the direct migration owner';
  END IF;
  SELECT * INTO source_function
    FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure(
     'public.grainline_checkout_reservation_complete(text,bigint,text,text)'
   );
  IF source_function.oid IS NULL
     OR pg_catalog.md5(source_function.prosrc) <> 'aa59397f525cf9029f5a594fe1521c57'
     OR pg_catalog.pg_get_userbyid(source_function.proowner) <> 'neondb_owner'
     OR source_function.prosecdef IS DISTINCT FROM true
     OR source_function.provolatile <> 'v'
     OR source_function.proparallel <> 'u'
     OR NOT ('search_path=pg_catalog' = ANY(source_function.proconfig))
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', source_function.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('public', source_function.oid, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Banned-buyer completion predecessor drifted';
  END IF;
END
$grainline_banned_buyer_completion_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_checkout_reservation_complete(
  p_event_id text,
  p_claim_generation bigint,
  p_reservation_id text,
  p_session_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_checkout_reservation_complete$
DECLARE
  source_reservation public."CheckoutStockReservation"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_event_id IS NULL OR pg_catalog.char_length(p_event_id) NOT BETWEEN 1 AND 255
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_session_id IS NULL OR p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$'
     OR pg_catalog.char_length(p_session_id) > 255
     OR (p_reservation_id IS NOT NULL AND pg_catalog.char_length(p_reservation_id) NOT BETWEEN 1 AND 191) THEN
    RAISE EXCEPTION 'Checkout reservation completion input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
     AND event.type IN ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
     AND event."sourceObjectId" = p_session_id
     AND event."claimGeneration" = p_claim_generation
     AND event."processingStartedAt" IS NOT NULL
     AND event."processedAt" IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout completion webhook claim is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(913337, pg_catalog.hashtext(p_session_id));

  SELECT reservation.*
    INTO source_reservation
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation."stripeSessionId" = p_session_id
      OR (p_reservation_id IS NOT NULL AND reservation.id = p_reservation_id)
   ORDER BY (reservation."stripeSessionId" = p_session_id) DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'absent';
  END IF;
  IF source_reservation."stripeSessionId" IS DISTINCT FROM p_session_id
     OR (p_reservation_id IS NOT NULL AND source_reservation.id IS DISTINCT FROM p_reservation_id) THEN
    RAISE EXCEPTION 'Checkout completion reservation does not match session'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM public."Order" AS source_order
   WHERE source_order."stripeSessionId" = p_session_id
     AND source_order."sellerProfileId" IS NOT DISTINCT FROM source_reservation."sellerId"
     AND (
       source_order."buyerId" IS NOT DISTINCT FROM source_reservation."buyerId"
       OR (
         -- Paid checkout must detach an invalid buyer and purge buyer PII,
         -- while the durable reservation still records its original buyer.
         source_order."buyerId" IS NULL
         AND source_reservation."buyerId" IS NOT NULL
         AND source_order."buyerDataPurgedAt" IS NOT NULL
         AND source_order."buyerEmail" IS NULL
         AND source_order."buyerName" IS NULL
         AND source_order."shipToLine1" IS NULL
         AND source_order."shipToLine2" IS NULL
         AND source_order."shipToCity" IS NULL
         AND source_order."shipToState" IS NULL
         AND source_order."shipToPostalCode" IS NULL
         AND source_order."shipToCountry" IS NULL
         AND source_order."quotedToLine1" IS NULL
         AND source_order."quotedToLine2" IS NULL
         AND source_order."quotedToCity" IS NULL
         AND source_order."quotedToState" IS NULL
         AND source_order."quotedToPostalCode" IS NULL
         AND source_order."quotedToCountry" IS NULL
         AND source_order."quotedToName" IS NULL
         AND source_order."quotedToPhone" IS NULL
         AND source_order."shippoShipmentId" IS NULL
         AND source_order."shippoRateObjectId" IS NULL
         AND source_order."giftNote" IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM public."User" AS source_buyer
            WHERE source_buyer.id = source_reservation."buyerId"
              AND source_buyer.banned = false
              AND source_buyer."deletedAt" IS NULL
         )
       )
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout completion is missing its durable order'
      USING ERRCODE = 'check_violation';
  END IF;

  IF source_reservation.status = 'COMPLETED' THEN
    RETURN 'already_completed';
  END IF;
  IF source_reservation.status = 'RESTORED' THEN
    RAISE EXCEPTION 'A restored checkout reservation cannot complete'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public."CheckoutStockReservation" AS reservation
     SET status = 'COMPLETED',
         "repairClaimedAt" = NULL,
         "repairClaimKind" = NULL,
         "lastRepairError" = NULL,
         "updatedAt" = source_now
   WHERE reservation.id = source_reservation.id;
  RETURN 'completed';
END
$grainline_checkout_reservation_complete$;

DO $grainline_banned_buyer_completion_postflight$
DECLARE
  source_function pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO source_function
    FROM pg_catalog.pg_proc
   WHERE oid = pg_catalog.to_regprocedure(
     'public.grainline_checkout_reservation_complete(text,bigint,text,text)'
   );
  IF source_function.oid IS NULL
     OR pg_catalog.md5(source_function.prosrc) <> '1859c7ba941e6ba891d1869b90a83403'
     OR pg_catalog.pg_get_userbyid(source_function.proowner) <> 'neondb_owner'
     OR source_function.prosecdef IS DISTINCT FROM true
     OR source_function.provolatile <> 'v'
     OR source_function.proparallel <> 'u'
     OR NOT ('search_path=pg_catalog' = ANY(source_function.proconfig))
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', source_function.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('public', source_function.oid, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Banned-buyer completion replacement drifted';
  END IF;
END
$grainline_banned_buyer_completion_postflight$;

COMMIT;
