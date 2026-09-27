-- Replace mutable review-note inference with the durable seller deauthorization witness.
-- This successor changes no RLS posture or table grants.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_label_preflight(
  p_actor_user_id text,
  p_order_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_label_preflight$
DECLARE
  actor public."User"%ROWTYPE;
  seller public."SellerProfile"%ROWTYPE;
  source_order public."Order"%ROWTYPE;
  package_source text;
  package_weight numeric;
  package_length numeric;
  package_width numeric;
  package_height numeric;
  snapshot_items integer;
  legacy_items integer;
  total_items integer;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Order label preflight input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT source_actor.* INTO actor
    FROM public."User" AS source_actor
   WHERE source_actor.id = p_actor_user_id;
  IF NOT FOUND OR actor.banned OR actor."deletedAt" IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT source_seller.* INTO seller
    FROM public."SellerProfile" AS source_seller
   WHERE source_seller."userId" = actor.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT candidate.* INTO source_order
    FROM public."Order" AS candidate
   WHERE candidate.id = p_order_id;
  IF NOT FOUND OR source_order."sellerProfileId" IS DISTINCT FROM seller.id THEN
    RETURN NULL;
  END IF;

  IF source_order."paidAt" IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'unpaid');
  END IF;
  IF source_order."sellerRefundId" IS NOT NULL
     OR source_order."sellerRefundLockedAt" IS NOT NULL
     OR source_order."paymentRefundBlocked" THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'refunded');
  END IF;
  IF source_order."paymentOpenDisputeBlocked" THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'open_dispute');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."Case" AS source_case
     WHERE source_case."orderId" = source_order.id
       AND source_case.status::text IN (
         'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW'
       )
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'active_case');
  END IF;
  IF source_order."sellerDeauthorizedAt" IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'conflict', 'reason', 'seller_deauthorized'
    );
  END IF;
  IF source_order."fulfillmentStatus"::text <> 'PENDING'
     OR COALESCE(source_order."fulfillmentMethod"::text, 'SHIPPING') <> 'SHIPPING' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'state_changed');
  END IF;
  IF source_order."labelStatus"::text = 'PURCHASED' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'label_purchased');
  END IF;
  IF source_order."labelClaimStatus" IN (
    'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'conflict', 'reason', 'label_claim_active'
    );
  END IF;

  IF NULLIF(pg_catalog.btrim(source_order."shipToLine1"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(source_order."shipToCity"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(source_order."shipToState"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(source_order."shipToPostalCode"), '') IS NULL
     OR COALESCE(source_order."shipToCountry", 'US') !~ '^[A-Za-z]{2}$'
     OR NULLIF(pg_catalog.btrim(
       COALESCE(source_order."buyerName", source_order."quotedToName", '')
     ), '') IS NULL
     OR NULLIF(pg_catalog.btrim(seller."shipFromLine1"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(seller."shipFromCity"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(seller."shipFromState"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(seller."shipFromPostal"), '') IS NULL
     OR COALESCE(seller."shipFromCountry", 'US') !~ '^[A-Za-z]{2}$'
     OR NULLIF(pg_catalog.btrim(
       COALESCE(seller."shipFromName", seller."displayName", '')
     ), '') IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'address_missing');
  END IF;

  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(*) FILTER (
           WHERE pg_catalog.jsonb_typeof(item."listingSnapshot") = 'object'
             AND item.quantity > 0
             AND item."listingSnapshot"->>'shippingPackageComplete' = 'true'
             AND item."listingSnapshot"->>'shippingWeightGrams' ~ '^[0-9]+([.][0-9]+)?$'
             AND item."listingSnapshot"->>'shippingLengthCm' ~ '^[0-9]+([.][0-9]+)?$'
             AND item."listingSnapshot"->>'shippingWidthCm' ~ '^[0-9]+([.][0-9]+)?$'
             AND item."listingSnapshot"->>'shippingHeightCm' ~ '^[0-9]+([.][0-9]+)?$'
         )::integer
    INTO total_items, snapshot_items
    FROM public."OrderItem" AS item
   WHERE item."orderId" = source_order.id;

  IF total_items < 1 THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'package_missing');
  END IF;

  IF snapshot_items = total_items THEN
    SELECT
      pg_catalog.sum((item."listingSnapshot"->>'shippingWeightGrams')::numeric * item.quantity),
      pg_catalog.max((item."listingSnapshot"->>'shippingLengthCm')::numeric),
      pg_catalog.max((item."listingSnapshot"->>'shippingWidthCm')::numeric),
      pg_catalog.max((item."listingSnapshot"->>'shippingHeightCm')::numeric)
      INTO package_weight, package_length, package_width, package_height
      FROM public."OrderItem" AS item
     WHERE item."orderId" = source_order.id;
    package_source := 'CHECKOUT_SNAPSHOT';
  ELSE
    SELECT pg_catalog.count(*) FILTER (
             WHERE item.quantity > 0
               AND COALESCE(listing."packagedWeightGrams", seller."defaultPkgWeightGrams") > 0
               AND COALESCE(listing."packagedWeightGrams", seller."defaultPkgWeightGrams") <= 500000
               AND COALESCE(listing."packagedLengthCm", seller."defaultPkgLengthCm") > 0
               AND COALESCE(listing."packagedLengthCm", seller."defaultPkgLengthCm") <= 1000
               AND COALESCE(listing."packagedWidthCm", seller."defaultPkgWidthCm") > 0
               AND COALESCE(listing."packagedWidthCm", seller."defaultPkgWidthCm") <= 1000
               AND COALESCE(listing."packagedHeightCm", seller."defaultPkgHeightCm") > 0
               AND COALESCE(listing."packagedHeightCm", seller."defaultPkgHeightCm") <= 1000
           )::integer,
      pg_catalog.sum(COALESCE(listing."packagedWeightGrams", seller."defaultPkgWeightGrams")::numeric * item.quantity),
      pg_catalog.max(COALESCE(listing."packagedLengthCm", seller."defaultPkgLengthCm")::numeric),
      pg_catalog.max(COALESCE(listing."packagedWidthCm", seller."defaultPkgWidthCm")::numeric),
      pg_catalog.max(COALESCE(listing."packagedHeightCm", seller."defaultPkgHeightCm")::numeric)
      INTO legacy_items, package_weight, package_length, package_width, package_height
      FROM public."OrderItem" AS item
      LEFT JOIN public."Listing" AS listing ON listing.id = item."listingId"
     WHERE item."orderId" = source_order.id;
    package_source := 'LEGACY_LIVE';
  END IF;

  IF (package_source = 'LEGACY_LIVE' AND legacy_items <> total_items)
     OR package_weight IS NULL OR package_weight <= 0 OR package_weight > 500000
     OR package_length IS NULL OR package_length <= 0 OR package_length > 1000
     OR package_width IS NULL OR package_width <= 0 OR package_width > 1000
     OR package_height IS NULL OR package_height <= 0 OR package_height > 1000 THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'package_missing');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'ready',
    'orderId', source_order.id,
    'sellerUserId', seller."userId",
    'currency', pg_catalog.lower(source_order.currency),
    'storedRateObjectId', source_order."shippoRateObjectId",
    'storedRateAmountCents', source_order."quotedShippingAmountCents",
    'storedRateUsable', source_order."shippoRateObjectId" IS NOT NULL
      AND source_order."shippoRateObjectId" NOT IN ('fallback', 'pickup')
      AND source_order."shippoRateObjectId" NOT LIKE 'quote-only:%'
      AND source_order."createdAt" >
        (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '5 days',
    'packageSource', package_source,
    'packageWeightGrams', package_weight,
    'packageLengthCm', package_length,
    'packageWidthCm', package_width,
    'packageHeightCm', package_height,
    'shipFrom', pg_catalog.jsonb_build_object(
      'name', COALESCE(NULLIF(pg_catalog.btrim(seller."shipFromName"), ''),
        pg_catalog.btrim(seller."displayName")),
      'street1', pg_catalog.btrim(seller."shipFromLine1"),
      'street2', seller."shipFromLine2",
      'city', pg_catalog.btrim(seller."shipFromCity"),
      'state', pg_catalog.btrim(seller."shipFromState"),
      'zip', pg_catalog.btrim(seller."shipFromPostal"),
      'country', COALESCE(seller."shipFromCountry", 'US')
    ),
    'shipTo', pg_catalog.jsonb_build_object(
      'name', pg_catalog.btrim(
        COALESCE(source_order."buyerName", source_order."quotedToName")
      ),
      'street1', pg_catalog.btrim(source_order."shipToLine1"),
      'street2', source_order."shipToLine2",
      'city', pg_catalog.btrim(source_order."shipToCity"),
      'state', pg_catalog.btrim(source_order."shipToState"),
      'zip', pg_catalog.btrim(source_order."shipToPostalCode"),
      'country', COALESCE(source_order."shipToCountry", 'US')
    )
  );
END
$grainline_order_seller_label_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_label_quote_replace(
  p_actor_user_id text,
  p_order_id text,
  p_shipment_id text,
  p_rates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_label_quote_replace$
DECLARE
  locked_order public."Order"%ROWTYPE;
  seller_id text;
  rate jsonb;
  now_utc timestamp(3) without time zone;
  quote_id text;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_shipment_id IS NULL OR p_shipment_id !~ '^[A-Za-z0-9._:-]{1,255}$'
     OR pg_catalog.jsonb_typeof(p_rates) <> 'array'
     OR pg_catalog.jsonb_array_length(p_rates) NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Order label quote input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT seller.id INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = p_actor_user_id AND NOT actor.banned AND actor."deletedAt" IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT candidate.* INTO locked_order
    FROM public."Order" AS candidate WHERE candidate.id = p_order_id
   FOR UPDATE OF candidate;
  IF NOT FOUND OR locked_order."sellerProfileId" IS DISTINCT FROM seller_id THEN RETURN NULL; END IF;

  IF locked_order."paidAt" IS NULL OR locked_order."fulfillmentStatus"::text <> 'PENDING'
     OR COALESCE(locked_order."fulfillmentMethod"::text, 'SHIPPING') <> 'SHIPPING'
     OR locked_order."labelStatus"::text = 'PURCHASED'
     OR locked_order."sellerRefundId" IS NOT NULL
     OR locked_order."sellerRefundLockedAt" IS NOT NULL
     OR locked_order."paymentRefundBlocked" OR locked_order."paymentOpenDisputeBlocked"
     OR locked_order."sellerDeauthorizedAt" IS NOT NULL
     OR locked_order."labelClaimStatus" IN (
       'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
     )
     OR EXISTS (
       SELECT 1 FROM public."Case" AS source_case
        WHERE source_case."orderId" = locked_order.id
          AND source_case.status::text IN (
            'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW'
          )
     ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'state_changed');
  END IF;

  FOR rate IN SELECT value FROM pg_catalog.jsonb_array_elements(p_rates)
  LOOP
    IF pg_catalog.jsonb_typeof(rate) <> 'object'
       OR rate->>'objectId' IS NULL OR rate->>'objectId' !~ '^[A-Za-z0-9._:-]{1,255}$'
       OR rate->>'amountCents' IS NULL OR rate->>'amountCents' !~ '^[0-9]{1,6}$'
       OR (rate->>'amountCents')::integer > 500000
       OR pg_catalog.lower(COALESCE(rate->>'currency', '')) <> pg_catalog.lower(locked_order.currency)
       OR rate->>'currency' !~ '^[A-Za-z]{3}$'
       OR pg_catalog.char_length(COALESCE(rate->>'label', '')) NOT BETWEEN 1 AND 200
       OR pg_catalog.char_length(COALESCE(rate->>'carrier', '')) > 100
       OR pg_catalog.char_length(COALESCE(rate->>'service', '')) > 100 THEN
      RAISE EXCEPTION 'Order label quote contains an invalid rate' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(DISTINCT value->>'objectId')
        FROM pg_catalog.jsonb_array_elements(p_rates))
     <> pg_catalog.jsonb_array_length(p_rates) THEN
    RAISE EXCEPTION 'Order label quote contains duplicate rates' USING ERRCODE = '22023';
  END IF;

  now_utc := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  quote_id := 'order-label-quote:' || pg_catalog.gen_random_uuid()::text;
  DELETE FROM public."OrderShippingRateQuote"
   WHERE "orderId" = locked_order.id;
  UPDATE public."Order" SET "shippoShipmentId" = p_shipment_id WHERE id = locked_order.id;
  INSERT INTO public."OrderShippingRateQuote" (
    id, "orderId", "shipmentId", rates, "expiresAt", "createdAt", "updatedAt"
  ) VALUES (
    quote_id, locked_order.id, p_shipment_id, p_rates,
    now_utc + interval '30 minutes', now_utc, now_utc
  );
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'changed', 'orderId', locked_order.id,
    'shipmentId', p_shipment_id, 'quoteId', quote_id,
    'expiresAt', now_utc + interval '30 minutes'
  );
END
$grainline_order_seller_label_quote_replace$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_label_claim(
  p_actor_user_id text,
  p_order_id text,
  p_rate_object_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_label_claim$
DECLARE
  locked_order public."Order"%ROWTYPE;
  seller_id text;
  selected_rate jsonb;
  selected_rate_id text;
  selected_amount integer;
  selected_currency text;
  claim_id text;
  claim_generation bigint;
  now_utc timestamp(3) without time zone;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_rate_object_id IS NOT NULL
       AND p_rate_object_id !~ '^[A-Za-z0-9._:-]{1,255}$') THEN
    RAISE EXCEPTION 'Order label claim input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT seller.id INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = p_actor_user_id AND NOT actor.banned AND actor."deletedAt" IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT candidate.* INTO locked_order
    FROM public."Order" AS candidate WHERE candidate.id = p_order_id
   FOR UPDATE OF candidate;
  IF NOT FOUND OR locked_order."sellerProfileId" IS DISTINCT FROM seller_id THEN RETURN NULL; END IF;

  IF locked_order."paidAt" IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'unpaid');
  END IF;
  IF locked_order."sellerRefundId" IS NOT NULL
     OR locked_order."sellerRefundLockedAt" IS NOT NULL
     OR locked_order."paymentRefundBlocked" THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'refunded');
  END IF;
  IF locked_order."paymentOpenDisputeBlocked" THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'open_dispute');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."Case" AS source_case
     WHERE source_case."orderId" = locked_order.id
       AND source_case.status::text IN (
         'OPEN', 'IN_DISCUSSION', 'PENDING_CLOSE', 'UNDER_REVIEW'
       )
  ) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'active_case');
  END IF;
  IF locked_order."sellerDeauthorizedAt" IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'conflict', 'reason', 'seller_deauthorized'
    );
  END IF;
  IF locked_order."fulfillmentStatus"::text <> 'PENDING'
     OR COALESCE(locked_order."fulfillmentMethod"::text, 'SHIPPING') <> 'SHIPPING'
     OR locked_order."labelStatus"::text = 'PURCHASED' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'state_changed');
  END IF;
  IF locked_order."labelClaimStatus" IN (
    'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS', 'PROVIDER_RECORDED'
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'conflict', 'reason', 'label_claim_active'
    );
  END IF;

  IF p_rate_object_id IS NULL THEN
    IF locked_order."shippoRateObjectId" IS NULL
       OR locked_order."shippoRateObjectId" IN ('fallback', 'pickup')
       OR locked_order."shippoRateObjectId" LIKE 'quote-only:%'
       OR locked_order."quotedShippingAmountCents" IS NULL
       OR locked_order."quotedShippingAmountCents" NOT BETWEEN 0 AND 500000
       OR locked_order."createdAt" <=
         (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - interval '5 days' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'rate_required');
    END IF;
    selected_rate_id := locked_order."shippoRateObjectId";
    selected_amount := locked_order."quotedShippingAmountCents";
    selected_currency := pg_catalog.lower(locked_order.currency);
  ELSE
    SELECT rate.value INTO selected_rate
      FROM public."OrderShippingRateQuote" AS quote
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(quote.rates) AS rate(value)
     WHERE quote."orderId" = locked_order.id
       AND quote."expiresAt" > (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
       AND rate.value->>'objectId' = p_rate_object_id
     ORDER BY quote."createdAt" DESC, quote.id DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'rate_expired');
    END IF;
    IF selected_rate->>'amountCents' !~ '^[0-9]{1,6}$'
       OR (selected_rate->>'amountCents')::integer > 500000
       OR pg_catalog.lower(COALESCE(selected_rate->>'currency', ''))
          <> pg_catalog.lower(locked_order.currency) THEN
      RAISE EXCEPTION 'Persisted Order label rate is invalid' USING ERRCODE = '22023';
    END IF;
    selected_rate_id := p_rate_object_id;
    selected_amount := (selected_rate->>'amountCents')::integer;
    selected_currency := pg_catalog.lower(selected_rate->>'currency');
  END IF;

  claim_id := 'order-label-claim:' || pg_catalog.gen_random_uuid()::text;
  claim_generation := locked_order."labelClaimGeneration" + 1;
  now_utc := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."Order"
     SET "labelClaimId" = claim_id,
         "labelClaimGeneration" = claim_generation,
         "labelClaimStatus" = 'PROVIDER_PENDING',
         "labelClaimActorUserId" = p_actor_user_id,
         "labelClaimRateObjectId" = selected_rate_id,
         "labelClaimExpectedAmountCents" = selected_amount,
         "labelClaimCurrency" = selected_currency,
         "labelClaimStartedAt" = now_utc,
         "labelClaimProviderRecordedAt" = NULL,
         "shippoRateObjectId" = selected_rate_id
   WHERE id = locked_order.id;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'claimed', 'orderId', locked_order.id,
    'claimId', claim_id, 'claimGeneration', claim_generation,
    'rateObjectId', selected_rate_id, 'amountCents', selected_amount,
    'currency', selected_currency
  );
