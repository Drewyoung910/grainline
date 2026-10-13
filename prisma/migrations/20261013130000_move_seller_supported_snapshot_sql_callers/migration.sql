-- Replace public eligibility reads of the private provider-version field with
-- the transactionally maintained public-safe SellerProfile snapshot. Function
-- signatures, security mode, grants and all non-provider behavior are unchanged.
-- Applied historical migrations remain immutable. The notification core remains
-- for its later combined private metrics/provider-state conversion so its large
-- definition is replaced only once.

BEGIN;

DO $seller_supported_snapshot_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."SellerProfile"') IS NULL THEN
    RAISE EXCEPTION 'SellerProfile table is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'public."SellerProfile"'::pg_catalog.regclass
       AND attribute.attname = 'stripeAccountSupported'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'SellerProfile stripeAccountSupported snapshot is missing';
  END IF;
END
$seller_supported_snapshot_preflight$;

-- Latest definition copied from 20260726022500_prepare_conversation_message_authority; only the public-safe
-- provider-support predicate/projection changes.
CREATE OR REPLACE FUNCTION public.grainline_conversation_listing_core(
  p_user_a_id text,
  p_user_b_id text,
  p_listing_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_conversation_listing_core$
DECLARE
  listing_id text;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_listing_id = '' OR pg_catalog.char_length(p_listing_id) > 191 THEN
    RAISE EXCEPTION 'conversation listing is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT listing.id
    INTO listing_id
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    JOIN public."User" AS seller_user
      ON seller_user.id = seller."userId"
   WHERE listing.id = p_listing_id
     AND listing.status = 'ACTIVE'::public."ListingStatus"
     AND seller."userId" IN (p_user_a_id, p_user_b_id)
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller_user.banned = false
     AND seller_user."deletedAt" IS NULL
     AND (
       listing."isPrivate" = false
       OR (
         listing."reservedForUserId" IN (p_user_a_id, p_user_b_id)
         AND listing."reservedForUserId" <> seller."userId"
       )
     )
   FOR SHARE OF listing, seller, seller_user;
  RETURN listing_id;
END;
$grainline_conversation_listing_core$;

-- Latest definition copied from 20260722051500_prepare_notification_rls; only the public-safe
-- provider-support predicate/projection changes.
CREATE OR REPLACE FUNCTION public.grainline_notification_claim_back_in_stock(
  p_notification_id text,
  p_restock_audit_id text,
  p_stock_notification_id text
)
RETURNS TABLE(claimed boolean, user_id text, notification_id text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_claim_back_in_stock$
DECLARE
  source_user_id text;
  source_listing_id text;
  source_seller_user_id text;
  source_listing_title text;
  source_stock_quantity integer;
  source_listing_status text;
  source_listing_type text;
  source_is_private boolean;
  source_charges_enabled boolean;
  source_stripe_account_supported boolean;
  source_vacation_mode boolean;
  source_seller_banned boolean;
  source_seller_deleted_at timestamp(3);
  source_recipient_banned boolean;
  source_recipient_deleted_at timestamp(3);
  source_recipient_preferences jsonb;
  derived_title text;
  derived_body text;
  derived_link text;
  replay_material text;
  derived_dedup_key text;
BEGIN
  claimed := false;
  user_id := NULL;
  notification_id := NULL;

  IF p_notification_id IS NULL
     OR p_notification_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'notification id is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_stock_notification_id IS NULL
     OR p_stock_notification_id = ''
     OR pg_catalog.char_length(p_stock_notification_id) > 191 THEN
    RAISE EXCEPTION 'stock notification source is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_restock_audit_id IS NULL
     OR p_restock_audit_id = ''
     OR pg_catalog.char_length(p_restock_audit_id) > 191 THEN
    RAISE EXCEPTION 'restock transition source is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT
    source_subscription."userId",
    source_subscription."listingId",
    source_seller."userId",
    source_listing.title,
    source_listing."stockQuantity",
    source_listing.status::text,
    source_listing."listingType"::text,
    source_listing."isPrivate",
    source_seller."chargesEnabled",
    source_seller."stripeAccountSupported",
    source_seller."vacationMode",
    source_seller_user.banned,
    source_seller_user."deletedAt",
    source_recipient.banned,
    source_recipient."deletedAt",
    source_recipient."notificationPreferences"
  INTO
    source_user_id,
    source_listing_id,
    source_seller_user_id,
    source_listing_title,
    source_stock_quantity,
    source_listing_status,
    source_listing_type,
    source_is_private,
    source_charges_enabled,
    source_stripe_account_supported,
    source_vacation_mode,
    source_seller_banned,
    source_seller_deleted_at,
    source_recipient_banned,
    source_recipient_deleted_at,
    source_recipient_preferences
  FROM public."StockNotification" AS source_subscription
  JOIN public."Listing" AS source_listing
    ON source_listing.id = source_subscription."listingId"
  JOIN public."SellerProfile" AS source_seller
    ON source_seller.id = source_listing."sellerId"
  JOIN public."User" AS source_seller_user
    ON source_seller_user.id = source_seller."userId"
  JOIN public."User" AS source_recipient
    ON source_recipient.id = source_subscription."userId"
  JOIN public."SystemAuditLog" AS source_audit
    ON source_audit.id = p_restock_audit_id
   AND source_audit.action = 'MANUAL_LISTING_RESTOCKED'
   AND source_audit."actorType" = 'user'
   AND source_audit."actorId" = source_seller."userId"
   AND source_audit."targetType" = 'LISTING'
   AND source_audit."targetId" = source_listing.id
   AND source_audit.metadata ->> 'listingId' = source_listing.id
   AND source_audit.metadata ->> 'listingTitle' <> ''
   AND source_audit.metadata ->> 'previousStatus' = 'SOLD_OUT'
   AND source_audit.metadata ->> 'newStatus' = 'ACTIVE'
   AND source_audit.metadata ->> 'newQuantity' ~ '^[1-9][0-9]*$'
   AND source_audit.metadata ->> 'mutationKind' IN ('delta', 'absolute')
   AND source_subscription."createdAt" <= source_audit."createdAt"
  WHERE source_subscription.id = p_stock_notification_id
  FOR UPDATE OF source_subscription
  FOR SHARE OF source_listing, source_seller, source_seller_user, source_recipient, source_audit;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Do not consume the subscription if the listing is no longer publicly
  -- purchasable. It remains eligible for a later genuine restock transition.
  IF source_listing_status <> 'ACTIVE'
     OR source_listing_type <> 'IN_STOCK'
     OR source_is_private
     OR COALESCE(source_stock_quantity, 0) <= 0
     OR NOT source_charges_enabled
     OR NOT source_stripe_account_supported
     OR source_vacation_mode
     OR source_seller_banned
     OR source_seller_deleted_at IS NOT NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Match the existing one-shot behavior: invalid recipients and recipients
  -- who disabled the in-app type still consume the stock subscription. Email
  -- preference remains an independent application-side decision after a
  -- successful claim.
  IF source_recipient_banned
     OR source_recipient_deleted_at IS NOT NULL
     OR source_recipient_preferences -> 'BACK_IN_STOCK' = 'false'::jsonb THEN
    DELETE FROM public."StockNotification" AS source_subscription
     WHERE source_subscription.id = p_stock_notification_id;
    claimed := true;
    user_id := source_user_id;
    RETURN NEXT;
    RETURN;
  END IF;

  derived_title := pg_catalog.left(source_listing_title || ' is back in stock!', 200);
  derived_body := 'The piece you saved is available again. Current stock: '
    || source_stock_quantity::text || '.';
  derived_link := '/listing/' || source_listing_id;
  replay_material := pg_catalog.concat_ws(
    pg_catalog.chr(31),
    'grainline-notification-v1',
    source_user_id,
    'BACK_IN_STOCK',
    'manual_restock',
    p_restock_audit_id,
    p_stock_notification_id,
    source_seller_user_id
  );
  derived_dedup_key :=
    pg_catalog.md5(replay_material)
    || pg_catalog.md5('grainline-notification-v1-secondary' || replay_material);

  INSERT INTO public."Notification" (
    id,
    "userId",
    "relatedUserId",
    "type",
    title,
    body,
    link,
    "sourceType",
    "sourceId",
    "dedupKey",
    read,
    "createdAt"
  ) VALUES (
    p_notification_id,
    source_user_id,
    CASE
      WHEN source_seller_user_id = source_user_id THEN NULL
      ELSE source_seller_user_id
    END,
    'BACK_IN_STOCK'::public."NotificationType",
    derived_title,
    derived_body,
    derived_link,
    'manual_restock',
    p_restock_audit_id,
    derived_dedup_key,
    false,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT ("userId", "type", "dedupKey") DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    SELECT notification.id
      INTO notification_id
      FROM public."Notification" AS notification
     WHERE notification."userId" = source_user_id
       AND notification."type" = 'BACK_IN_STOCK'::public."NotificationType"
       AND notification."dedupKey" = derived_dedup_key;
  END IF;

  IF notification_id IS NULL THEN
    RAISE EXCEPTION 'back-in-stock notification claim did not resolve a row';
  END IF;

  DELETE FROM public."StockNotification" AS source_subscription
   WHERE source_subscription.id = p_stock_notification_id;
  claimed := true;
  user_id := source_user_id;
  RETURN NEXT;
END;
$grainline_notification_claim_back_in_stock$;

-- Latest definition copied from 20260901100000_prepare_order_participant_detail_projection; only the public-safe
-- provider-support predicate/projection changes.
CREATE OR REPLACE FUNCTION public.grainline_order_buyer_detail_v2(
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
  shipping_carrier text,
  shipping_service text,
  review_needed boolean,
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
  seller_refund_state text,
  seller_refund_amount_cents integer,
  seller_user_id text,
  items jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_buyer_detail_v2$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Buyer Order detail v2 input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
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
    detail.shipping_carrier,
    detail.shipping_service,
    detail.review_needed,
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
    detail.seller_refund_state,
    detail.seller_refund_amount_cents,
    CASE
      WHEN seller_user.id IS NOT NULL
       AND seller_user.banned = false
       AND seller_user."deletedAt" IS NULL
        THEN detail.seller_user_id
      ELSE NULL
    END,
    sanitized_items.items
  FROM public.grainline_order_buyer_detail(p_actor_user_id, p_order_id) AS detail
  JOIN public."User" AS actor
    ON actor.id = p_actor_user_id
   AND actor.banned = false
   AND actor."deletedAt" IS NULL
  LEFT JOIN public."User" AS seller_user
    ON seller_user.id = detail.seller_user_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', item.value->'id',
          'listingId', item.value->'listingId',
          'priceCents', item.value->'priceCents',
          'quantity', item.value->'quantity',
          'listingLinkAvailable', COALESCE(
            listing_seller."userId" = p_actor_user_id
            OR (
              source_listing.status::text = 'ACTIVE'
              AND source_listing."isPrivate" = true
              AND source_listing."reservedForUserId" = p_actor_user_id
              AND listing_seller."chargesEnabled" = true
              AND listing_seller."stripeAccountSupported" = true
              AND listing_seller."vacationMode" = false
              AND listing_seller_user.banned = false
              AND listing_seller_user."deletedAt" IS NULL
            )
            OR (
              source_listing.status::text IN ('ACTIVE', 'SOLD_OUT')
              AND source_listing."isPrivate" = false
              AND listing_seller."chargesEnabled" = true
              AND listing_seller."stripeAccountSupported" = true
              AND listing_seller."vacationMode" = false
              AND listing_seller_user.banned = false
              AND listing_seller_user."deletedAt" IS NULL
            ),
            false
          ),
          'listingSnapshot', CASE
            WHEN pg_catalog.jsonb_typeof(item.value->'listingSnapshot') = 'object'
              THEN pg_catalog.jsonb_build_object(
                'title', item.value->'listingSnapshot'->'title',
                'imageUrls', item.value->'listingSnapshot'->'imageUrls',
                'sellerName', item.value->'listingSnapshot'->'sellerName',
                'listingType', item.value->'listingSnapshot'->'listingType',
                'processingTimeMinDays', item.value->'listingSnapshot'->'processingTimeMinDays',
                'processingTimeMaxDays', item.value->'listingSnapshot'->'processingTimeMaxDays',
                'shipsWithinDays', item.value->'listingSnapshot'->'shipsWithinDays'
              )
            ELSE NULL
          END,
          'selectedVariants', item.value->'selectedVariants'
        )
        ORDER BY item.ordinality
      ),
      '[]'::jsonb
    ) AS items
    FROM pg_catalog.jsonb_array_elements(detail.items)
      WITH ORDINALITY AS item(value, ordinality)
    LEFT JOIN public."Listing" AS source_listing
      ON source_listing.id = item.value->>'listingId'
    LEFT JOIN public."SellerProfile" AS listing_seller
      ON listing_seller.id = source_listing."sellerId"
    LEFT JOIN public."User" AS listing_seller_user
      ON listing_seller_user.id = listing_seller."userId"
  ) AS sanitized_items;
