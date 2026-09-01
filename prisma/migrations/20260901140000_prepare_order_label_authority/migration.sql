-- Compatible fixed authority for seller label rating, purchase, provider
-- recording, label-cost clawback recovery, and authenticated label retrieval.
-- This migration changes no RLS posture or table grants. Existing direct app
-- access remains compatible until the application is converted and a later,
-- separately reviewed Order activation release revokes it.

BEGIN;

ALTER TABLE public."Order"
  ADD COLUMN "labelClaimId" varchar(255),
  ADD COLUMN "labelClaimGeneration" bigint NOT NULL DEFAULT 0,
  ADD COLUMN "labelClaimStatus" varchar(32),
  ADD COLUMN "labelClaimActorUserId" varchar(191),
  ADD COLUMN "labelClaimRateObjectId" varchar(255),
  ADD COLUMN "labelClaimExpectedAmountCents" integer,
  ADD COLUMN "labelClaimCurrency" varchar(3),
  ADD COLUMN "labelClaimStartedAt" timestamp(3) without time zone,
  ADD COLUMN "labelClaimProviderRecordedAt" timestamp(3) without time zone,
  ADD COLUMN "labelClawbackGeneration" bigint NOT NULL DEFAULT 0;

ALTER TABLE public."Order"
  ADD CONSTRAINT "Order_labelClaimGeneration_nonnegative_check"
    CHECK ("labelClaimGeneration" >= 0),
  ADD CONSTRAINT "Order_labelClawbackGeneration_nonnegative_check"
    CHECK ("labelClawbackGeneration" >= 0),
  ADD CONSTRAINT "Order_labelClaimStatus_check"
    CHECK (
      "labelClaimStatus" IS NULL OR "labelClaimStatus" IN (
        'PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS',
        'PROVIDER_RECORDED', 'FINALIZED'
      )
    ),
  ADD CONSTRAINT "Order_labelClaim_tuple_check"
    CHECK (
      (
        "labelClaimStatus" IS NULL
        AND "labelClaimId" IS NULL
        AND "labelClaimActorUserId" IS NULL
        AND "labelClaimRateObjectId" IS NULL
        AND "labelClaimExpectedAmountCents" IS NULL
        AND "labelClaimCurrency" IS NULL
        AND "labelClaimStartedAt" IS NULL
        AND "labelClaimProviderRecordedAt" IS NULL
      ) OR (
        "labelClaimStatus" IS NOT NULL
        AND "labelClaimId" IS NOT NULL
        AND "labelClaimActorUserId" IS NOT NULL
        AND "labelClaimRateObjectId" IS NOT NULL
        AND "labelClaimExpectedAmountCents" BETWEEN 0 AND 500000
        AND "labelClaimCurrency" ~ '^[a-z]{3}$'
        AND "labelClaimStartedAt" IS NOT NULL
        AND (
          ("labelClaimStatus" IN ('PROVIDER_PENDING', 'PROVIDER_AMBIGUOUS')
            AND "labelClaimProviderRecordedAt" IS NULL)
          OR
          ("labelClaimStatus" IN ('PROVIDER_RECORDED', 'FINALIZED')
            AND "labelClaimProviderRecordedAt" IS NOT NULL)
        )
      )
    );

CREATE UNIQUE INDEX "Order_labelClaimId_key"
  ON public."Order" ("labelClaimId")
  WHERE "labelClaimId" IS NOT NULL;
CREATE UNIQUE INDEX "Order_shippoTransactionId_key"
  ON public."Order" ("shippoTransactionId")
  WHERE "shippoTransactionId" IS NOT NULL;
CREATE INDEX "Order_labelClaimId_labelClaimGeneration_idx"
  ON public."Order" ("labelClaimId", "labelClaimGeneration");

