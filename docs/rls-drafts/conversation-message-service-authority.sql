-- DRAFT ONLY. Fixed Conversation/Message write authority for disposable proof.
-- Do not promote until every structured family, cleanup path, race and caller
-- conversion is complete.
--
-- Private cores are owner-only. The runtime role receives EXECUTE only on the
-- fixed public wrappers listed at the end; it never receives direct table DML.

CREATE OR REPLACE FUNCTION public.grainline_conversation_lock_pair_core(
  p_actor_id text,
  p_other_user_id text
)
RETURNS TABLE (
  user_a_id text,
  user_b_id text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_conversation_lock_pair_core$
DECLARE
  locked_count integer;
BEGIN
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_other_user_id IS NULL
     OR p_other_user_id = ''
     OR pg_catalog.char_length(p_other_user_id) > 191
     OR p_actor_id = p_other_user_id THEN
    RAISE EXCEPTION 'conversation participants are invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM account_user.id
    FROM public."User" AS account_user
   WHERE account_user.id IN (p_actor_id, p_other_user_id)
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
   ORDER BY account_user.id
   FOR SHARE;
  GET DIAGNOSTICS locked_count = ROW_COUNT;
  IF locked_count <> 2 THEN
    RAISE EXCEPTION 'conversation participant is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Block" AS block
     WHERE (
       block."blockerId" = p_actor_id
       AND block."blockedId" = p_other_user_id
     )
     OR (
       block."blockerId" = p_other_user_id
       AND block."blockedId" = p_actor_id
     )
  ) THEN
    RAISE EXCEPTION 'conversation participant pair is blocked'
      USING ERRCODE = '42501';
  END IF;

  user_a_id := LEAST(p_actor_id, p_other_user_id);
  user_b_id := GREATEST(p_actor_id, p_other_user_id);
  RETURN NEXT;
END;
$grainline_conversation_lock_pair_core$;

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
     AND (
       seller."stripeAccountVersion" IS NULL
       OR seller."stripeAccountVersion" = 'v2'
     )
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

CREATE OR REPLACE FUNCTION public.grainline_conversation_get_or_create_core(
  p_conversation_id text,
  p_user_a_id text,
  p_user_b_id text,
  p_context_listing_id text
)
RETURNS TABLE (
  "conversationId" text,
  created boolean,
  "contextListingId" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_conversation_get_or_create_core$
DECLARE
  existing record;
BEGIN
  IF p_conversation_id IS NULL
     OR p_conversation_id !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_user_a_id IS NULL
     OR p_user_b_id IS NULL
     OR p_user_a_id >= p_user_b_id THEN
    RAISE EXCEPTION 'canonical conversation source is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    913350,
    pg_catalog.hashtext(p_user_a_id || ':' || p_user_b_id)
  );

  SELECT
    conversation.id,
    conversation."contextListingId"
    INTO existing
    FROM public."Conversation" AS conversation
   WHERE conversation."userAId" = p_user_a_id
     AND conversation."userBId" = p_user_b_id
   FOR UPDATE;

  IF FOUND THEN
    IF p_context_listing_id IS NOT NULL
       AND existing."contextListingId" IS NULL THEN
      UPDATE public."Conversation" AS conversation
         SET "contextListingId" = p_context_listing_id
       WHERE conversation.id = existing.id
         AND conversation."contextListingId" IS NULL;
      existing."contextListingId" := p_context_listing_id;
    END IF;
    "conversationId" := existing.id;
    created := false;
    "contextListingId" := existing."contextListingId";
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public."Conversation" (
    id,
    "userAId",
    "userBId",
    "contextListingId",
    "createdAt",
    "updatedAt"
  ) VALUES (
    p_conversation_id,
    p_user_a_id,
    p_user_b_id,
    p_context_listing_id,
    pg_catalog.timezone('UTC', pg_catalog.clock_timestamp()),
    pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
  );
  "conversationId" := p_conversation_id;
  created := true;
  "contextListingId" := p_context_listing_id;
  RETURN NEXT;
END;
$grainline_conversation_get_or_create_core$;