END;
$grainline_order_buyer_detail_v2$;

-- Latest definition copied from 20260901050000_prepare_order_public_aggregate_authority; only the public-safe
-- provider-support predicate/projection changes.
CREATE OR REPLACE FUNCTION public.grainline_order_public_listing_counts(
  p_listing_ids text[]
)
RETURNS TABLE(
  listing_id text,
  order_count bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_public_listing_counts$
BEGIN
  IF p_listing_ids IS NULL
     OR pg_catalog.cardinality(p_listing_ids) NOT BETWEEN 1 AND 200
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR pg_catalog.char_length(pg_catalog.btrim(requested.id)) NOT BETWEEN 1 AND 191
     )
     OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
     ) <> (
       SELECT pg_catalog.count(DISTINCT requested.id)
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
     ) THEN
    RAISE EXCEPTION 'Public listing Order counts input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT
    listing.id,
    pg_catalog.count(source_order.id)::bigint
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    JOIN public."User" AS seller_user
      ON seller_user.id = seller."userId"
    LEFT JOIN public."OrderItem" AS source_item
      ON source_item."listingId" = listing.id
     AND source_item."sellerProfileId" = seller.id
    LEFT JOIN public."Order" AS source_order
      ON source_order.id = source_item."orderId"
     AND source_order."sellerProfileId" = seller.id
     AND source_order."paidAt" IS NOT NULL
     AND (
       source_order."stripeSessionId" IS NOT NULL
       OR source_order."stripePaymentIntentId" IS NOT NULL
       OR source_order."stripeChargeId" IS NOT NULL
     )
     AND source_order."sellerRefundId" IS NULL
     AND source_order."paymentRefundBlocked" = false
     AND source_order."paymentConversionDisputeBlocked" = false
   WHERE listing.id = ANY(p_listing_ids)
     AND listing.status = 'ACTIVE'::public."ListingStatus"
     AND listing."isPrivate" = false
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller_user.banned = false
     AND seller_user."deletedAt" IS NULL
   GROUP BY listing.id
   ORDER BY listing.id;
