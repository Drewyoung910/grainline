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
  existing record;
  valid_listing_id text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'conversation start requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;
  IF p_conversation_id IS NULL
     OR p_conversation_id !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'conversation id is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO pair
    FROM public.grainline_conversation_lock_pair_core(
      p_actor_id,
      p_other_user_id
    );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    913350,
    pg_catalog.hashtext(pair.user_a_id || ':' || pair.user_b_id)
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

  SELECT
    conversation.id,
    conversation."contextListingId"
    INTO existing
    FROM public."Conversation" AS conversation
   WHERE conversation."userAId" = pair.user_a_id
     AND conversation."userBId" = pair.user_b_id
   FOR UPDATE;

  IF FOUND THEN
    IF valid_listing_id IS NOT NULL
       AND existing."contextListingId" IS NULL THEN
      UPDATE public."Conversation" AS conversation
         SET "contextListingId" = valid_listing_id
       WHERE conversation.id = existing.id
         AND conversation."contextListingId" IS NULL;
      existing."contextListingId" := valid_listing_id;
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
    pair.user_a_id,
    pair.user_b_id,
    valid_listing_id,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  );
  "conversationId" := p_conversation_id;
  created := true;
  "contextListingId" := valid_listing_id;
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
  "sentAt" := pg_catalog.clock_timestamp();
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
             WHEN p_archived THEN pg_catalog.clock_timestamp()
             ELSE NULL
           END
     WHERE conversation.id = p_conversation_id;
  ELSE
    UPDATE public."Conversation" AS conversation
       SET "archivedBAt" = CASE
             WHEN p_archived THEN pg_catalog.clock_timestamp()
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
     SET "readAt" = pg_catalog.clock_timestamp()
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

REVOKE ALL ON FUNCTION
  public.grainline_conversation_lock_pair_core(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_conversation_listing_core(text, text, text)
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