CREATE FUNCTION public.grainline_order_seller_label_preflight(
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
  IF source_order."reviewNeeded"
     AND COALESCE(source_order."reviewNote", '') LIKE
       'Seller Stripe account was deauthorized after payment.%' THEN
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

CREATE FUNCTION public.grainline_order_seller_label_quote_replace(
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
     OR (locked_order."reviewNeeded" AND COALESCE(locked_order."reviewNote", '') LIKE
       'Seller Stripe account was deauthorized after payment.%')
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

CREATE FUNCTION public.grainline_order_seller_label_claim(
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
  IF locked_order."reviewNeeded"
     AND COALESCE(locked_order."reviewNote", '') LIKE
       'Seller Stripe account was deauthorized after payment.%' THEN
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

CREATE FUNCTION public.grainline_order_seller_label_provider_record(
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
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_id IS NULL OR p_claim_id !~ '^order-label-claim:[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_outcome NOT IN ('REJECTED', 'AMBIGUOUS', 'SUCCESS')
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

    IF p_amount_cents = 0 THEN
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
           "fulfillmentMethod" = 'SHIPPING'::public."FulfillmentMethod",
           "fulfillmentStatus" = 'SHIPPED'::public."FulfillmentStatus",
           "shippedAt" = now_utc,
           "trackingCarrier" = p_carrier,
           "trackingNumber" = p_tracking_number,
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
           "reviewNote" = CASE WHEN next_clawback_status = 'MANUAL_REVIEW' THEN
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
      audit_id, 'user', p_actor_user_id, 'ORDER_FULFILLMENT_TRANSITION', 'ORDER', locked_order.id,
      pg_catalog.jsonb_build_object(
        'action', 'shipped', 'newStatus', 'SHIPPED',
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
  IF FOUND
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
    'auditLogId', audit_id,
    'buyerUserId', buyer_user_id, 'buyerName', buyer_name, 'buyerEmail', buyer_email,
    'estimatedDeliveryDate', locked_order."estimatedDeliveryDate"
  );
END
$grainline_order_seller_label_provider_record$;

CREATE FUNCTION public.grainline_order_label_clawback_finalize(
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
     OR p_outcome NOT IN ('SUCCESS', 'FAILED')
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

CREATE FUNCTION public.grainline_order_label_clawback_claim_batch(
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
    'attemptCount', updated."labelClawbackRetryCount"
  ) ORDER BY updated."labelPurchasedAt", updated."createdAt", updated.id), '[]'::jsonb)
    INTO claimed
    FROM updated;

  RETURN claimed;
END
$grainline_order_label_clawback_claim_batch$;

CREATE FUNCTION public.grainline_order_seller_label_download(
  p_actor_user_id text,
  p_order_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_label_download$
  SELECT CASE
    WHEN actor.id IS NULL OR seller.id IS NULL OR source_order.id IS NULL THEN NULL
    WHEN source_order."labelStatus"::text <> 'PURCHASED'
      OR source_order."shippoTransactionId" IS NULL
      OR source_order."labelClaimRateObjectId" IS NULL
      OR source_order."labelCostCents" IS NULL
      OR source_order."labelClaimCurrency" IS NULL THEN
      pg_catalog.jsonb_build_object('outcome', 'conflict', 'reason', 'label_unavailable')
    ELSE pg_catalog.jsonb_build_object(
      'outcome', 'ready', 'orderId', source_order.id,
      'transactionId', source_order."shippoTransactionId",
      'rateObjectId', source_order."labelClaimRateObjectId",
      'amountCents', source_order."labelCostCents",
      'currency', source_order."labelClaimCurrency"
    )
  END
  FROM (SELECT 1) AS anchor
  LEFT JOIN public."User" AS actor
    ON actor.id = p_actor_user_id
   AND p_actor_user_id ~ '^[A-Za-z0-9._:-]{1,128}$'
   AND NOT actor.banned AND actor."deletedAt" IS NULL
  LEFT JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
  LEFT JOIN public."Order" AS source_order
    ON source_order.id = p_order_id
   AND p_order_id ~ '^[A-Za-z0-9._:-]{1,191}$'
   AND source_order."sellerProfileId" = seller.id
$grainline_order_seller_label_download$;

-- Owner-invoked staff reconciliation reads only one exact ambiguous claim.
-- Ordinary runtime receives no EXECUTE on either private function below.
CREATE FUNCTION public.grainline_order_label_ambiguous_claim_read(
  p_staff_user_id text,
  p_order_id text,
  p_claim_id text,
  p_claim_generation bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_label_ambiguous_claim_read$
DECLARE
  source_order public."Order"%ROWTYPE;
  release_audit public."SystemAuditLog"%ROWTYPE;
  release_audit_id text;
BEGIN
  IF p_staff_user_id IS NULL
     OR p_staff_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_id IS NULL
     OR p_claim_id !~ '^order-label-claim:[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1 THEN
    RAISE EXCEPTION 'Order label ambiguous read input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."User" AS staff
     WHERE staff.id = p_staff_user_id
       AND NOT staff.banned AND staff."deletedAt" IS NULL
       AND staff.role::text IN ('EMPLOYEE', 'ADMIN')
  ) THEN RETURN NULL; END IF;

  SELECT candidate.* INTO source_order
    FROM public."Order" AS candidate
   WHERE candidate.id = p_order_id
     AND candidate."labelClaimId" = p_claim_id
     AND candidate."labelClaimGeneration" = p_claim_generation;
  IF FOUND THEN
    IF source_order."labelClaimStatus" = 'PROVIDER_AMBIGUOUS' THEN
      RETURN pg_catalog.jsonb_build_object(
        'outcome', 'ready',
        'orderId', source_order.id,
        'claimId', source_order."labelClaimId",
        'claimGeneration', source_order."labelClaimGeneration",
        'sellerActorUserId', source_order."labelClaimActorUserId",
        'rateObjectId', source_order."labelClaimRateObjectId",
        'amountCents', source_order."labelClaimExpectedAmountCents",
        'currency', source_order."labelClaimCurrency",
        'claimStartedAtEpochMillis',
          pg_catalog.floor(
            EXTRACT(epoch FROM source_order."labelClaimStartedAt") * 1000
          )::bigint
      );
    END IF;
    IF source_order."labelClaimStatus" IN ('PROVIDER_RECORDED', 'FINALIZED')
       AND source_order."labelStatus"::text = 'PURCHASED'
       AND source_order."shippoTransactionId" IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object(
        'outcome', 'recorded',
        'orderId', source_order.id,
        'claimId', source_order."labelClaimId",
        'claimGeneration', source_order."labelClaimGeneration",
        'sellerActorUserId', source_order."labelClaimActorUserId",
        'rateObjectId', source_order."labelClaimRateObjectId",
        'amountCents', source_order."labelCostCents",
        'currency', source_order."labelClaimCurrency",
        'transactionId', source_order."shippoTransactionId",
        'clawbackGeneration', source_order."labelClawbackGeneration",
        'clawbackStatus', source_order."labelClawbackStatus",
        'stripeTransferId', source_order."stripeTransferId"
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'conflict', 'reason', 'claim_state_changed'
    );
  END IF;

  release_audit_id := pg_catalog.replace(
    p_claim_id,
    'order-label-claim:',
    'order-label-ambiguous-release:'
  );
  SELECT candidate.* INTO release_audit
    FROM public."SystemAuditLog" AS candidate
   WHERE candidate.id = release_audit_id
     AND candidate.action = 'ORDER_LABEL_AMBIGUOUS_RELEASED'
     AND candidate."targetType" = 'ORDER'
     AND candidate."targetId" = p_order_id
     AND candidate.metadata->>'claimId' = p_claim_id
     AND candidate.metadata->>'claimGeneration' = p_claim_generation::text
     AND candidate.metadata->>'resolution' = 'PROVIDER_ERROR'
     AND candidate.metadata->>'providerScanSha256' ~ '^[0-9a-f]{64}$';
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'released',
      'orderId', p_order_id,
      'claimId', p_claim_id,
      'claimGeneration', p_claim_generation,
      'resolution', release_audit.metadata->>'resolution',
      'providerScanSha256', release_audit.metadata->>'providerScanSha256',
      'auditLogId', release_audit.id
    );
  END IF;

  RETURN NULL;
END
$grainline_order_label_ambiguous_claim_read$;

CREATE FUNCTION public.grainline_order_label_ambiguous_release(
  p_staff_user_id text,
  p_order_id text,
  p_claim_id text,
  p_claim_generation bigint,
  p_resolution text,
  p_provider_scan_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_label_ambiguous_release$
DECLARE
  locked_order public."Order"%ROWTYPE;
  audit_id text;
  now_utc timestamp(3) without time zone;
BEGIN
  IF p_staff_user_id IS NULL
     OR p_staff_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_id IS NULL
     OR p_claim_id !~ '^order-label-claim:[0-9a-f-]{36}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_resolution <> 'PROVIDER_ERROR'
     OR p_provider_scan_sha256 IS NULL
     OR p_provider_scan_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Order label ambiguous release input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."User" AS staff
     WHERE staff.id = p_staff_user_id
       AND NOT staff.banned AND staff."deletedAt" IS NULL
       AND staff.role::text IN ('EMPLOYEE', 'ADMIN')
  ) THEN RETURN NULL; END IF;

  SELECT candidate.* INTO locked_order
    FROM public."Order" AS candidate
   WHERE candidate.id = p_order_id
   FOR UPDATE OF candidate;
  IF NOT FOUND
     OR locked_order."labelClaimId" IS DISTINCT FROM p_claim_id
     OR locked_order."labelClaimGeneration" <> p_claim_generation
     OR locked_order."labelClaimStatus" <> 'PROVIDER_AMBIGUOUS'
     OR locked_order."shippoTransactionId" IS NOT NULL
     OR locked_order."labelStatus"::text = 'PURCHASED' THEN
    RETURN pg_catalog.jsonb_build_object(
      'outcome', 'conflict', 'reason', 'stale_claim'
    );
  END IF;
  now_utc := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  audit_id := pg_catalog.replace(
    p_claim_id,
    'order-label-claim:',
    'order-label-ambiguous-release:'
  );
  UPDATE public."Order"
     SET "labelClaimId" = NULL,
         "labelClaimStatus" = NULL,
         "labelClaimActorUserId" = NULL,
         "labelClaimRateObjectId" = NULL,
         "labelClaimExpectedAmountCents" = NULL,
         "labelClaimCurrency" = NULL,
         "labelClaimStartedAt" = NULL,
         "labelClaimProviderRecordedAt" = NULL,
         "reviewNeeded" = true,
         "reviewNote" = pg_catalog.left(
           COALESCE(NULLIF("reviewNote", '') || E'\n\n', '') ||
           'AMBIGUOUS LABEL RESOLVED: Shippo returned an exact ERROR transaction for claim ' ||
           p_claim_id || '. Evidence SHA-256 ' || p_provider_scan_sha256 || '.',
           10000
         )
   WHERE id = locked_order.id;

  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId",
    reason, metadata, "createdAt"
  ) VALUES (
    audit_id, 'database_operator', session_user,
    'ORDER_LABEL_AMBIGUOUS_RELEASED',
    'ORDER', locked_order.id,
    'Exact Shippo transaction ended in ERROR',
    pg_catalog.jsonb_build_object(
      'authorizingStaffUserId', p_staff_user_id,
      'claimId', p_claim_id,
      'claimGeneration', p_claim_generation,
      'databaseSessionUser', session_user,
      'resolution', p_resolution,
      'providerScanSha256', p_provider_scan_sha256
    ), now_utc
  );

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'released', 'orderId', locked_order.id,
    'auditLogId', audit_id
  );
END
$grainline_order_label_ambiguous_release$;

-- Seller order detail v4 keeps the compatible v3 participant, purge and
-- historical-snapshot decisions while removing the stored signed label URL
-- from the ordinary runtime projection. Sellers retrieve a fresh provider URL
-- only through grainline_order_seller_label_download after actor-bound proof.
CREATE FUNCTION public.grainline_order_seller_detail_v4(
  p_actor_user_id text,
  p_order_id text
)
RETURNS TABLE(
  order_id text,
  created_at_epoch_millis bigint,
  paid_at_epoch_millis bigint,
  currency text,
  items_subtotal_cents integer,
  shipping_title text,
  shipping_amount_cents integer,
  tax_amount_cents integer,
  fulfillment_method text,
  fulfillment_status text,
  tracking_carrier text,
  tracking_number text,
  pickup_ready_at_epoch_millis bigint,
  picked_up_at_epoch_millis bigint,
  shipped_at_epoch_millis bigint,
  delivered_at_epoch_millis bigint,
  estimated_delivery_at_epoch_millis bigint,
  processing_deadline_epoch_millis bigint,
  shipping_carrier text,
  shipping_service text,
  review_needed boolean,
  deauthorized_review_hold boolean,
  gift_note text,
  gift_wrapping boolean,
  gift_wrapping_price_cents integer,
  buyer_data_purged_at_epoch_millis bigint,
  ship_to_line_1 text,
  ship_to_line_2 text,
  ship_to_city text,
  ship_to_state text,
  ship_to_postal_code text,
  ship_to_country text,
  buyer_id text,
  buyer_name text,
  buyer_email text,
  buyer_deleted_at_epoch_millis bigint,
  seller_notes text,
  seller_refund_state text,
  seller_refund_amount_cents integer,
  label_status text,
  label_carrier text,
  label_tracking_number text,
  label_purchased_at_epoch_millis bigint,
  items jsonb
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_detail_v4$
  SELECT
    detail.order_id,
    detail.created_at_epoch_millis,
    detail.paid_at_epoch_millis,
    detail.currency,
    detail.items_subtotal_cents,
    detail.shipping_title,
    detail.shipping_amount_cents,
    detail.tax_amount_cents,
    detail.fulfillment_method,
    detail.fulfillment_status,
    detail.tracking_carrier,
    detail.tracking_number,
    detail.pickup_ready_at_epoch_millis,
    detail.picked_up_at_epoch_millis,
    detail.shipped_at_epoch_millis,
    detail.delivered_at_epoch_millis,
    detail.estimated_delivery_at_epoch_millis,
    detail.processing_deadline_epoch_millis,
    detail.shipping_carrier,
    detail.shipping_service,
    detail.review_needed,
    detail.deauthorized_review_hold,
    detail.gift_note,
    detail.gift_wrapping,
    detail.gift_wrapping_price_cents,
    detail.buyer_data_purged_at_epoch_millis,
    detail.ship_to_line_1,
    detail.ship_to_line_2,
    detail.ship_to_city,
    detail.ship_to_state,
    detail.ship_to_postal_code,
    detail.ship_to_country,
    detail.buyer_id,
    detail.buyer_name,
    detail.buyer_email,
    detail.buyer_deleted_at_epoch_millis,
    detail.seller_notes,
    detail.seller_refund_state,
    detail.seller_refund_amount_cents,
    detail.label_status,
    detail.label_carrier,
    detail.label_tracking_number,
    detail.label_purchased_at_epoch_millis,
    detail.items
  FROM public.grainline_order_seller_detail_v3(p_actor_user_id, p_order_id) AS detail;
$grainline_order_seller_detail_v4$;

REVOKE ALL ON FUNCTION public.grainline_order_seller_label_preflight(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_label_quote_replace(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_label_claim(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_label_provider_record(
  text, text, text, bigint, text, text, text, text, integer, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_label_clawback_finalize(
  text, text, bigint, bigint, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_label_clawback_claim_batch(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_label_download(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_seller_detail_v4(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_label_ambiguous_claim_read(
  text, text, text, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_order_label_ambiguous_release(
  text, text, text, bigint, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_order_seller_label_preflight(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_label_quote_replace(text, text, text, jsonb)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_label_claim(text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_label_provider_record(
  text, text, text, bigint, text, text, text, text, integer, text, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_label_clawback_finalize(
  text, text, bigint, bigint, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_label_clawback_claim_batch(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_label_download(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_detail_v4(text, text)
  TO grainline_app_runtime;

COMMIT;