END
$grainline_order_public_listing_counts$;

-- Latest definition copied from 20260901050000_prepare_order_public_aggregate_authority; only the public-safe
-- provider-support predicate/projection changes.
CREATE OR REPLACE FUNCTION public.grainline_order_public_marketplace_listing_metrics()
RETURNS TABLE(
  total_views bigint,
  total_clicks bigint,
  total_orders bigint
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_public_marketplace_listing_metrics$
  WITH visible_listings AS (
    SELECT listing.id, listing."viewCount", listing."clickCount", listing."sellerId"
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
      JOIN public."User" AS seller_user
        ON seller_user.id = seller."userId"
     WHERE listing.status = 'ACTIVE'::public."ListingStatus"
       AND listing."isPrivate" = false
       AND seller."chargesEnabled" = true
       AND seller."stripeAccountSupported" = true
       AND seller."vacationMode" = false
       AND seller_user.banned = false
       AND seller_user."deletedAt" IS NULL
  )
  SELECT
    COALESCE((SELECT pg_catalog.sum("viewCount") FROM visible_listings), 0)::bigint,
    COALESCE((SELECT pg_catalog.sum("clickCount") FROM visible_listings), 0)::bigint,
    COALESCE((
      SELECT pg_catalog.count(source_item.id)
        FROM visible_listings
        JOIN public."OrderItem" AS source_item
          ON source_item."listingId" = visible_listings.id
         AND source_item."sellerProfileId" = visible_listings."sellerId"
        JOIN public."Order" AS source_order
          ON source_order.id = source_item."orderId"
         AND source_order."sellerProfileId" = visible_listings."sellerId"
       WHERE source_order."paidAt" IS NOT NULL
         AND (
           source_order."stripeSessionId" IS NOT NULL
           OR source_order."stripePaymentIntentId" IS NOT NULL
           OR source_order."stripeChargeId" IS NOT NULL
         )
         AND source_order."sellerRefundId" IS NULL
         AND source_order."paymentRefundBlocked" = false
         AND source_order."paymentConversionDisputeBlocked" = false
    ), 0)::bigint
$grainline_order_public_marketplace_listing_metrics$;

-- Latest definition copied from 20260901050000_prepare_order_public_aggregate_authority; only the public-safe
-- provider-support predicate/projection changes.
CREATE OR REPLACE FUNCTION public.grainline_order_public_seller_stats(
  p_seller_profile_id text,
  p_recent_shipping_since_epoch_millis bigint
)
RETURNS TABLE(
  sold_count bigint,
  shipped_count bigint,
  avg_ship_days double precision
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_public_seller_stats$
DECLARE
  recent_shipping_cutoff timestamp(3) without time zone;
BEGIN
  IF p_seller_profile_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_seller_profile_id)) NOT BETWEEN 1 AND 191
     OR p_recent_shipping_since_epoch_millis IS NULL
     OR p_recent_shipping_since_epoch_millis NOT BETWEEN 0 AND 253402300799999 THEN
    RAISE EXCEPTION 'Public seller Order stats input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  recent_shipping_cutoff := (
    pg_catalog.to_timestamp(
      p_recent_shipping_since_epoch_millis::double precision / 1000.0
    ) AT TIME ZONE 'UTC'
  )::timestamp(3) without time zone;

  RETURN QUERY
  WITH visible_seller AS (
    SELECT seller.id
      FROM public."SellerProfile" AS seller
      JOIN public."User" AS seller_user
        ON seller_user.id = seller."userId"
     WHERE seller.id = p_seller_profile_id
       AND seller."chargesEnabled" = true
       AND seller."stripeAccountSupported" = true
       AND seller_user.banned = false
       AND seller_user."deletedAt" IS NULL
  ),
  sold AS (
    SELECT
      visible_seller.id,
      COALESCE(pg_catalog.sum(source_item.quantity::bigint), 0::numeric)::bigint AS value
      FROM visible_seller
      LEFT JOIN public."Order" AS source_order
        ON source_order."sellerProfileId" = visible_seller.id
       AND source_order."paidAt" IS NOT NULL
       AND (
         source_order."stripeSessionId" IS NOT NULL
         OR source_order."stripePaymentIntentId" IS NOT NULL
         OR source_order."stripeChargeId" IS NOT NULL
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
      LEFT JOIN public."OrderItem" AS source_item
        ON source_item."orderId" = source_order.id
       AND source_item."sellerProfileId" = visible_seller.id
     GROUP BY visible_seller.id
  ),
  recent_shipping AS (
    SELECT source_order."paidAt", source_order."shippedAt"
      FROM visible_seller
      JOIN public."Order" AS source_order
        ON source_order."sellerProfileId" = visible_seller.id
     WHERE source_order."shippedAt" IS NOT NULL
       AND source_order."shippedAt" >= recent_shipping_cutoff
       AND source_order."paidAt" IS NOT NULL
       AND (
         source_order."stripeSessionId" IS NOT NULL
         OR source_order."stripePaymentIntentId" IS NOT NULL
         OR source_order."stripeChargeId" IS NOT NULL
       )
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
     ORDER BY source_order."shippedAt" DESC, source_order.id DESC
     LIMIT 30
  )
  SELECT
    sold.value,
    pg_catalog.count(recent_shipping."shippedAt")::bigint,
    pg_catalog.avg(
      EXTRACT(
        epoch FROM (recent_shipping."shippedAt" - recent_shipping."paidAt")
      ) / 86400.0
    )::double precision
    FROM sold
    LEFT JOIN recent_shipping ON true
   GROUP BY sold.value;
END
$grainline_order_public_seller_stats$;

-- Latest definition copied from 20260901100000_prepare_order_participant_detail_projection; only the public-safe
-- provider-support predicate/projection changes.
CREATE OR REPLACE FUNCTION public.grainline_order_seller_detail_v2(
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
  label_url text,
  label_carrier text,
  label_tracking_number text,
  label_purchased_at_epoch_millis bigint,
  items jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_seller_detail_v2$
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_order_id)) NOT BETWEEN 1 AND 191 THEN
    RAISE EXCEPTION 'Seller Order detail v2 input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
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
    CASE
      WHEN detail.buyer_data_purged_at_epoch_millis IS NULL
       AND buyer.id IS NOT NULL
       AND buyer.banned = false
       AND buyer."deletedAt" IS NULL
        THEN detail.buyer_id
      ELSE NULL
    END,
    detail.buyer_name,
    detail.buyer_email,
    detail.buyer_deleted_at_epoch_millis,
    CASE
      WHEN detail.buyer_data_purged_at_epoch_millis IS NULL
        THEN detail.seller_notes
      ELSE NULL
    END,
    detail.seller_refund_state,
    detail.seller_refund_amount_cents,
    detail.label_status,
    CASE WHEN detail.label_status = 'PURCHASED' THEN detail.label_url ELSE NULL END,
    CASE WHEN detail.label_status = 'PURCHASED' THEN detail.label_carrier ELSE NULL END,
    CASE WHEN detail.label_status = 'PURCHASED' THEN detail.label_tracking_number ELSE NULL END,
    CASE WHEN detail.label_status = 'PURCHASED' THEN detail.label_purchased_at_epoch_millis ELSE NULL END,
    sanitized_items.items
  FROM public.grainline_order_seller_detail(p_actor_user_id, p_order_id) AS detail
  JOIN public."User" AS actor
    ON actor.id = p_actor_user_id
   AND actor.banned = false
   AND actor."deletedAt" IS NULL
  LEFT JOIN public."User" AS buyer
    ON buyer.id = detail.buyer_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', item.value->'id',
          'listingId', item.value->'listingId',
          'priceCents', item.value->'priceCents',
          'quantity', item.value->'quantity',
          'listingLinkAvailable', COALESCE(
            listing_seller."userId" = p_actor_user_id
            OR (
              source_listing.status::text = 'ACTIVE'
              AND source_listing."isPrivate" = true
              AND source_listing."reservedForUserId" = p_actor_user_id
              AND listing_seller."chargesEnabled" = true
              AND listing_seller."stripeAccountSupported" = true
              AND listing_seller."vacationMode" = false
              AND listing_seller_user.banned = false
              AND listing_seller_user."deletedAt" IS NULL
            )
            OR (
              source_listing.status::text IN ('ACTIVE', 'SOLD_OUT')
              AND source_listing."isPrivate" = false
              AND listing_seller."chargesEnabled" = true
              AND listing_seller."stripeAccountSupported" = true
              AND listing_seller."vacationMode" = false
              AND listing_seller_user.banned = false
              AND listing_seller_user."deletedAt" IS NULL
            ),
            false
          ),
          'listingSnapshot', CASE
            WHEN pg_catalog.jsonb_typeof(item.value->'listingSnapshot') = 'object'
              THEN pg_catalog.jsonb_build_object(
                'title', item.value->'listingSnapshot'->'title',
                'imageUrls', item.value->'listingSnapshot'->'imageUrls',
                'sellerName', item.value->'listingSnapshot'->'sellerName',
                'listingType', item.value->'listingSnapshot'->'listingType',
                'processingTimeMinDays', item.value->'listingSnapshot'->'processingTimeMinDays',
                'processingTimeMaxDays', item.value->'listingSnapshot'->'processingTimeMaxDays',
                'shipsWithinDays', item.value->'listingSnapshot'->'shipsWithinDays'
              )
            ELSE NULL
          END,
          'selectedVariants', item.value->'selectedVariants'
        )
        ORDER BY item.ordinality
      ),
      '[]'::jsonb
    ) AS items
    FROM pg_catalog.jsonb_array_elements(detail.items)
      WITH ORDINALITY AS item(value, ordinality)
    LEFT JOIN public."Listing" AS source_listing
      ON source_listing.id = item.value->>'listingId'
    LEFT JOIN public."SellerProfile" AS listing_seller
      ON listing_seller.id = source_listing."sellerId"
    LEFT JOIN public."User" AS listing_seller_user
      ON listing_seller_user.id = listing_seller."userId"
  ) AS sanitized_items;
