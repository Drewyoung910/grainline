-- Compatible fixed Order-family authority for account deletion.
--
-- This migration is additive. It does not enable RLS, revoke predecessor
-- table CRUD, or mutate rows. Both operations bind the target to the
-- transaction-local authenticated actor. The scrub rechecks every blocker
-- after account deletion has locked the User row, then redacts only rows whose
-- buyer or durable seller identity belongs to that actor.

BEGIN;

CREATE FUNCTION public.grainline_order_account_deletion_blockers(
  p_actor_user_id text
)
RETURNS TABLE(
  buyer_order_count bigint,
  seller_order_count bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_account_deletion_blockers$
DECLARE
  session_actor_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  source_seller_profile_id text;
  terminal_cutoff timestamp(3) without time zone;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     THEN
    RAISE EXCEPTION 'Order account-deletion blocker input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF session_actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Order account-deletion actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order account-deletion actor is unavailable'
      USING ERRCODE = '23503';
  END IF;

  SELECT seller.id
    INTO source_seller_profile_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = p_actor_user_id;

  terminal_cutoff := (
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone - INTERVAL '30 days';

  RETURN QUERY
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE source_order."buyerId" = p_actor_user_id
    )::bigint AS buyer_order_count,
    pg_catalog.count(*) FILTER (
      WHERE source_seller_profile_id IS NOT NULL
        AND source_order."sellerProfileId" = source_seller_profile_id
    )::bigint AS seller_order_count
    FROM public."Order" AS source_order
   WHERE (
          source_order."buyerId" = p_actor_user_id
          OR (
            source_seller_profile_id IS NOT NULL
            AND source_order."sellerProfileId" = source_seller_profile_id
          )
        )
     AND (
          source_order."fulfillmentStatus" IN (
            'PENDING'::public."FulfillmentStatus",
            'READY_FOR_PICKUP'::public."FulfillmentStatus",
            'SHIPPED'::public."FulfillmentStatus"
          )
          OR (
            source_order."fulfillmentStatus" = 'DELIVERED'::public."FulfillmentStatus"
            AND (
              source_order."deliveredAt" IS NULL
              OR source_order."deliveredAt" >= terminal_cutoff
            )
          )
          OR (
            source_order."fulfillmentStatus" = 'PICKED_UP'::public."FulfillmentStatus"
            AND (
              source_order."pickedUpAt" IS NULL
              OR source_order."pickedUpAt" >= terminal_cutoff
            )
          )
        )
     AND NOT (
       source_order."sellerRefundId" IS NOT NULL
       AND source_order."sellerRefundId" <> 'pending'
       AND COALESCE(source_order."sellerRefundAmountCents", 0) > 0
       AND COALESCE(source_order."sellerRefundAmountCents", 0) >=
         COALESCE(
           source_order."chargedTotalCents",
           COALESCE(source_order."itemsSubtotalCents", 0)
             + COALESCE(source_order."shippingAmountCents", 0)
             + COALESCE(source_order."giftWrappingPriceCents", 0)
             + COALESCE(source_order."taxAmountCents", 0)
         )
     );
END
$grainline_order_account_deletion_blockers$;

CREATE FUNCTION public.grainline_order_account_deletion_scrub(
  p_actor_user_id text,
  p_additional_sensitive_values text[]
)
RETURNS TABLE(
  review_notes_redacted bigint,
  buyer_orders_scrubbed bigint,
  seller_orders_scrubbed bigint,
  shipping_quotes_deleted bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_account_deletion_scrub$
DECLARE
  session_actor_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  locked_actor public."User"%ROWTYPE;
  source_seller public."SellerProfile"%ROWTYPE;
  source_seller_profile_id text;
  purge_at timestamp(3) without time zone;
  sensitive_values text[];
  blocker_buyer_count bigint;
  blocker_seller_count bigint;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR COALESCE(pg_catalog.array_length(p_additional_sensitive_values, 1), 0) > 128
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(
           COALESCE(p_additional_sensitive_values, ARRAY[]::text[])
         ) AS supplied(value)
        WHERE supplied.value IS NULL
           OR pg_catalog.char_length(supplied.value) NOT BETWEEN 1 AND 2048
     ) THEN
    RAISE EXCEPTION 'Order account-deletion scrub input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF session_actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'Order account-deletion actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT actor.*
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR UPDATE OF actor;
  IF NOT FOUND OR locked_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Order account-deletion actor is unavailable'
      USING ERRCODE = '23503';
  END IF;

  SELECT seller.*
    INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = locked_actor.id;
  IF FOUND THEN
    source_seller_profile_id := source_seller.id;
  END IF;

  SELECT blocker.buyer_order_count, blocker.seller_order_count
    INTO STRICT blocker_buyer_count, blocker_seller_count
    FROM public.grainline_order_account_deletion_blockers(
      p_actor_user_id
    ) AS blocker;
  IF blocker_buyer_count <> 0 OR blocker_seller_count <> 0 THEN
    RAISE EXCEPTION 'Order account-deletion obligations changed after the initial check'
      USING ERRCODE = '40001';
  END IF;

  purge_at := (
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;

  SELECT ARRAY(
    SELECT DISTINCT normalized.value
      FROM (
        SELECT pg_catalog.btrim(supplied.value) AS value
          FROM pg_catalog.unnest(
            COALESCE(p_additional_sensitive_values, ARRAY[]::text[])
          ) AS supplied(value)
        UNION ALL
        SELECT pg_catalog.btrim(derived.value)
          FROM (VALUES
            (locked_actor.id),
            (locked_actor."clerkId"),
            (locked_actor.email),
            (locked_actor.name),
            (locked_actor."shippingName"),
            (locked_actor."shippingLine1"),
            (locked_actor."shippingLine2"),
            (locked_actor."shippingCity"),
            (locked_actor."shippingState"),
            (locked_actor."shippingPostalCode"),
            (locked_actor."shippingPhone"),
            (source_seller.id),
            (source_seller."displayName"),
            (source_seller.city),
            (source_seller.state),
            (source_seller."shipFromName"),
            (source_seller."shipFromLine1"),
            (source_seller."shipFromLine2"),
            (source_seller."shipFromCity"),
            (source_seller."shipFromState"),
            (source_seller."shipFromPostal"),
            (source_seller.tagline),
            (source_seller."bannerImageUrl"),
            (source_seller."avatarImageUrl"),
            (source_seller."workshopImageUrl"),
            (source_seller."instagramUrl"),
            (source_seller."facebookUrl"),
            (source_seller."pinterestUrl"),
            (source_seller."tiktokUrl"),
            (source_seller."websiteUrl")
          ) AS derived(value)
      ) AS normalized
     WHERE normalized.value IS NOT NULL
       AND normalized.value <> ''
     ORDER BY normalized.value
  ) INTO sensitive_values;

  WITH review_candidates AS MATERIALIZED (
    SELECT
      target_order.id,
      public.grainline_account_deletion_redact_text_core(
        target_order."reviewNote",
        sensitive_values
      ) AS redacted_review_note
      FROM public."Order" AS target_order
     WHERE target_order."reviewNote" IS NOT NULL
       AND (
         target_order."buyerId" = locked_actor.id
         OR (
           source_seller_profile_id IS NOT NULL
           AND target_order."sellerProfileId" = source_seller_profile_id
         )
       )
  )
  UPDATE public."Order" AS target_order
     SET "reviewNote" = review_candidates.redacted_review_note
    FROM review_candidates
   WHERE target_order.id = review_candidates.id
     AND review_candidates.redacted_review_note
       IS DISTINCT FROM target_order."reviewNote";
  GET DIAGNOSTICS review_notes_redacted = ROW_COUNT;

  UPDATE public."Order" AS target_order
     SET "buyerEmail" = NULL,
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
         "buyerDataPurgedAt" = COALESCE(
           target_order."buyerDataPurgedAt",
           purge_at
         )
   WHERE target_order."buyerId" = locked_actor.id;
  GET DIAGNOSTICS buyer_orders_scrubbed = ROW_COUNT;

  IF source_seller_profile_id IS NULL THEN
    seller_orders_scrubbed := 0;
  ELSE
    UPDATE public."Order" AS target_order
       SET "trackingCarrier" = NULL,
           "trackingNumber" = NULL,
           "sellerNotes" = NULL,
           "shippoShipmentId" = NULL,
           "shippoRateObjectId" = NULL,
           "shippoTransactionId" = NULL,
           "labelUrl" = NULL,
           "labelCarrier" = NULL,
           "labelTrackingNumber" = NULL
     WHERE target_order."sellerProfileId" = source_seller_profile_id;
    GET DIAGNOSTICS seller_orders_scrubbed = ROW_COUNT;
  END IF;

  WITH deleted_quotes AS (
    DELETE FROM public."OrderShippingRateQuote" AS quote
    USING public."Order" AS source_order
     WHERE quote."orderId" = source_order.id
       AND (
         source_order."buyerId" = locked_actor.id
         OR (
           source_seller_profile_id IS NOT NULL
           AND source_order."sellerProfileId" = source_seller_profile_id
         )
       )
    RETURNING quote.id
  )
  SELECT pg_catalog.count(*)::bigint
    INTO STRICT shipping_quotes_deleted
    FROM deleted_quotes;

  RETURN NEXT;
END
$grainline_order_account_deletion_scrub$;

REVOKE ALL ON FUNCTION
  public.grainline_order_account_deletion_blockers(text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.grainline_order_account_deletion_scrub(text, text[])
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.grainline_order_account_deletion_blockers(text)
TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_order_account_deletion_scrub(text, text[])
TO grainline_app_runtime;

COMMIT;
