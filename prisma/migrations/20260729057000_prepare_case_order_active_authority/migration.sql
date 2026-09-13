-- Compatible Case-aware Order guards. These functions add no policy, table
-- grant or RLS state change. The old direct Case reads and these fixed
-- operations can coexist until the application conversion.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_case_order_active_for_buyer(
  p_actor_user_id text,
  p_order_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_order_active_for_buyer$
DECLARE
  actor_authorized boolean;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'Buyer active-Case guard input is invalid'
      USING ERRCODE = '22023';
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM public."User" AS actor
      INNER JOIN public."Order" AS order_row
        ON order_row."buyerId" = actor.id
     WHERE actor.id = p_actor_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
       AND order_row.id = p_order_id
  )
    INTO actor_authorized;
  IF NOT actor_authorized THEN
    RETURN NULL;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public."Case" AS case_row
     WHERE case_row."orderId" = p_order_id
       AND case_row.status IN (
         'OPEN'::public."CaseStatus",
         'IN_DISCUSSION'::public."CaseStatus",
         'PENDING_CLOSE'::public."CaseStatus",
         'UNDER_REVIEW'::public."CaseStatus"
       )
  );
END
$grainline_case_order_active_for_buyer$;

CREATE OR REPLACE FUNCTION public.grainline_case_order_active_for_seller(
  p_actor_user_id text,
  p_order_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_order_active_for_seller$
DECLARE
  actor_authorized boolean;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'Seller active-Case guard input is invalid'
      USING ERRCODE = '22023';
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM public."User" AS actor
      INNER JOIN public."SellerProfile" AS seller
        ON seller."userId" = actor.id
      INNER JOIN public."Order" AS order_row
        ON order_row.id = p_order_id
     WHERE actor.id = p_actor_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
       AND EXISTS (
         SELECT 1
           FROM public."OrderItem" AS order_item
          WHERE order_item."orderId" = order_row.id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public."OrderItem" AS order_item
           INNER JOIN public."Listing" AS listing
             ON listing.id = order_item."listingId"
          WHERE order_item."orderId" = order_row.id
            AND listing."sellerId" <> seller.id
       )
  )
    INTO actor_authorized;
  IF NOT actor_authorized THEN
    RETURN NULL;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public."Case" AS case_row
     WHERE case_row."orderId" = p_order_id
       AND case_row.status IN (
         'OPEN'::public."CaseStatus",
         'IN_DISCUSSION'::public."CaseStatus",
         'PENDING_CLOSE'::public."CaseStatus",
         'UNDER_REVIEW'::public."CaseStatus"
       )
  );
END
$grainline_case_order_active_for_seller$;

