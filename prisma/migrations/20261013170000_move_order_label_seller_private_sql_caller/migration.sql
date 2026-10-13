-- Move the seller label preflight's ship-from and default-package reads to
-- the SellerProfile private companion. Order, refund, dispute, Case, label and
-- package-source semantics remain unchanged; signature, owner and grants stay.

BEGIN;

DO $order_label_seller_private_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."SellerProfilePrivate"') IS NULL THEN
    RAISE EXCEPTION 'SellerProfilePrivate table is missing';
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.grainline_order_seller_label_preflight(text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'order seller label preflight predecessor is missing';
  END IF;
END
$order_label_seller_private_preflight$;

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
  seller_private public."SellerProfilePrivate"%ROWTYPE;
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

  SELECT source_private.* INTO seller_private
    FROM public."SellerProfilePrivate" AS source_private
   WHERE source_private."sellerProfileId" = seller.id;
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
  IF public.grainline_order_refund_blocks_fulfillment(
      source_order.id,
      source_order."sellerRefundId",
      source_order."sellerRefundLockedAt",
      source_order."paymentRefundBlocked",
      source_order."sellerRefundAmountCents",
      COALESCE(
      source_order."chargedTotalCents",
      COALESCE(source_order."itemsSubtotalCents", 0)
        + COALESCE(source_order."shippingAmountCents", 0)
        + COALESCE(source_order."giftWrappingPriceCents", 0)
        + COALESCE(source_order."taxAmountCents", 0)
    )
    ) THEN
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
     OR NULLIF(pg_catalog.btrim(seller_private."shipFromLine1"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(seller_private."shipFromCity"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(seller_private."shipFromState"), '') IS NULL
     OR NULLIF(pg_catalog.btrim(seller_private."shipFromPostal"), '') IS NULL
     OR COALESCE(seller_private."shipFromCountry", 'US') !~ '^[A-Za-z]{2}$'
     OR NULLIF(pg_catalog.btrim(seller_private."shipFromPhone"), '') IS NULL
     OR seller_private."shipFromPhone" !~ '^[+][1-9][0-9]{7,14}$'
     OR NULLIF(pg_catalog.btrim(
       COALESCE(seller_private."shipFromName", seller."displayName", '')
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
               AND COALESCE(listing."packagedWeightGrams", seller_private."defaultPkgWeightGrams") > 0
               AND COALESCE(listing."packagedWeightGrams", seller_private."defaultPkgWeightGrams") <= 500000
               AND COALESCE(listing."packagedLengthCm", seller_private."defaultPkgLengthCm") > 0
               AND COALESCE(listing."packagedLengthCm", seller_private."defaultPkgLengthCm") <= 1000
               AND COALESCE(listing."packagedWidthCm", seller_private."defaultPkgWidthCm") > 0
               AND COALESCE(listing."packagedWidthCm", seller_private."defaultPkgWidthCm") <= 1000
               AND COALESCE(listing."packagedHeightCm", seller_private."defaultPkgHeightCm") > 0
               AND COALESCE(listing."packagedHeightCm", seller_private."defaultPkgHeightCm") <= 1000
           )::integer,
      pg_catalog.sum(COALESCE(listing."packagedWeightGrams", seller_private."defaultPkgWeightGrams")::numeric * item.quantity),
      pg_catalog.max(COALESCE(listing."packagedLengthCm", seller_private."defaultPkgLengthCm")::numeric),
      pg_catalog.max(COALESCE(listing."packagedWidthCm", seller_private."defaultPkgWidthCm")::numeric),
      pg_catalog.max(COALESCE(listing."packagedHeightCm", seller_private."defaultPkgHeightCm")::numeric)
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
      'name', COALESCE(NULLIF(pg_catalog.btrim(seller_private."shipFromName"), ''),
        pg_catalog.btrim(seller."displayName")),
      'street1', pg_catalog.btrim(seller_private."shipFromLine1"),
      'street2', seller_private."shipFromLine2",
      'city', pg_catalog.btrim(seller_private."shipFromCity"),
      'state', pg_catalog.btrim(seller_private."shipFromState"),
      'zip', pg_catalog.btrim(seller_private."shipFromPostal"),
      'country', COALESCE(seller_private."shipFromCountry", 'US'),
      'phone', pg_catalog.btrim(seller_private."shipFromPhone")
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

COMMIT;