END
$grainline_order_seller_label_claim$;

CREATE OR REPLACE FUNCTION public.grainline_order_seller_label_provider_record(
  p_actor_user_id text,
  p_order_id text,
  p_claim_id text,
  p_claim_generation bigint,
  p_outcome text,
  p_transaction_id text,
  p_label_url text,
  p_provider_rate_object_id text,
  p_amount_cents integer,
  p_currency text,
  p_carrier text,
  p_tracking_number text,
  p_error_summary text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_label_provider_record$
DECLARE
  locked_order public."Order"%ROWTYPE;
  seller_id text;
  buyer_user_id text;
  buyer_name text;
  buyer_email text;
  buyer_notification_preferences jsonb;
  now_utc timestamp(3) without time zone;
  audit_id text;
  notification_dedup_key text;
  notification_replay_material text;
  next_clawback_status text;
  next_clawback_generation bigint;
  bounded_error text;
  refund_recorded boolean := false;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_id IS NULL OR p_claim_id !~ '^order-label-claim:[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_outcome IS NULL OR p_outcome NOT IN ('REJECTED', 'AMBIGUOUS', 'SUCCESS')
     OR (p_error_summary IS NOT NULL AND pg_catalog.char_length(p_error_summary) > 500) THEN
    RAISE EXCEPTION 'Order label provider result input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT seller.id INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = p_actor_user_id AND NOT actor.banned AND actor."deletedAt" IS NULL;
  IF NOT FOUND THEN
    -- Provider success may arrive after the originating seller is disabled.
    -- Exact evidence for the already-created pending or ambiguous claim may
    -- cross that timing boundary; a disabled actor cannot release or create a
    -- claim.
    IF p_outcome <> 'SUCCESS' THEN RETURN NULL; END IF;
    SELECT candidate."sellerProfileId" INTO seller_id
      FROM public."Order" AS candidate
     WHERE candidate.id = p_order_id
       AND candidate."labelClaimId" = p_claim_id
       AND candidate."labelClaimGeneration" = p_claim_generation
       AND candidate."labelClaimActorUserId" = p_actor_user_id
       AND candidate."labelClaimStatus" IN (
         'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS'
       );
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  SELECT candidate.* INTO locked_order
    FROM public."Order" AS candidate WHERE candidate.id = p_order_id
   FOR UPDATE OF candidate;
  IF NOT FOUND OR locked_order."sellerProfileId" IS DISTINCT FROM seller_id THEN RETURN NULL; END IF;

  IF locked_order."labelClaimId" IS DISTINCT FROM p_claim_id
     OR locked_order."labelClaimGeneration" <> p_claim_generation
     OR locked_order."labelClaimActorUserId" IS DISTINCT FROM p_actor_user_id THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'stale_claim');
  END IF;

  refund_recorded := locked_order."sellerRefundId" IS NOT NULL
    OR locked_order."paymentRefundBlocked";

  now_utc := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  bounded_error := pg_catalog.left(
    pg_catalog.regexp_replace(COALESCE(p_error_summary, ''), '[[:space:]]+', ' ', 'g'),
    500
  );

  IF p_outcome = 'REJECTED' THEN
    -- Synchronous provider rejection may release only a pending claim. Once
    -- ambiguous, ordinary runtime authority cannot assert provider absence.
    IF locked_order."labelClaimStatus" <> 'PROVIDER_PENDING' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'stale_claim');
    END IF;
    UPDATE public."Order"
       SET "labelClaimId" = NULL, "labelClaimStatus" = NULL,
           "labelClaimActorUserId" = NULL, "labelClaimRateObjectId" = NULL,
           "labelClaimExpectedAmountCents" = NULL, "labelClaimCurrency" = NULL,
           "labelClaimStartedAt" = NULL, "labelClaimProviderRecordedAt" = NULL
     WHERE id = locked_order.id;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'released', 'orderId', locked_order.id
    );
  END IF;

  IF p_outcome = 'AMBIGUOUS' THEN
    IF locked_order."labelClaimStatus" <> 'PROVIDER_PENDING' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'stale_claim');
    END IF;
    UPDATE public."Order"
       SET "labelClaimStatus" = 'PROVIDER_AMBIGUOUS',
           "reviewNeeded" = true,
           "reviewNote" = pg_catalog.left(
             COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
             'AMBIGUOUS LABEL: Shippo did not return a conclusive label purchase response for claim ' ||
             p_claim_id || '. Staff must reconcile Shippo before this claim can be released.',
             10000
           )
     WHERE id = locked_order.id;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'ambiguous', 'orderId', locked_order.id,
      'claimId', p_claim_id, 'claimGeneration', p_claim_generation
    );
  END IF;

  IF locked_order."labelClaimStatus" IN ('PROVIDER_RECORDED', 'FINALIZED')
     AND locked_order."shippoTransactionId" IS NOT DISTINCT FROM p_transaction_id
     AND locked_order."labelClaimRateObjectId" IS NOT DISTINCT FROM p_provider_rate_object_id
     AND locked_order."labelCostCents" IS NOT DISTINCT FROM p_amount_cents THEN
    audit_id := pg_catalog.replace(p_claim_id, 'order-label-claim:', 'order-label-audit:');
  ELSIF locked_order."labelClaimStatus" NOT IN ('PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS') THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'stale_claim');
  ELSE
    IF p_transaction_id IS NULL OR p_transaction_id !~ '^[A-Za-z0-9._:-]{1,255}$'
       OR p_label_url IS NULL OR pg_catalog.char_length(p_label_url) > 2048
       OR p_label_url !~ '^https://[^[:space:]]+$'
       OR p_provider_rate_object_id IS DISTINCT FROM locked_order."labelClaimRateObjectId"
       OR p_amount_cents IS DISTINCT FROM locked_order."labelClaimExpectedAmountCents"
       OR pg_catalog.lower(COALESCE(p_currency, '')) IS DISTINCT FROM locked_order."labelClaimCurrency"
       OR p_carrier IS NULL OR pg_catalog.char_length(p_carrier) NOT BETWEEN 1 AND 100
       OR (p_tracking_number IS NOT NULL AND pg_catalog.char_length(p_tracking_number) > 100) THEN
      RAISE EXCEPTION 'Shippo label result does not match the fixed claim'
        USING ERRCODE = '22023';
    END IF;

    IF refund_recorded THEN
      -- Shippo has already created the label, so retain its terminal evidence.
      -- A concurrent Stripe refund makes automated fulfillment and transfer
      -- clawback unsafe; staff must reconcile and normally void the label.
      next_clawback_status := 'MANUAL_REVIEW';
      next_clawback_generation := locked_order."labelClawbackGeneration";
    ELSIF p_amount_cents = 0 THEN
      next_clawback_status := 'NOT_REQUIRED';
      next_clawback_generation := locked_order."labelClawbackGeneration";
    ELSIF locked_order."stripeTransferId" IS NULL THEN
      next_clawback_status := 'MANUAL_REVIEW';
      next_clawback_generation := locked_order."labelClawbackGeneration";
    ELSE
      next_clawback_status := 'RETRYING';
      next_clawback_generation := locked_order."labelClawbackGeneration" + 1;
    END IF;

    UPDATE public."Order"
       SET "shippoTransactionId" = p_transaction_id,
           "labelUrl" = p_label_url,
           "labelCarrier" = p_carrier,
           "labelTrackingNumber" = p_tracking_number,
           "labelCostCents" = p_amount_cents,
           "labelStatus" = 'PURCHASED'::public."LabelStatus",
           "labelPurchasedAt" = now_utc,
           "fulfillmentMethod" = CASE WHEN refund_recorded
             THEN "fulfillmentMethod" ELSE 'SHIPPING'::public."FulfillmentMethod" END,
           "fulfillmentStatus" = CASE WHEN refund_recorded
             THEN "fulfillmentStatus" ELSE 'SHIPPED'::public."FulfillmentStatus" END,
           "shippedAt" = CASE WHEN refund_recorded THEN "shippedAt" ELSE now_utc END,
           "trackingCarrier" = CASE WHEN refund_recorded
             THEN "trackingCarrier" ELSE p_carrier END,
           "trackingNumber" = CASE WHEN refund_recorded
             THEN "trackingNumber" ELSE p_tracking_number END,
           "labelClaimStatus" = CASE
             WHEN next_clawback_status IN ('NOT_REQUIRED', 'MANUAL_REVIEW') THEN 'FINALIZED'
             ELSE 'PROVIDER_RECORDED'
           END,
           "labelClaimProviderRecordedAt" = now_utc,
           "labelClawbackStatus" = next_clawback_status,
           "labelClawbackGeneration" = next_clawback_generation,
           "labelClawbackRetryCount" = CASE WHEN next_clawback_status = 'RETRYING' THEN 1 ELSE 0 END,
           "labelClawbackLastAttemptAt" = CASE WHEN next_clawback_status = 'RETRYING' THEN now_utc ELSE NULL END,
           "labelClawbackNextAttemptAt" = NULL,
           "labelClawbackResolvedAt" = CASE WHEN next_clawback_status = 'NOT_REQUIRED' THEN now_utc ELSE NULL END,
           "labelClawbackReversalId" = NULL,
           "reviewNeeded" = CASE WHEN next_clawback_status = 'MANUAL_REVIEW' THEN true ELSE "reviewNeeded" END,
           "reviewNote" = CASE WHEN refund_recorded THEN
             pg_catalog.left(
               COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
               'Shippo label ' || p_transaction_id || ' was purchased while this Order was already refunded. ' ||
               'The Order was not marked shipped and no automatic transfer clawback was attempted. ' ||
               'Staff must reconcile and normally void the label.',
               10000
             )
           WHEN next_clawback_status = 'MANUAL_REVIEW' THEN
             pg_catalog.left(
               COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
               'Shippo label ' || p_transaction_id || ' cost ' || p_amount_cents::text ||
               ' ' || pg_catalog.upper(p_currency) ||
               ', but this Order has no Stripe transfer. Staff must reconcile the seller payout.',
               10000
             ) ELSE "reviewNote" END
     WHERE id = locked_order.id;

    audit_id := pg_catalog.replace(p_claim_id, 'order-label-claim:', 'order-label-audit:');
    INSERT INTO public."SystemAuditLog" (
      id, "actorType", "actorId", action, "targetType", "targetId", metadata, "createdAt"
    ) VALUES (
      audit_id, 'user', p_actor_user_id,
      CASE WHEN refund_recorded THEN 'ORDER_LABEL_REFUND_RACE_RECORDED'
        ELSE 'ORDER_FULFILLMENT_TRANSITION' END,
      'ORDER', locked_order.id,
      pg_catalog.jsonb_build_object(
        'action', CASE WHEN refund_recorded THEN 'label_refund_race' ELSE 'shipped' END,
        'newStatus', CASE WHEN refund_recorded
          THEN locked_order."fulfillmentStatus"::text ELSE 'SHIPPED' END,
        'trackingCarrier', p_carrier,
        'claimId', p_claim_id, 'claimGeneration', p_claim_generation,
        'rateObjectId', p_provider_rate_object_id, 'amountCents', p_amount_cents,
        'currency', pg_catalog.lower(p_currency), 'transactionId', p_transaction_id,
        'carrier', p_carrier, 'hasTrackingNumber', p_tracking_number IS NOT NULL
      ), now_utc
    );
  END IF;

  SELECT buyer.id, buyer.name, buyer.email, buyer."notificationPreferences"
    INTO buyer_user_id, buyer_name, buyer_email, buyer_notification_preferences
    FROM public."User" AS buyer
   WHERE buyer.id = locked_order."buyerId" AND NOT buyer.banned AND buyer."deletedAt" IS NULL
   FOR SHARE OF buyer;

  -- This label-specific notification is inserted by the same fixed operation
  -- that owns the durable fulfillment transition. The generic Notification
  -- order-family function intentionally still derives seller identity through
  -- mutable Listing rows, so calling it here would let later Listing ownership
  -- drift roll back a valid label purchase. Use the immutable Order seller key,
  -- derive every payload field here, and retain the existing preference and
  -- replay semantics without exposing generic Notification INSERT authority.
  IF NOT refund_recorded
     AND FOUND
     AND buyer_notification_preferences -> 'ORDER_SHIPPED' IS DISTINCT FROM 'false'::jsonb THEN
    notification_replay_material := pg_catalog.concat_ws(
      pg_catalog.chr(31),
      'grainline-notification-v1',
      buyer_user_id,
      'ORDER_SHIPPED',
      'order_fulfillment',
      audit_id,
      p_actor_user_id
    );
    notification_dedup_key :=
      pg_catalog.md5(notification_replay_material)
      || pg_catalog.md5('grainline-notification-v1-secondary' || notification_replay_material);

    INSERT INTO public."Notification" (
      id, "userId", "relatedUserId", type, title, body, link,
      "sourceType", "sourceId", "dedupKey", read, "createdAt"
    ) VALUES (
      pg_catalog.gen_random_uuid()::text,
      buyer_user_id,
      p_actor_user_id,
      'ORDER_SHIPPED'::public."NotificationType",
      'Your piece is on its way!',
      'Shipped via ' || p_carrier,
      '/dashboard/orders/' || locked_order.id,
      'order_fulfillment',
      audit_id,
      notification_dedup_key,
      false,
      pg_catalog.clock_timestamp()
    ) ON CONFLICT ("userId", type, "dedupKey") DO NOTHING;
  END IF;

  SELECT candidate.* INTO locked_order FROM public."Order" AS candidate
   WHERE candidate.id = p_order_id;
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'recorded', 'orderId', locked_order.id,
    'claimId', locked_order."labelClaimId",
    'claimGeneration', locked_order."labelClaimGeneration",
    'clawbackGeneration', locked_order."labelClawbackGeneration",
    'clawbackStatus', locked_order."labelClawbackStatus",
    'stripeTransferId', locked_order."stripeTransferId",
    'transactionId', locked_order."shippoTransactionId",
    'rateObjectId', locked_order."labelClaimRateObjectId",
    'amountCents', locked_order."labelCostCents",
    'currency', locked_order."labelClaimCurrency",
    'carrier', locked_order."labelCarrier",
    'trackingNumber', locked_order."labelTrackingNumber",
    'labelPurchasedAt', locked_order."labelPurchasedAt",
    'fulfillmentStatus', locked_order."fulfillmentStatus"::text,
    'auditLogId', audit_id,
    'buyerUserId', buyer_user_id, 'buyerName', buyer_name, 'buyerEmail', buyer_email,
    'estimatedDeliveryDate', locked_order."estimatedDeliveryDate"
  );