CREATE OR REPLACE FUNCTION public.grainline_order_buyer_pii_prune_batch(
  p_batch_size integer
)
RETURNS TABLE (
  purged bigint,
  cutoff timestamp without time zone
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_pii_prune_batch$
DECLARE
  fixed_cutoff timestamp(3) without time zone;
  purged_count bigint;
BEGIN
  IF p_batch_size IS NULL
     OR p_batch_size < 1
     OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'Order buyer-PII prune batch size is invalid'
      USING ERRCODE = '22023';
  END IF;

  fixed_cutoff :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
    - INTERVAL '90 days';

  WITH pii_candidates AS MATERIALIZED (
    SELECT order_row.id
      FROM public."Order" AS order_row
     WHERE order_row."reviewNeeded" = false
       AND order_row."fulfillmentStatus" IN (
         'DELIVERED'::public."FulfillmentStatus",
         'PICKED_UP'::public."FulfillmentStatus"
       )
       AND COALESCE(
         order_row."deliveredAt",
         order_row."pickedUpAt"
       ) IS NOT NULL
       AND COALESCE(
         order_row."deliveredAt",
         order_row."pickedUpAt"
       ) < fixed_cutoff
       AND NOT EXISTS (
         SELECT 1
           FROM public."Case" AS case_row
          WHERE case_row."orderId" = order_row.id
            AND case_row.status IN (
              'OPEN'::public."CaseStatus",
              'IN_DISCUSSION'::public."CaseStatus",
              'PENDING_CLOSE'::public."CaseStatus",
              'UNDER_REVIEW'::public."CaseStatus"
            )
       )
       AND (
         order_row."buyerEmail" IS NOT NULL OR
         order_row."buyerName" IS NOT NULL OR
         order_row."shipToLine1" IS NOT NULL OR
         order_row."shipToLine2" IS NOT NULL OR
         order_row."shipToCity" IS NOT NULL OR
         order_row."shipToState" IS NOT NULL OR
         order_row."shipToPostalCode" IS NOT NULL OR
         order_row."shipToCountry" IS NOT NULL OR
         order_row."quotedToLine1" IS NOT NULL OR
         order_row."quotedToLine2" IS NOT NULL OR
         order_row."quotedToCity" IS NOT NULL OR
         order_row."quotedToState" IS NOT NULL OR
         order_row."quotedToPostalCode" IS NOT NULL OR
         order_row."quotedToCountry" IS NOT NULL OR
         order_row."quotedToName" IS NOT NULL OR
         order_row."quotedToPhone" IS NOT NULL OR
         order_row."trackingCarrier" IS NOT NULL OR
         order_row."trackingNumber" IS NOT NULL OR
         order_row."sellerNotes" IS NOT NULL OR
         order_row."shippoShipmentId" IS NOT NULL OR
         order_row."shippoRateObjectId" IS NOT NULL OR
         order_row."shippoTransactionId" IS NOT NULL OR
         order_row."labelUrl" IS NOT NULL OR
         order_row."labelCarrier" IS NOT NULL OR
         order_row."labelTrackingNumber" IS NOT NULL OR
         order_row."giftNote" IS NOT NULL OR
         EXISTS (
           SELECT 1
             FROM public."OrderShippingRateQuote" AS quote
            WHERE quote."orderId" = order_row.id
         )
       )
     ORDER BY
       COALESCE(order_row."deliveredAt", order_row."pickedUpAt") ASC,
       order_row.id ASC
     FOR UPDATE OF order_row SKIP LOCKED
     LIMIT p_batch_size
  ),
  deleted_quotes AS (
    DELETE FROM public."OrderShippingRateQuote" AS quote
     USING pii_candidates
     WHERE quote."orderId" = pii_candidates.id
     RETURNING quote.id
  ),
  updated_orders AS (
    UPDATE public."Order" AS order_row
       SET
         "buyerEmail" = NULL,
         "buyerName" = NULL,
         "shipToLine1" = NULL,
         "shipToLine2" = NULL,
         "shipToCity" = NULL,
         "shipToState" = NULL,
         "shipToPostalCode" = NULL,
         "shipToCountry" = NULL,
         "quotedToLine1" = NULL,
         "quotedToLine2" = NULL,
         "quotedToCity" = NULL,
         "quotedToState" = NULL,
         "quotedToPostalCode" = NULL,
         "quotedToCountry" = NULL,
         "quotedToName" = NULL,
         "quotedToPhone" = NULL,
         "trackingCarrier" = NULL,
         "trackingNumber" = NULL,
         "sellerNotes" = NULL,
         "shippoShipmentId" = NULL,
         "shippoRateObjectId" = NULL,
         "shippoTransactionId" = NULL,
         "labelUrl" = NULL,
         "labelCarrier" = NULL,
         "labelTrackingNumber" = NULL,
         "giftNote" = NULL,
         "buyerDataPurgedAt" =
           pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      FROM pii_candidates
     WHERE order_row.id = pii_candidates.id
     RETURNING order_row.id
  )
  SELECT pg_catalog.count(*)::bigint
    INTO purged_count
    FROM updated_orders;

  RETURN QUERY SELECT purged_count, fixed_cutoff;
END
$grainline_order_buyer_pii_prune_batch$;

REVOKE ALL ON FUNCTION
  public.grainline_case_order_active_for_buyer(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_case_order_active_for_seller(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_order_buyer_pii_prune_batch(integer)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_case_order_active_for_buyer(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_order_active_for_seller(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_buyer_pii_prune_batch(integer)
  TO grainline_app_runtime;

COMMIT;
