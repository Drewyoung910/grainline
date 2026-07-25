-- DRAFT ONLY. Do not copy into prisma/migrations until the Conversation and
-- Message authority proof, app compatibility review, and Extra-High SQL review
-- all pass.
--
-- These are one-statement, SECURITY INVOKER recipient projections. Each public
-- projection accepts only the server-resolved local User.id, validates it
-- against the same bounded grammar as src/lib/dbUserContextState.ts, and sets
-- transaction-local app.user_id before touching an RLS-protected table.
--
-- The only SECURITY DEFINER read helper is the exact unresolved-report staff
-- predicate. It returns one boolean, derives the staff actor from app.user_id,
-- and never exposes arbitrary Conversation, Message, User, or UserReport rows.

CREATE OR REPLACE FUNCTION public.grainline_conversation_staff_report_visible(
  p_conversation_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_conversation_staff_report_visible$
  SELECT
    p_conversation_id IS NOT NULL
    AND p_conversation_id <> ''
    AND pg_catalog.char_length(p_conversation_id) <= 191
    AND EXISTS (
      SELECT 1
        FROM public."User" AS staff_user
       WHERE staff_user.id = NULLIF(
               pg_catalog.current_setting('app.user_id', true),
               ''
             )
         AND staff_user.role IN (
               'EMPLOYEE'::public."Role",
               'ADMIN'::public."Role"
             )
         AND staff_user.banned = false
         AND staff_user."deletedAt" IS NULL
    )
    AND EXISTS (
      SELECT 1
        FROM public."UserReport" AS report
       WHERE report."targetType" = 'MESSAGE_THREAD'
         AND report."targetId" = p_conversation_id
         AND report.resolved = false
    );
$grainline_conversation_staff_report_visible$;

CREATE OR REPLACE FUNCTION public.grainline_conversation_get(
  p_user_id text,
  p_conversation_id text
)
RETURNS TABLE (
  id text,
  "userAId" text,
  "userBId" text,
  "contextListingId" text,
  "createdAt" timestamp(3),
  "updatedAt" timestamp(3),
  "archivedAAt" timestamp(3),
  "archivedBAt" timestamp(3),
  "firstResponseAt" timestamp(3),
  "lastMessageEmailSentAt" timestamp(3)
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_conversation_get$
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'conversation actor is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_conversation_id IS NULL
     OR p_conversation_id = ''
     OR pg_catalog.char_length(p_conversation_id) > 191 THEN
    RAISE EXCEPTION 'conversation id is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'conversation actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  SELECT
    conversation.id,
    conversation."userAId",
    conversation."userBId",
    conversation."contextListingId",
    conversation."createdAt",
    conversation."updatedAt",
    conversation."archivedAAt",
    conversation."archivedBAt",
    conversation."firstResponseAt",
    conversation."lastMessageEmailSentAt"
    FROM public."Conversation" AS conversation
   WHERE conversation.id = p_conversation_id;
END;
$grainline_conversation_get$;

CREATE OR REPLACE FUNCTION public.grainline_conversation_pair(
  p_user_id text,
  p_other_user_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_conversation_pair$
DECLARE
  conversation_id text;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_other_user_id IS NULL
     OR p_other_user_id = ''
     OR pg_catalog.char_length(p_other_user_id) > 191
     OR p_other_user_id = p_user_id THEN
    RAISE EXCEPTION 'conversation pair is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'conversation actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  SELECT conversation.id
    INTO conversation_id
    FROM public."Conversation" AS conversation
   WHERE conversation."userAId" = LEAST(p_user_id, p_other_user_id)
     AND conversation."userBId" = GREATEST(p_user_id, p_other_user_id);
  RETURN conversation_id;
END;
$grainline_conversation_pair$;

CREATE OR REPLACE FUNCTION public.grainline_message_list(
  p_user_id text,
  p_conversation_id text,
  p_direction text,
  p_cursor_at timestamp(3),
  p_cursor_id text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  "conversationId" text,
  "senderId" text,
  "recipientId" text,
  body text,
  kind text,
  "contextListingId" text,
  "contextListingTitle" text,
  "createdAt" timestamp(3),
  "readAt" timestamp(3)
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_message_list$
DECLARE
  bounded_limit integer;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'message actor is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_conversation_id IS NULL
     OR p_conversation_id = ''
     OR pg_catalog.char_length(p_conversation_id) > 191 THEN
    RAISE EXCEPTION 'message conversation is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_direction NOT IN ('before', 'after') THEN
    RAISE EXCEPTION 'message page direction is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_cursor_id IS NOT NULL AND (
    p_cursor_at IS NULL
    OR p_cursor_id = ''
    OR pg_catalog.char_length(p_cursor_id) > 191
  ) THEN
    RAISE EXCEPTION 'message cursor is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_direction = 'before'
     AND (p_cursor_at IS NULL OR p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'older-message cursor is incomplete' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'message actor context was not set'
      USING ERRCODE = '55000';
  END IF;
  bounded_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 201));

  IF p_direction = 'before' THEN
    RETURN QUERY
    SELECT
      message.id,
      message."conversationId",
      message."senderId",
      message."recipientId",
      message.body::text,
      message.kind::text,
      message."contextListingId",
      listing.title::text,
      message."createdAt",
      message."readAt"
      FROM public."Message" AS message
      LEFT JOIN public."Listing" AS listing
        ON listing.id = message."contextListingId"
     WHERE message."conversationId" = p_conversation_id
       AND (
         message."createdAt" < p_cursor_at
         OR (
           message."createdAt" = p_cursor_at
           AND message.id < p_cursor_id
         )
       )
     ORDER BY message."createdAt" DESC, message.id DESC
     LIMIT bounded_limit;
  ELSE
    RETURN QUERY
    SELECT
      message.id,
      message."conversationId",
      message."senderId",
      message."recipientId",
      message.body::text,
      message.kind::text,
      message."contextListingId",
      listing.title::text,
      message."createdAt",
      message."readAt"
      FROM public."Message" AS message
      LEFT JOIN public."Listing" AS listing
        ON listing.id = message."contextListingId"
     WHERE message."conversationId" = p_conversation_id
       AND (
         p_cursor_at IS NULL
         OR message."createdAt" > p_cursor_at
         OR (
           p_cursor_id IS NOT NULL
           AND message."createdAt" = p_cursor_at
           AND message.id > p_cursor_id
         )
       )
     ORDER BY message."createdAt" ASC, message.id ASC
     LIMIT bounded_limit;
  END IF;
END;
$grainline_message_list$;

CREATE OR REPLACE FUNCTION public.grainline_message_unread_count(
  p_user_id text
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_message_unread_count$
DECLARE
  unread_count bigint;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'message actor is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'message actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)
    INTO unread_count
    FROM public."Message" AS message
    JOIN public."Conversation" AS conversation
      ON conversation.id = message."conversationId"
   WHERE message."recipientId" = p_user_id
     AND message."readAt" IS NULL
     AND (
       (conversation."userAId" = p_user_id
        AND conversation."archivedAAt" IS NULL)
       OR
       (conversation."userBId" = p_user_id
        AND conversation."archivedBAt" IS NULL)
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS block
        WHERE (
          block."blockerId" = conversation."userAId"
          AND block."blockedId" = conversation."userBId"
        )
        OR (
          block."blockerId" = conversation."userBId"
          AND block."blockedId" = conversation."userAId"
        )
     );
  RETURN unread_count;
END;
$grainline_message_unread_count$;

CREATE OR REPLACE FUNCTION public.grainline_message_latest_custom_request(
  p_user_id text,
  p_conversation_id text,
  p_buyer_user_id text
)
RETURNS TABLE (
  body text,
  "createdAt" timestamp(3)
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_message_latest_custom_request$
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'message actor is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_conversation_id IS NULL
     OR p_conversation_id = ''
     OR pg_catalog.char_length(p_conversation_id) > 191
     OR p_buyer_user_id IS NULL
     OR p_buyer_user_id = ''
     OR pg_catalog.char_length(p_buyer_user_id) > 191 THEN
    RAISE EXCEPTION 'custom request lookup is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'message actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  SELECT message.body::text, message."createdAt"
    FROM public."Message" AS message
   WHERE message."conversationId" = p_conversation_id
     AND message."senderId" = p_buyer_user_id
     AND message.kind = 'custom_order_request'
   ORDER BY message."createdAt" DESC, message.id DESC
   LIMIT 1;
END;
$grainline_message_latest_custom_request$;

CREATE OR REPLACE FUNCTION public.grainline_message_report_target_valid(
  p_user_id text,
  p_reported_user_id text,
  p_target_type text,
  p_target_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_message_report_target_valid$
DECLARE
  target_valid boolean;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'report actor is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_reported_user_id IS NULL
     OR p_reported_user_id = ''
     OR pg_catalog.char_length(p_reported_user_id) > 191
     OR p_target_type NOT IN ('MESSAGE', 'MESSAGE_THREAD')
     OR p_target_id IS NULL
     OR p_target_id = ''
     OR pg_catalog.char_length(p_target_id) > 191 THEN
    RAISE EXCEPTION 'message report target is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'report actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  IF p_target_type = 'MESSAGE' THEN
    SELECT EXISTS (
      SELECT 1
        FROM public."Message" AS message
       WHERE message.id = p_target_id
         AND p_reported_user_id IN (message."senderId", message."recipientId")
         AND p_user_id IN (message."senderId", message."recipientId")
    ) INTO target_valid;
  ELSE
    SELECT EXISTS (
      SELECT 1
        FROM public."Conversation" AS conversation
       WHERE conversation.id = p_target_id
         AND p_reported_user_id IN (
               conversation."userAId",
               conversation."userBId"
             )
         AND p_user_id IN (
               conversation."userAId",
               conversation."userBId"
             )
    ) INTO target_valid;
  END IF;
  RETURN target_valid;
END;
$grainline_message_report_target_valid$;

CREATE OR REPLACE FUNCTION public.grainline_message_export(
  p_user_id text
)
RETURNS TABLE (
  id text,
  "conversationId" text,
  "senderId" text,
  "recipientId" text,
  body text,
  kind text,
  "isSystemMessage" boolean,
  "readAt" timestamp(3),
  "createdAt" timestamp(3)
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_message_export$
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'message export actor is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'message export actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  SELECT
    message.id,
    message."conversationId",
    message."senderId",
    message."recipientId",
    message.body::text,
    message.kind::text,
    message."isSystemMessage",
    message."readAt",
    message."createdAt"
    FROM public."Message" AS message
   WHERE p_user_id IN (message."senderId", message."recipientId")
   ORDER BY message."createdAt" DESC, message.id DESC;
END;
$grainline_message_export$;

CREATE OR REPLACE FUNCTION public.grainline_conversation_inbox(
  p_user_id text,
  p_archived boolean,
  p_query text,
  p_before_at timestamp(3),
  p_before_id text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  "userAId" text,
  "userBId" text,
  "userAName" text,
  "userAImageUrl" text,
  "userBName" text,
  "userBImageUrl" text,
  "updatedAt" timestamp(3),
  "archivedAAt" timestamp(3),
  "archivedBAt" timestamp(3),
  "contextListingId" text,
  "contextListingTitle" text,
  "contextListingPhotoUrl" text,
  "latestMessageId" text,
  "latestMessageBody" text,
  "latestMessageKind" text,
  "latestMessageCreatedAt" timestamp(3),
  "latestMessageSenderId" text,
  "unreadCount" bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_conversation_inbox$
DECLARE
  bounded_limit integer;
  bounded_query text;
  search_pattern text;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'conversation inbox actor is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_query IS NOT NULL AND pg_catalog.char_length(p_query) > 200 THEN
    RAISE EXCEPTION 'conversation inbox query is too long' USING ERRCODE = '22023';
  END IF;
  IF (p_before_at IS NULL) <> (p_before_id IS NULL)
     OR (
       p_before_id IS NOT NULL
       AND (
         p_before_id = ''
         OR pg_catalog.char_length(p_before_id) > 191
       )
     ) THEN
    RAISE EXCEPTION 'conversation inbox cursor is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'conversation inbox actor context was not set'
      USING ERRCODE = '55000';
  END IF;
  bounded_limit := GREATEST(1, LEAST(COALESCE(p_limit, 51), 51));
  bounded_query := pg_catalog.btrim(COALESCE(p_query, ''));
  search_pattern := '%' ||
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(bounded_query, E'\\', E'\\\\'),
        '%',
        E'\\%'
      ),
      '_',
      E'\\_'
    ) || '%';

  RETURN QUERY
  SELECT
    conversation.id,
    conversation."userAId",
    conversation."userBId",
    user_a.name::text,
    user_a."imageUrl"::text,
    user_b.name::text,
    user_b."imageUrl"::text,
    conversation."updatedAt",
    conversation."archivedAAt",
    conversation."archivedBAt",
    listing.id,
    listing.title::text,
    listing_photo.url::text,
    latest_message.id,
    latest_message.body::text,
    latest_message.kind::text,
    latest_message."createdAt",
    latest_message."senderId",
    (
      SELECT pg_catalog.count(*)
        FROM public."Message" AS unread_message
       WHERE unread_message."conversationId" = conversation.id
         AND unread_message."recipientId" = p_user_id
         AND unread_message."readAt" IS NULL
    ) AS unread_count
    FROM public."Conversation" AS conversation
    JOIN public."User" AS user_a
      ON user_a.id = conversation."userAId"
    JOIN public."User" AS user_b
      ON user_b.id = conversation."userBId"
    JOIN LATERAL (
      SELECT
        message.id,
        message.body,
        message.kind,
        message."createdAt",
        message."senderId"
        FROM public."Message" AS message
       WHERE message."conversationId" = conversation.id
       ORDER BY message."createdAt" DESC, message.id DESC
       LIMIT 1
    ) AS latest_message ON true
    LEFT JOIN public."Listing" AS listing
      ON listing.id = conversation."contextListingId"
    LEFT JOIN LATERAL (
      SELECT photo.url
        FROM public."Photo" AS photo
       WHERE photo."listingId" = listing.id
       ORDER BY photo."sortOrder" ASC, photo.id ASC
       LIMIT 1
    ) AS listing_photo ON true
   WHERE p_user_id IN (conversation."userAId", conversation."userBId")
     AND (
       (
         p_archived
         AND (
           (conversation."userAId" = p_user_id
            AND conversation."archivedAAt" IS NOT NULL)
           OR
           (conversation."userBId" = p_user_id
            AND conversation."archivedBAt" IS NOT NULL)
         )
       )
       OR
       (
         NOT p_archived
         AND (
           (conversation."userAId" = p_user_id
            AND conversation."archivedAAt" IS NULL)
           OR
           (conversation."userBId" = p_user_id
            AND conversation."archivedBAt" IS NULL)
         )
       )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public."Block" AS block
        WHERE (
          block."blockerId" = conversation."userAId"
          AND block."blockedId" = conversation."userBId"
        )
        OR (
          block."blockerId" = conversation."userBId"
          AND block."blockedId" = conversation."userAId"
        )
     )
     AND (
       bounded_query = ''
       OR user_a.name ILIKE search_pattern ESCAPE '\'
       OR user_b.name ILIKE search_pattern ESCAPE '\'
       OR listing.title ILIKE search_pattern ESCAPE '\'
       OR EXISTS (
         SELECT 1
           FROM public."Message" AS searched_message
          WHERE searched_message."conversationId" = conversation.id
            AND searched_message.body ILIKE search_pattern ESCAPE '\'
       )
     )
     AND (
       p_before_at IS NULL
       OR conversation."updatedAt" < p_before_at
       OR (
         conversation."updatedAt" = p_before_at
         AND conversation.id < p_before_id
       )
     )
   ORDER BY conversation."updatedAt" DESC, conversation.id DESC
   LIMIT bounded_limit;
END;
$grainline_conversation_inbox$;

REVOKE ALL ON FUNCTION
  public.grainline_conversation_staff_report_visible(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_conversation_get(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_conversation_pair(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_message_list(text, text, text, timestamp, text, integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_message_unread_count(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_message_latest_custom_request(text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_message_report_target_valid(text, text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_message_export(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_conversation_inbox(
    text,
    boolean,
    text,
    timestamp,
    text,
    integer
  )
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_conversation_staff_report_visible(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_conversation_get(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_conversation_pair(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_message_list(text, text, text, timestamp, text, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_message_unread_count(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_message_latest_custom_request(text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_message_report_target_valid(text, text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_message_export(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_conversation_inbox(
    text,
    boolean,
    text,
    timestamp,
    text,
    integer
  )
  TO grainline_app_runtime;