END
$grainline_order_seller_label_provider_record$;

-- Retain the separately reviewed NULL-outcome correction when composing this
-- later label successor. PostgreSQL's three-valued logic otherwise lets NULL
-- bypass NOT IN and mutate retry/review state as though the provider failed.
CREATE OR REPLACE FUNCTION public.grainline_order_label_clawback_finalize(
  p_order_id text,
  p_claim_id text,
  p_claim_generation bigint,
  p_clawback_generation bigint,
  p_outcome text,
  p_reversal_id text,
  p_error_summary text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_label_clawback_finalize$
DECLARE
  locked_order public."Order"%ROWTYPE;
  now_utc timestamp(3) without time zone;
  next_status text;
  next_attempt timestamp(3) without time zone;
  bounded_error text;
BEGIN
  IF p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_id IS NULL OR p_claim_id !~ '^order-label-claim:[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_clawback_generation IS NULL OR p_clawback_generation < 1
     OR p_outcome IS NULL OR p_outcome NOT IN ('SUCCESS', 'FAILED')
     OR (p_reversal_id IS NOT NULL AND p_reversal_id !~ '^[A-Za-z0-9._:-]{1,255}$')
     OR (p_error_summary IS NOT NULL AND pg_catalog.char_length(p_error_summary) > 500)
     OR (p_outcome = 'SUCCESS' AND p_reversal_id IS NULL) THEN
    RAISE EXCEPTION 'Order label clawback result input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT candidate.* INTO locked_order
    FROM public."Order" AS candidate WHERE candidate.id = p_order_id
   FOR UPDATE OF candidate;
  IF NOT FOUND
     OR locked_order."labelClaimId" IS DISTINCT FROM p_claim_id
     OR locked_order."labelClaimGeneration" <> p_claim_generation
     OR locked_order."labelClawbackGeneration" <> p_clawback_generation
     OR locked_order."labelClaimStatus" <> 'PROVIDER_RECORDED'
     OR locked_order."labelClawbackStatus" <> 'RETRYING' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'stale_claim');
  END IF;

  now_utc := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  IF p_outcome = 'SUCCESS' THEN
    UPDATE public."Order"
       SET "labelClawbackStatus" = 'REVERSED',
           "labelClawbackReversalId" = p_reversal_id,
           "labelClawbackLastAttemptAt" = now_utc,
           "labelClawbackNextAttemptAt" = NULL,
           "labelClawbackResolvedAt" = now_utc,
           "labelClaimStatus" = 'FINALIZED'
     WHERE id = locked_order.id;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'finalized', 'orderId', locked_order.id,
      'clawbackStatus', 'REVERSED'
    );
  END IF;

  bounded_error := pg_catalog.left(
    pg_catalog.regexp_replace(COALESCE(p_error_summary, 'Unknown Stripe reversal error'),
      '[[:space:]]+', ' ', 'g'), 500
  );
  IF locked_order."labelClawbackRetryCount" >= 5 THEN
    next_status := 'MANUAL_REVIEW';
    next_attempt := NULL;
  ELSE
    next_status := 'RETRY_PENDING';
    next_attempt := now_utc + CASE locked_order."labelClawbackRetryCount"
      WHEN 1 THEN interval '15 minutes'
      WHEN 2 THEN interval '1 hour'
      WHEN 3 THEN interval '6 hours'
      ELSE interval '24 hours'
    END;
  END IF;

  UPDATE public."Order"
     SET "labelClawbackStatus" = next_status,
         "labelClawbackLastAttemptAt" = now_utc,
         "labelClawbackNextAttemptAt" = next_attempt,
         "labelClawbackResolvedAt" = NULL,
         "reviewNeeded" = true,
         "reviewNote" = pg_catalog.left(
           COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
           'Shippo label ' || COALESCE("shippoTransactionId", 'unknown') ||
           ' cost ' || COALESCE("labelCostCents", 0)::text || ' ' ||
           pg_catalog.upper(currency) ||
           ', but Stripe transfer reversal failed. Stripe error: ' || bounded_error ||
           '. Staff must retry or manually reconcile the seller payout.',
           10000
         ),
         "labelClaimStatus" = CASE
           WHEN next_status = 'MANUAL_REVIEW' THEN 'FINALIZED'
           ELSE "labelClaimStatus"
         END
   WHERE id = locked_order.id;

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'recorded_failure', 'orderId', locked_order.id,
    'clawbackStatus', next_status, 'nextAttemptAt', next_attempt
  );
END
$grainline_order_label_clawback_finalize$;

COMMIT;
