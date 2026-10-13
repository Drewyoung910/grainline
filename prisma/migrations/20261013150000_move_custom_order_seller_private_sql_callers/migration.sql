-- Move custom-order seller provider reads to the private companion installed
-- by SellerProfile Phase 0. Signatures, result contracts, security attributes,
-- owners and grants remain unchanged.

BEGIN;

DO $custom_order_seller_private_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."SellerProfilePrivate"') IS NULL THEN
    RAISE EXCEPTION 'SellerProfilePrivate table is missing';
  END IF;
  IF pg_catalog.to_regprocedure(
    'public.grainline_message_send_custom_request(text,text,text,text,text,text,integer,text,text)'
  ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_message_send_custom_order_ready(text,text,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_user_custom_order_seller_state(text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'custom-order seller predecessor function is missing';
  END IF;
END
$custom_order_seller_private_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_message_send_custom_request(
  p_conversation_id text,
  p_message_id text,
  p_buyer_id text,
  p_seller_id text,
  p_description text,
  p_dimensions text,
  p_budget_cents integer,
  p_timeline text,
  p_listing_id text
)
RETURNS TABLE (
  "conversationId" text,
  "messageId" text,
  "listingId" text,
  "listingTitle" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_message_send_custom_request$
DECLARE
  pair record;
  seller_profile_id text;
  valid_listing_id text;
  listing_title text;
  conversation_result record;
  message_sent_at timestamp(3);
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'custom request requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;
  IF p_conversation_id IS NULL
     OR p_conversation_id !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_message_id IS NULL
     OR p_message_id !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_description IS NULL
     OR p_description = ''
     OR pg_catalog.char_length(p_description) > 500
     OR pg_catalog.char_length(COALESCE(p_dimensions, '')) > 200
     OR (
       p_budget_cents IS NOT NULL
       AND (p_budget_cents <= 0 OR p_budget_cents > 10000000)
     )
     OR p_timeline IS NOT NULL
        AND p_timeline NOT IN ('no_rush', '2_months', '1_month', '2_weeks') THEN
    RAISE EXCEPTION 'custom request input is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO pair
    FROM public.grainline_conversation_lock_pair_core(
      p_buyer_id,
      p_seller_id
    );

  SELECT seller.id
    INTO seller_profile_id
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."userId" = p_seller_id
     AND seller."acceptsCustomOrders" = true
     AND seller."acceptingNewOrders" = true
     AND seller_private."stripeAccountId" IS NOT NULL
     AND seller."chargesEnabled" = true
     AND seller."vacationMode" = false
     AND seller."stripeAccountSupported" = true
   FOR SHARE OF seller, seller_private;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'custom request seller is unavailable'
      USING ERRCODE = '42501';
  END IF;

  valid_listing_id := NULL;
  listing_title := NULL;
  IF p_listing_id IS NOT NULL THEN
    IF p_listing_id = '' OR pg_catalog.char_length(p_listing_id) > 191 THEN
      RAISE EXCEPTION 'custom request listing is invalid'
        USING ERRCODE = '22023';
    END IF;
    SELECT listing.id, listing.title::text
      INTO valid_listing_id, listing_title
      FROM public."Listing" AS listing
     WHERE listing.id = p_listing_id
       AND listing."sellerId" = seller_profile_id
       AND listing.status = 'ACTIVE'::public."ListingStatus"
       AND listing."isPrivate" = false
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'custom request listing is unavailable'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT *
    INTO conversation_result
    FROM public.grainline_conversation_get_or_create_core(
      p_conversation_id,
      pair.user_a_id,
      pair.user_b_id,
      valid_listing_id
    );

  PERFORM conversation.id
    FROM public."Conversation" AS conversation
   WHERE conversation.id = conversation_result."conversationId"
     AND conversation."userAId" = pair.user_a_id
     AND conversation."userBId" = pair.user_b_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'custom request conversation changed'
      USING ERRCODE = '40001';
  END IF;

  message_sent_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
  INSERT INTO public."Message" (
    id,
    "conversationId",
    "senderId",
    "recipientId",
    "contextListingId",
    body,
    kind,
    "isSystemMessage",
    "createdAt"
  ) VALUES (
    p_message_id,
    conversation_result."conversationId",
    p_buyer_id,
    p_seller_id,
    valid_listing_id,
    pg_catalog.jsonb_build_object(
      'description', p_description,
      'dimensions', p_dimensions,
      'budget', CASE
        WHEN p_budget_cents IS NULL THEN NULL
        ELSE p_budget_cents::numeric / 100
      END,
      'timeline', p_timeline,
      'timelineLabel', CASE p_timeline
        WHEN 'no_rush' THEN 'No rush (2+ months)'
        WHEN '2_months' THEN 'Within 2 months'
        WHEN '1_month' THEN 'Within 1 month'
        WHEN '2_weeks' THEN 'Within 2 weeks'
        ELSE NULL
      END,
      'listingId', valid_listing_id,
      'listingTitle', listing_title
    )::text,
    'custom_order_request',
    false,
    message_sent_at
  );

  "conversationId" := conversation_result."conversationId";
  "messageId" := p_message_id;
  "listingId" := valid_listing_id;
  "listingTitle" := listing_title;
  RETURN NEXT;
END;
$grainline_message_send_custom_request$;

CREATE OR REPLACE FUNCTION public.grainline_message_send_custom_order_ready(
  p_message_id text,
  p_seller_user_id text,
  p_listing_id text
)
RETURNS TABLE (
  "messageId" text,
  "conversationId" text,
  "sellerUserId" text,
  "buyerUserId" text,
  "listingId" text,
  "listingTitle" text,
  "priceCents" integer,
  currency text,
  "sellerName" text,
  created boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_message_send_custom_order_ready$
DECLARE
  initial_source record;
  pair record;
  source_listing record;
  existing_message record;
  message_sent_at timestamp(3);
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'custom-order-ready requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;
  IF p_message_id IS NULL
     OR p_message_id !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_listing_id IS NULL
     OR p_listing_id = ''
     OR pg_catalog.char_length(p_listing_id) > 191 THEN
    RAISE EXCEPTION 'custom-order-ready input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    seller."userId" AS seller_user_id,
    listing."reservedForUserId" AS buyer_user_id,
    listing."customOrderConversationId" AS conversation_id
    INTO initial_source
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id;
  IF NOT FOUND
     OR initial_source.seller_user_id <> p_seller_user_id
     OR initial_source.buyer_user_id IS NULL
     OR initial_source.conversation_id IS NULL THEN
    RAISE EXCEPTION 'custom-order-ready source is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO pair
    FROM public.grainline_conversation_lock_pair_core(
      p_seller_user_id,
      initial_source.buyer_user_id
    );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    913349,
    pg_catalog.hashtext(p_listing_id)
  );

  SELECT
    listing.id,
    listing.title::text,
    listing."priceCents",
    listing.currency::text,
    listing."customOrderConversationId" AS conversation_id,
    seller."userId" AS seller_user_id,
    listing."reservedForUserId" AS buyer_user_id,
    seller."displayName"::text AS seller_name
    INTO source_listing
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE listing.id = p_listing_id
     AND listing.status = 'ACTIVE'::public."ListingStatus"
     AND listing."isPrivate" = true
     AND listing."reservedForUserId" = initial_source.buyer_user_id
     AND listing."customOrderConversationId" = initial_source.conversation_id
     AND seller."userId" = p_seller_user_id
     AND seller."chargesEnabled" = true
     AND seller_private."stripeAccountId" IS NOT NULL
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
   FOR SHARE OF listing, seller, seller_private;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'custom-order-ready source changed'
      USING ERRCODE = '42501';
  END IF;

  PERFORM conversation.id
    FROM public."Conversation" AS conversation
   WHERE conversation.id = source_listing.conversation_id
     AND conversation."userAId" = pair.user_a_id
     AND conversation."userBId" = pair.user_b_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'custom-order-ready conversation is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    pg_catalog.count(*)::integer AS message_count,
    pg_catalog.min(message.id) AS message_id,
    pg_catalog.bool_and(
      message."senderId" = source_listing.seller_user_id
      AND message."recipientId" = source_listing.buyer_user_id
      AND message."isSystemMessage" = true
      AND (message.body::jsonb)->>'listingId' = source_listing.id
      AND (message.body::jsonb)->>'title' = source_listing.title
      AND (message.body::jsonb)->>'priceCents' =
          source_listing."priceCents"::text
      AND (message.body::jsonb)->>'currency' = source_listing.currency
    ) AS authority_valid
    INTO existing_message
    FROM public."Message" AS message
   WHERE message."conversationId" = source_listing.conversation_id
     AND message."contextListingId" = source_listing.id
     AND message.kind = 'custom_order_link';
  IF existing_message.message_count > 0 THEN
    IF existing_message.message_count <> 1
       OR existing_message.authority_valid IS NOT TRUE THEN
      RAISE EXCEPTION 'custom-order-ready message evidence is invalid'
        USING ERRCODE = '23514';
    END IF;
    "messageId" := existing_message.message_id;
    "conversationId" := source_listing.conversation_id;
    "sellerUserId" := source_listing.seller_user_id;
    "buyerUserId" := source_listing.buyer_user_id;
    "listingId" := source_listing.id;
    "listingTitle" := source_listing.title;
    "priceCents" := source_listing."priceCents";
    currency := source_listing.currency;
    "sellerName" := source_listing.seller_name;
    created := false;
    RETURN NEXT;
    RETURN;
  END IF;

  message_sent_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
  INSERT INTO public."Message" (
    id,
    "conversationId",
    "senderId",
    "recipientId",
    "contextListingId",
    body,
    kind,
    "isSystemMessage",
    "createdAt"
  ) VALUES (
    p_message_id,
    source_listing.conversation_id,
    source_listing.seller_user_id,
    source_listing.buyer_user_id,
    source_listing.id,
    pg_catalog.jsonb_build_object(
      'listingId', source_listing.id,
      'title', source_listing.title,
      'priceCents', source_listing."priceCents",
      'currency', source_listing.currency
    )::text,
    'custom_order_link',
    true,
    message_sent_at
  );

  "messageId" := p_message_id;
  "conversationId" := source_listing.conversation_id;
  "sellerUserId" := source_listing.seller_user_id;
  "buyerUserId" := source_listing.buyer_user_id;
  "listingId" := source_listing.id;
  "listingTitle" := source_listing.title;
  "priceCents" := source_listing."priceCents";
  currency := source_listing.currency;
  "sellerName" := source_listing.seller_name;
  created := true;
  RETURN NEXT;
END;
$grainline_message_send_custom_order_ready$;

CREATE OR REPLACE FUNCTION public.grainline_user_custom_order_seller_state(
  p_buyer_id text,
  p_seller_user_id text
)
RETURNS TABLE (
  "userId" text,
  banned boolean,
  "deletedAt" timestamp(3),
  "sellerProfileId" text,
  "acceptsCustomOrders" boolean,
  "acceptingNewOrders" boolean,
  "stripeAccountId" text,
  "stripeAccountVersion" text,
  "chargesEnabled" boolean,
  "vacationMode" boolean,
  "displayName" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_custom_order_seller_state$
BEGIN
  IF p_buyer_id IS NULL
     OR p_buyer_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_user_id IS NULL
     OR p_seller_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_buyer_id = p_seller_user_id THEN
    RAISE EXCEPTION 'Custom-order seller input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller_user.id,
         seller_user.banned,
         seller_user."deletedAt",
         seller.id,
         seller."acceptsCustomOrders",
         seller."acceptingNewOrders",
         seller_private."stripeAccountId"::text,
         seller_private."stripeAccountVersion"::text,
         seller."chargesEnabled",
         seller."vacationMode",
         seller."displayName"::text
    FROM public."User" AS seller_user
    LEFT JOIN public."SellerProfile" AS seller
      ON seller."userId" = seller_user.id
    LEFT JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller_user.id = p_seller_user_id
     AND EXISTS (
       SELECT 1
         FROM public."User" AS buyer
        WHERE buyer.id = p_buyer_id
          AND buyer.banned = false
          AND buyer."deletedAt" IS NULL
     );
END
$grainline_user_custom_order_seller_state$;

COMMIT;