CREATE OR REPLACE FUNCTION public.grainline_conversation_start(
  p_conversation_id text,
  p_actor_id text,
  p_other_user_id text,
  p_listing_id text
)
RETURNS TABLE (
  "conversationId" text,
  created boolean,
  "contextListingId" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_conversation_start$
DECLARE
  pair record;
  conversation_result record;
  valid_listing_id text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'conversation start requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;
  SELECT *
    INTO pair
    FROM public.grainline_conversation_lock_pair_core(
      p_actor_id,
      p_other_user_id
    );

  valid_listing_id := public.grainline_conversation_listing_core(
    pair.user_a_id,
    pair.user_b_id,
    p_listing_id
  );
  IF p_listing_id IS NOT NULL AND valid_listing_id IS NULL THEN
    RAISE EXCEPTION 'conversation listing is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO conversation_result
    FROM public.grainline_conversation_get_or_create_core(
    p_conversation_id,
    pair.user_a_id,
    pair.user_b_id,
    valid_listing_id
  );
  "conversationId" := conversation_result."conversationId";
  created := conversation_result.created;
  "contextListingId" := conversation_result."contextListingId";
  RETURN NEXT;
END;
$grainline_conversation_start$;

CREATE OR REPLACE FUNCTION public.grainline_message_send_ordinary(
  p_message_id text,
  p_actor_id text,
  p_conversation_id text,
  p_body text,
  p_kind text,
  p_context_listing_id text
)
RETURNS TABLE (
  "messageId" text,
  "recipientId" text,
  "sentAt" timestamp(3),
  "firstResponseSet" boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_message_send_ordinary$
DECLARE
  initial_conversation record;
  locked_conversation record;
  pair record;
  valid_listing_id text;
  parsed_file jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'message send requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;
  IF p_message_id IS NULL
     OR p_message_id !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'message id is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_conversation_id IS NULL
     OR p_conversation_id = ''
     OR pg_catalog.char_length(p_conversation_id) > 191
     OR p_body IS NULL
     OR p_body = ''
     OR pg_catalog.char_length(p_body) > 5000
     OR (p_kind IS NOT NULL AND p_kind <> 'file') THEN
    RAISE EXCEPTION 'ordinary message input is invalid' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'file' THEN
    BEGIN
      parsed_file := p_body::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'file message payload is invalid' USING ERRCODE = '22023';
    END;
    IF pg_catalog.jsonb_typeof(parsed_file) <> 'object'
       OR parsed_file->>'kind' <> 'file'
       OR COALESCE(parsed_file->>'url', '') = ''
       OR pg_catalog.char_length(parsed_file->>'url') > 2048
       OR pg_catalog.char_length(COALESCE(parsed_file->>'name', '')) > 255
       OR pg_catalog.char_length(COALESCE(parsed_file->>'type', '')) > 100 THEN
      RAISE EXCEPTION 'file message payload is invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT
    conversation."userAId",
    conversation."userBId"
    INTO initial_conversation
    FROM public."Conversation" AS conversation
   WHERE conversation.id = p_conversation_id;
  IF NOT FOUND OR p_actor_id NOT IN (
    initial_conversation."userAId",
    initial_conversation."userBId"
  ) THEN
    RAISE EXCEPTION 'message conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO pair
    FROM public.grainline_conversation_lock_pair_core(
      p_actor_id,
      CASE
        WHEN initial_conversation."userAId" = p_actor_id
          THEN initial_conversation."userBId"
        ELSE initial_conversation."userAId"
      END
    );

  valid_listing_id := public.grainline_conversation_listing_core(
    pair.user_a_id,
    pair.user_b_id,
    p_context_listing_id
  );
  IF p_context_listing_id IS NOT NULL AND valid_listing_id IS NULL THEN
    RAISE EXCEPTION 'message listing context is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    conversation.id,
    conversation."userAId",
    conversation."userBId",
    conversation."firstResponseAt"
    INTO locked_conversation
    FROM public."Conversation" AS conversation
   WHERE conversation.id = p_conversation_id
     AND conversation."userAId" = pair.user_a_id
     AND conversation."userBId" = pair.user_b_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'message conversation changed during send'
      USING ERRCODE = '40001';
  END IF;

  "recipientId" := CASE
    WHEN locked_conversation."userAId" = p_actor_id
      THEN locked_conversation."userBId"
    ELSE locked_conversation."userAId"
  END;
  "sentAt" := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
  "messageId" := p_message_id;
  "firstResponseSet" := false;

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
    p_conversation_id,
    p_actor_id,
    "recipientId",
    valid_listing_id,
    p_body,
    p_kind,
    false,
    "sentAt"
  );

  IF locked_conversation."firstResponseAt" IS NULL
     AND EXISTS (
       SELECT 1
         FROM public."Message" AS prior_message
        WHERE prior_message."conversationId" = p_conversation_id
          AND prior_message."senderId" <> p_actor_id
          AND prior_message.id <> p_message_id
     ) THEN
    UPDATE public."Conversation" AS conversation
       SET "firstResponseAt" = "sentAt"
     WHERE conversation.id = p_conversation_id
       AND conversation."firstResponseAt" IS NULL;
    "firstResponseSet" := FOUND;
  END IF;
  RETURN NEXT;
END;
$grainline_message_send_ordinary$;

CREATE OR REPLACE FUNCTION public.grainline_conversation_set_archived(
  p_actor_id text,
  p_conversation_id text,
  p_archived boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_conversation_set_archived$
DECLARE
  actor_is_a boolean;
BEGIN
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_conversation_id IS NULL
     OR p_conversation_id = ''
     OR pg_catalog.char_length(p_conversation_id) > 191
     OR p_archived IS NULL THEN
    RAISE EXCEPTION 'conversation archive input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM account_user.id
    FROM public."User" AS account_user
   WHERE account_user.id = p_actor_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation archive actor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT conversation."userAId" = p_actor_id
    INTO actor_is_a
    FROM public."Conversation" AS conversation
   WHERE conversation.id = p_conversation_id
     AND p_actor_id IN (conversation."userAId", conversation."userBId")
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF actor_is_a THEN
    UPDATE public."Conversation" AS conversation
       SET "archivedAAt" = CASE
             WHEN p_archived
               THEN pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
             ELSE NULL
           END
     WHERE conversation.id = p_conversation_id;
  ELSE
    UPDATE public."Conversation" AS conversation
       SET "archivedBAt" = CASE
             WHEN p_archived
               THEN pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
             ELSE NULL
           END
     WHERE conversation.id = p_conversation_id;
  END IF;
  RETURN true;
END;
$grainline_conversation_set_archived$;

CREATE OR REPLACE FUNCTION public.grainline_message_mark_read(
  p_actor_id text,
  p_conversation_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_message_mark_read$
DECLARE
  updated_count integer;
BEGIN
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_conversation_id IS NULL
     OR p_conversation_id = ''
     OR pg_catalog.char_length(p_conversation_id) > 191 THEN
    RAISE EXCEPTION 'message mark-read input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM account_user.id
    FROM public."User" AS account_user
   WHERE account_user.id = p_actor_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'message mark-read actor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM conversation.id
    FROM public."Conversation" AS conversation
   WHERE conversation.id = p_conversation_id
     AND p_actor_id IN (conversation."userAId", conversation."userBId")
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE public."Message" AS message
     SET "readAt" = pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
   WHERE message."conversationId" = p_conversation_id
     AND message."recipientId" = p_actor_id
     AND message."readAt" IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$grainline_message_mark_read$;

CREATE OR REPLACE FUNCTION public.grainline_conversation_claim_message_email(
  p_actor_id text,
  p_message_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_conversation_claim_message_email$
DECLARE
  source_message record;
BEGIN
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_message_id IS NULL
     OR p_message_id = ''
     OR pg_catalog.char_length(p_message_id) > 191 THEN
    RAISE EXCEPTION 'message email claim input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    message."conversationId",
    message."createdAt"
    INTO source_message
    FROM public."Message" AS message
   WHERE message.id = p_message_id
     AND message."senderId" = p_actor_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM conversation.id
    FROM public."Conversation" AS conversation
   WHERE conversation.id = source_message."conversationId"
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public."Conversation" AS conversation
     SET "lastMessageEmailSentAt" = source_message."createdAt"
   WHERE conversation.id = source_message."conversationId"
     AND (
       conversation."lastMessageEmailSentAt" IS NULL
       OR conversation."lastMessageEmailSentAt"
            < source_message."createdAt" - interval '5 minutes'
     );
  RETURN FOUND;
END;
$grainline_conversation_claim_message_email$;

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
   WHERE seller."userId" = p_seller_id
     AND seller."acceptsCustomOrders" = true
     AND seller."acceptingNewOrders" = true
     AND seller."stripeAccountId" IS NOT NULL
     AND seller."chargesEnabled" = true
     AND seller."vacationMode" = false
     AND (
       seller."stripeAccountVersion" IS NULL
       OR seller."stripeAccountVersion" = 'v2'
     )
   FOR SHARE;
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

CREATE OR REPLACE FUNCTION public.grainline_message_create_commission_interest(
  p_conversation_id text,
  p_message_id text,
  p_interest_id text,
  p_seller_user_id text,
  p_commission_request_id text
)
RETURNS TABLE (
  "conversationId" text,
  "messageId" text,
  "commissionInterestId" text,
  "buyerUserId" text,
  "commissionTitle" text,
  "sellerDisplayName" text,
  created boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_message_create_commission_interest$
DECLARE
  initial_buyer_id text;
  pair record;
  source_seller record;
  source_commission record;
  source_interest record;
  conversation_result record;
  message_sent_at timestamp(3);
  interest_id text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'commission interest requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;
  IF p_conversation_id IS NULL
     OR p_conversation_id !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_message_id IS NULL
     OR p_message_id !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_interest_id IS NULL
     OR p_interest_id !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_commission_request_id IS NULL
     OR p_commission_request_id = ''
     OR pg_catalog.char_length(p_commission_request_id) > 191 THEN
    RAISE EXCEPTION 'commission interest input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT commission."buyerId"
    INTO initial_buyer_id
    FROM public."CommissionRequest" AS commission
   WHERE commission.id = p_commission_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commission request is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO pair
    FROM public.grainline_conversation_lock_pair_core(
      p_seller_user_id,
      initial_buyer_id
    );

  SELECT
    seller.id,
    COALESCE(seller."displayName", seller_user.name, 'A maker')::text
      AS display_name
    INTO source_seller
    FROM public."SellerProfile" AS seller
    JOIN public."User" AS seller_user
      ON seller_user.id = seller."userId"
   WHERE seller."userId" = p_seller_user_id
     AND seller."chargesEnabled" = true
     AND seller."vacationMode" = false
   FOR SHARE OF seller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commission seller is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    commission."buyerId",
    commission.title::text,
    commission."budgetMinCents",
    commission."budgetMaxCents",
    commission.timeline::text
    INTO source_commission
    FROM public."CommissionRequest" AS commission
   WHERE commission.id = p_commission_request_id
     AND commission."buyerId" = initial_buyer_id
     AND commission.status = 'OPEN'::public."CommissionStatus"
     AND (
       commission."expiresAt" IS NULL
       OR commission."expiresAt" >
          pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
     )
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commission request is closed'
      USING ERRCODE = '42501';
  END IF;

  SELECT interest.id, interest."conversationId"
    INTO source_interest
    FROM public."CommissionInterest" AS interest
   WHERE interest."commissionRequestId" = p_commission_request_id
     AND interest."sellerProfileId" = source_seller.id
   FOR UPDATE;

  IF FOUND AND source_interest."conversationId" IS NOT NULL THEN
    PERFORM conversation.id
      FROM public."Conversation" AS conversation
     WHERE conversation.id = source_interest."conversationId"
       AND conversation."userAId" = pair.user_a_id
       AND conversation."userBId" = pair.user_b_id
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'commission interest conversation is invalid'
        USING ERRCODE = '23514';
    END IF;
    "conversationId" := source_interest."conversationId";
    "messageId" := NULL;
    "commissionInterestId" := source_interest.id;
    "buyerUserId" := source_commission."buyerId";
    "commissionTitle" := source_commission.title;
    "sellerDisplayName" := source_seller.display_name;
    created := false;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT *
    INTO conversation_result
    FROM public.grainline_conversation_get_or_create_core(
      p_conversation_id,
      pair.user_a_id,
      pair.user_b_id,
      NULL
    );

  PERFORM conversation.id
    FROM public."Conversation" AS conversation
   WHERE conversation.id = conversation_result."conversationId"
     AND conversation."userAId" = pair.user_a_id
     AND conversation."userBId" = pair.user_b_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commission conversation changed'
      USING ERRCODE = '40001';
  END IF;

  IF source_interest.id IS NULL THEN
    INSERT INTO public."CommissionInterest" (
      id,
      "commissionRequestId",
      "sellerProfileId",
      "conversationId",
      "createdAt"
    ) VALUES (
      p_interest_id,
      p_commission_request_id,
      source_seller.id,
      conversation_result."conversationId",
      pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
    )
    RETURNING id INTO interest_id;
  ELSE
    UPDATE public."CommissionInterest" AS interest
       SET "conversationId" = conversation_result."conversationId"
     WHERE interest.id = source_interest.id
       AND interest."conversationId" IS NULL
    RETURNING interest.id INTO interest_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'commission interest changed'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  message_sent_at := pg_catalog.timezone('UTC', pg_catalog.clock_timestamp());
  INSERT INTO public."Message" (
    id,
    "conversationId",
    "senderId",
    "recipientId",
    body,
    kind,
    "isSystemMessage",
    "createdAt"
  ) VALUES (
    p_message_id,
    conversation_result."conversationId",
    p_seller_user_id,
    source_commission."buyerId",
    pg_catalog.jsonb_build_object(
      'commissionId', p_commission_request_id,
      'commissionTitle', source_commission.title,
      'sellerName', source_seller.display_name,
      'budgetMinCents', source_commission."budgetMinCents",
      'budgetMaxCents', source_commission."budgetMaxCents",
      'timeline', source_commission.timeline
    )::text,
    'commission_interest_card',
    true,
    message_sent_at
  );

  UPDATE public."CommissionRequest" AS commission
     SET "interestedCount" = (
       SELECT pg_catalog.count(*)::integer
         FROM public."CommissionInterest" AS interest
        WHERE interest."commissionRequestId" = p_commission_request_id
     ),
         "updatedAt" = message_sent_at
   WHERE commission.id = p_commission_request_id;

  "conversationId" := conversation_result."conversationId";
  "messageId" := p_message_id;
  "commissionInterestId" := interest_id;
  "buyerUserId" := source_commission."buyerId";
  "commissionTitle" := source_commission.title;
  "sellerDisplayName" := source_seller.display_name;
  created := true;
  RETURN NEXT;
END;
$grainline_message_create_commission_interest$;

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
  existing_message_id text;
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
   WHERE listing.id = p_listing_id
     AND listing.status = 'ACTIVE'::public."ListingStatus"
     AND listing."isPrivate" = true
     AND listing."reservedForUserId" = initial_source.buyer_user_id
     AND listing."customOrderConversationId" = initial_source.conversation_id
     AND seller."userId" = p_seller_user_id
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountId" IS NOT NULL
     AND (
       seller."stripeAccountVersion" IS NULL
       OR seller."stripeAccountVersion" = 'v2'
     )
     AND seller."vacationMode" = false
   FOR SHARE OF listing, seller;
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

  SELECT message.id
    INTO existing_message_id
    FROM public."Message" AS message
   WHERE message."conversationId" = source_listing.conversation_id
     AND message."contextListingId" = source_listing.id
     AND message.kind = 'custom_order_link'
   ORDER BY message."createdAt", message.id
   LIMIT 1;
  IF FOUND THEN
    "messageId" := existing_message_id;
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

CREATE OR REPLACE FUNCTION public.grainline_account_deletion_email_key_core(
  p_email text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_account_deletion_email_key_core$
DECLARE
  normalized text;
  local_part text;
  domain_part text;
BEGIN
  normalized := pg_catalog.lower(pg_catalog.btrim(p_email));
  IF normalized = '' OR pg_catalog.strpos(normalized, '@') = 0 THEN
    RETURN NULL;
  END IF;
  IF pg_catalog.strpos(
       pg_catalog.substr(
         normalized,
         pg_catalog.strpos(normalized, '@') + 1
       ),
       '@'
     ) > 0 THEN
    RETURN normalized;
  END IF;

  local_part := pg_catalog.split_part(normalized, '@', 1);
  domain_part := pg_catalog.split_part(normalized, '@', 2);
  IF domain_part = 'googlemail.com' THEN
    domain_part := 'gmail.com';
  END IF;
  IF domain_part <> 'gmail.com' THEN
    RETURN normalized;
  END IF;

  local_part := pg_catalog.replace(
    pg_catalog.split_part(local_part, '+', 1),
    '.',
    ''
  );
  IF local_part = '' THEN
    RETURN normalized;
  END IF;
  RETURN local_part || '@gmail.com';
END;
$grainline_account_deletion_email_key_core$;

CREATE OR REPLACE FUNCTION public.grainline_account_deletion_regex_escape_core(
  p_value text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_account_deletion_regex_escape_core$
DECLARE
  escaped text := '';
  character text;
  character_index integer;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;
  FOR character_index IN 1..pg_catalog.char_length(p_value) LOOP
    character := pg_catalog.substr(p_value, character_index, 1);
    IF character = ANY (
      ARRAY['\', '.', '^', '$', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}']
    ) THEN
      escaped := escaped || E'\\' || character;
    ELSE
      escaped := escaped || character;
    END IF;
  END LOOP;
  RETURN escaped;
END;
$grainline_account_deletion_regex_escape_core$;

CREATE OR REPLACE FUNCTION public.grainline_account_deletion_redact_text_core(
  p_body text,
  p_sensitive_values text[]
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_account_deletion_redact_text_core$
DECLARE
  redacted text := p_body;
  sensitive_value text;
  escaped_value text;
BEGIN
  IF p_body IS NULL OR p_sensitive_values IS NULL THEN
    RETURN p_body;
  END IF;

  FOREACH sensitive_value IN ARRAY p_sensitive_values LOOP
    escaped_value :=
      public.grainline_account_deletion_regex_escape_core(sensitive_value);
    IF pg_catalog.char_length(sensitive_value) >= 3 THEN
      redacted := pg_catalog.regexp_replace(
        redacted,
        escaped_value,
        '[deleted account]',
        'gi'
      );
    ELSE
      redacted := pg_catalog.regexp_replace(
        redacted,
        '(^|[^[:alnum:]])' || escaped_value || '([^[:alnum:]]|$)',
        E'\\1[deleted account]\\2',
        'gi'
      );
    END IF;
  END LOOP;
  RETURN redacted;
END;
$grainline_account_deletion_redact_text_core$;

CREATE OR REPLACE FUNCTION public.grainline_message_redact_for_account_deletion(
  p_actor_id text
)
RETURNS TABLE (
  "sentRedacted" integer,
  "receivedRedacted" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_message_redact_for_account_deletion$
DECLARE
  sensitive_values text[];
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'account deletion redaction requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'account deletion actor is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM account_user.id
    FROM public."User" AS account_user
   WHERE account_user.id = p_actor_id
     AND account_user."deletedAt" IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account deletion actor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  WITH raw_sensitive_value(value) AS (
    SELECT profile_value.value
      FROM public."User" AS account_user
      LEFT JOIN public."SellerProfile" AS seller
        ON seller."userId" = account_user.id
      CROSS JOIN LATERAL pg_catalog.unnest(ARRAY[
        account_user.id,
        account_user."clerkId",
        account_user.email,
        account_user.name,
        account_user."shippingName",
        account_user."shippingLine1",
        account_user."shippingLine2",
        account_user."shippingCity",
        account_user."shippingState",
        account_user."shippingPostalCode",
        account_user."shippingPhone",
        seller.id,
        seller."displayName",
        seller.city,
        seller.state,
        seller."shipFromName",
        seller."shipFromLine1",
        seller."shipFromLine2",
        seller."shipFromCity",
        seller."shipFromState",
        seller."shipFromPostal",
        seller.tagline,
        seller."bannerImageUrl",
        seller."avatarImageUrl",
        seller."workshopImageUrl",
        seller."instagramUrl",
        seller."facebookUrl",
        seller."pinterestUrl",
        seller."tiktokUrl",
        seller."websiteUrl"
      ]::text[]) AS profile_value(value)
     WHERE account_user.id = p_actor_id

    UNION ALL

    SELECT address.email
      FROM public."UserEmailAddress" AS address
     WHERE address."userId" = p_actor_id
       AND NOT EXISTS (
         SELECT 1
           FROM public."User" AS other_user
          WHERE other_user.id <> p_actor_id
            AND other_user."deletedAt" IS NULL
            AND public.grainline_account_deletion_email_key_core(
                  other_user.email
                ) = public.grainline_account_deletion_email_key_core(
                  address.email
                )
       )
  ),
  normalized_sensitive_value AS (
    SELECT DISTINCT pg_catalog.lower(pg_catalog.btrim(value)) AS value
      FROM raw_sensitive_value
     WHERE value IS NOT NULL
       AND pg_catalog.char_length(
             pg_catalog.lower(pg_catalog.btrim(value))
           ) >= 2
  )
  SELECT COALESCE(
           pg_catalog.array_agg(
             value
             ORDER BY pg_catalog.char_length(value) DESC, value
           ),
           ARRAY[]::text[]
         )
    INTO sensitive_values
    FROM normalized_sensitive_value;

  UPDATE public."Message" AS message
     SET body = '[Message deleted]'
   WHERE message."senderId" = p_actor_id
     AND message.body IS DISTINCT FROM '[Message deleted]';
  GET DIAGNOSTICS "sentRedacted" = ROW_COUNT;

  WITH redaction AS (
    SELECT
      message.id,
      public.grainline_account_deletion_redact_text_core(
        message.body,
        sensitive_values
      ) AS redacted_body
      FROM public."Message" AS message
     WHERE message."senderId" <> p_actor_id
       AND message."recipientId" = p_actor_id
  )
  UPDATE public."Message" AS message
     SET body = redaction.redacted_body
    FROM redaction
   WHERE message.id = redaction.id
     AND message.body IS DISTINCT FROM redaction.redacted_body;
  GET DIAGNOSTICS "receivedRedacted" = ROW_COUNT;
  RETURN NEXT;
END;
$grainline_message_redact_for_account_deletion$;

CREATE OR REPLACE FUNCTION public.grainline_seller_message_response_metrics(
  p_seller_user_id text,
  p_period_start timestamp(3)
)
RETURNS TABLE (
  "buyerInitiatedCount" bigint,
  "sellerRespondedCount" bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_message_response_metrics$
BEGIN
  IF p_seller_user_id IS NULL
     OR p_seller_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_period_start IS NULL
     OR p_period_start >
        pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
     OR p_period_start <
        pg_catalog.timezone('UTC', pg_catalog.clock_timestamp())
          - interval '400 days' THEN
    RAISE EXCEPTION 'seller response metric input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."SellerProfile" AS seller
     WHERE seller."userId" = p_seller_user_id
  ) THEN
    RAISE EXCEPTION 'seller response metric source is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH seller_conversation AS (
    SELECT conversation.id
      FROM public."Conversation" AS conversation
     WHERE p_seller_user_id IN (
             conversation."userAId",
             conversation."userBId"
           )
       AND conversation."createdAt" >= p_period_start
  ),
  first_message AS (
    SELECT DISTINCT ON (message."conversationId")
      message."conversationId",
      message.id AS first_message_id,
      message."senderId" AS first_sender_id,
      message."createdAt" AS first_message_at
      FROM public."Message" AS message
      JOIN seller_conversation
        ON seller_conversation.id = message."conversationId"
     ORDER BY
       message."conversationId",
       message."createdAt",
       message.id
  ),
  buyer_initiated AS (
    SELECT
      first_message."conversationId",
      first_message.first_message_id,
      first_message.first_message_at
      FROM first_message
     WHERE first_message.first_sender_id <> p_seller_user_id
  ),
  seller_response AS (
    SELECT DISTINCT buyer_initiated."conversationId"
      FROM buyer_initiated
      JOIN public."Message" AS response
        ON response."conversationId" = buyer_initiated."conversationId"
       AND response."senderId" = p_seller_user_id
       AND (
         response."createdAt" > buyer_initiated.first_message_at
         OR (
           response."createdAt" = buyer_initiated.first_message_at
           AND response.id > buyer_initiated.first_message_id
         )
       )
  )
  SELECT
    pg_catalog.count(buyer_initiated."conversationId")::bigint,
    pg_catalog.count(seller_response."conversationId")::bigint
    FROM buyer_initiated
    LEFT JOIN seller_response
      ON seller_response."conversationId" =
         buyer_initiated."conversationId";
END;
$grainline_seller_message_response_metrics$;

REVOKE ALL ON FUNCTION
  public.grainline_conversation_lock_pair_core(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_conversation_listing_core(text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_conversation_get_or_create_core(text, text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_email_key_core(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_regex_escape_core(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_redact_text_core(text, text[])
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_conversation_start(text, text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_message_send_ordinary(text, text, text, text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_conversation_set_archived(text, text, boolean)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_message_mark_read(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_conversation_claim_message_email(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_message_send_custom_request(
    text, text, text, text, text, text, integer, text, text
  )
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_message_create_commission_interest(
    text, text, text, text, text
  )
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_message_send_custom_order_ready(text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_message_redact_for_account_deletion(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_seller_message_response_metrics(text, timestamp)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_conversation_start(text, text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_message_send_ordinary(text, text, text, text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_conversation_set_archived(text, text, boolean)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_message_mark_read(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_conversation_claim_message_email(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_message_send_custom_request(
    text, text, text, text, text, text, integer, text, text
  )
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_message_create_commission_interest(
    text, text, text, text, text
  )
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_message_send_custom_order_ready(text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_message_redact_for_account_deletion(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_message_response_metrics(text, timestamp)
  TO grainline_app_runtime;