END;
$grainline_order_seller_detail_v2$;

-- Latest definition copied from 20261007040000_prepare_user_follower_authorities; only the public-safe
-- provider-support predicate/projection changes.
CREATE OR REPLACE FUNCTION public.grainline_user_public_listing_favorite_counts(
  p_listing_ids text[]
)
RETURNS TABLE (
  "listingId" text,
  "favoriteCount" bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_public_listing_favorite_counts$
BEGIN
  IF p_listing_ids IS NULL
     OR pg_catalog.cardinality(p_listing_ids) < 1
     OR pg_catalog.cardinality(p_listing_ids) > 200
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR requested.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR pg_catalog.cardinality(p_listing_ids) <> (
       SELECT pg_catalog.count(DISTINCT requested.id)
         FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
     ) THEN
    RAISE EXCEPTION 'User public listing favorite count input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT listing.id,
         pg_catalog.count(favoriter.id)::bigint
    FROM pg_catalog.unnest(p_listing_ids) AS requested(id)
    JOIN public."Listing" AS listing
      ON listing.id = requested.id
     AND listing.status = 'ACTIVE'
     AND listing."isPrivate" = false
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."ownerAccountActive" = true
    LEFT JOIN public."Favorite" AS favorite
      ON favorite."listingId" = listing.id
    LEFT JOIN public."User" AS favoriter
      ON favoriter.id = favorite."userId"
     AND favoriter.banned = false
     AND favoriter."deletedAt" IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS blocked_pair
        WHERE (
                blocked_pair."blockerId" = favoriter.id
            AND blocked_pair."blockedId" = seller."userId"
              )
           OR (
                blocked_pair."blockerId" = seller."userId"
            AND blocked_pair."blockedId" = favoriter.id
              )
     )
   GROUP BY listing.id
   ORDER BY listing.id;
END
$grainline_user_public_listing_favorite_counts$;

COMMIT;
