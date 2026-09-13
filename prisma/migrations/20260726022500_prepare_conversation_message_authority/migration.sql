-- Promoted reviewed Conversation/Message functions-only authority migration.

-- Apply only through the guarded main-only production migration workflow.

-- docs/rls-drafts/conversation-message-recipient-access.sql sha256=51ae15ebb5e54dc4b8b083566a485c98a911fdcb65e8392a7f4efaefbf84e0c1
-- docs/rls-drafts/conversation-message-service-authority.sql sha256=c9accc77575c716aecbd6da7e87f957cf7c21a3aa25b0c4274afac0d6f130f30

BEGIN;

SET LOCAL lock_timeout = '10s';

SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.conversation-message.rls.activation', 0)
);

DO $grainline_conversation_message_authority_preflight$
DECLARE
  runtime_role record;
  table_state record;
  policy_count integer;
  candidate_function_count integer;
  invariant_trigger_count integer;
BEGIN
  SELECT rolsuper, rolinherit, rolcanlogin, rolreplication, rolbypassrls
    INTO runtime_role
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  IF NOT FOUND
     OR runtime_role.rolsuper
     OR runtime_role.rolinherit
     OR NOT runtime_role.rolcanlogin
     OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION
      'grainline_app_runtime role posture is not Conversation/Message-safe';
  END IF;

  FOR table_state IN
    SELECT class.relname, class.relrowsecurity, class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('Conversation', 'Message')
       AND class.relkind = 'r'
     ORDER BY class.relname
  LOOP
    IF table_state.relrowsecurity OR table_state.relforcerowsecurity THEN
      RAISE EXCEPTION '% RLS must remain disabled before authority preparation',
        table_state.relname;
    END IF;
  END LOOP;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation and Message tables are missing';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('Conversation', 'Message')
       AND class.relkind = 'r'
  ) <> 2 THEN
    RAISE EXCEPTION 'Conversation and Message table catalog is incomplete';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message');
  IF policy_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message policies must not exist before authority preparation';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO candidate_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY (ARRAY[
       'grainline_conversation_staff_report_visible',
       'grainline_conversation_get',
       'grainline_conversation_pair',
       'grainline_message_list',
       'grainline_message_unread_count',
       'grainline_message_latest_custom_request',
       'grainline_message_report_target_valid',
       'grainline_message_export',
       'grainline_conversation_inbox',
       'grainline_conversation_lock_pair_core',
       'grainline_conversation_listing_core',
       'grainline_conversation_get_or_create_core',
       'grainline_conversation_start',
       'grainline_message_send_ordinary',
       'grainline_conversation_set_archived',
       'grainline_message_mark_read',
       'grainline_conversation_claim_message_email',
       'grainline_message_send_custom_request',
       'grainline_message_create_commission_interest',
       'grainline_message_send_custom_order_ready',
       'grainline_account_deletion_email_key_core',
       'grainline_account_deletion_regex_escape_core',
       'grainline_account_deletion_redact_text_core',
       'grainline_message_redact_for_account_deletion',
       'grainline_seller_message_response_metrics'
     ]::text[]);
  IF candidate_function_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message authority functions already exist: %',
      candidate_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invariant_trigger_count
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS class ON class.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger.tgfoid
   WHERE namespace.nspname = 'public'
     AND trigger.tgenabled = 'O'
     AND (
       (
         class.relname = 'Conversation'
         AND trigger.tgname = 'grainline_conversation_participants_immutable'
         AND procedure.proname =
           'grainline_conversation_participants_immutable'
       )
       OR (
         class.relname = 'Message'
         AND trigger.tgname IN (
           'grainline_message_participants_match_conversation',
           'grainline_message_route_immutable',
           'grainline_message_maintain_thread_state'
         )
         AND procedure.proname = trigger.tgname
       )
     );
  IF invariant_trigger_count <> 4 THEN
    RAISE EXCEPTION
      'Conversation/Message invariant trigger catalog is incomplete: %',
      invariant_trigger_count;
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'Conversation/Message preparation requires old-application CRUD compatibility';
  END IF;
END
$grainline_conversation_message_authority_preflight$;

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
   WHERE conversation.id = p_conversation_id
     AND (
       p_user_id IN (conversation."userAId", conversation."userBId")
       OR public.grainline_conversation_staff_report_visible(conversation.id)
     );
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
  IF p_direction IS NULL OR p_direction NOT IN ('before', 'after') THEN
    RAISE EXCEPTION 'message page direction is invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_cursor_at IS NULL) <> (p_cursor_id IS NULL)
     OR (
       p_cursor_id IS NOT NULL
       AND (
         p_cursor_id = ''
         OR pg_catalog.char_length(p_cursor_id) > 191
       )
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
         p_user_id IN (message."senderId", message."recipientId")
         OR public.grainline_conversation_staff_report_visible(
              message."conversationId"
            )
       )
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
         p_user_id IN (message."senderId", message."recipientId")
         OR public.grainline_conversation_staff_report_visible(
              message."conversationId"
            )
       )
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
     AND (
       p_user_id IN (message."senderId", message."recipientId")
       OR public.grainline_conversation_staff_report_visible(
            message."conversationId"
          )
     )
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
     OR p_target_type IS NULL
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
  IF p_archived IS NULL THEN
    RAISE EXCEPTION 'conversation inbox archive state is invalid'
      USING ERRCODE = '22023';
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
  existing_message record;
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

    SELECT
      pg_catalog.count(*)::integer AS message_count,
      pg_catalog.min(message.id) AS message_id,
      pg_catalog.bool_and(
        message."senderId" = p_seller_user_id
        AND message."recipientId" = source_commission."buyerId"
        AND message."isSystemMessage" = true
      ) AS authority_valid
      INTO existing_message
      FROM public."Message" AS message
     WHERE message."conversationId" = source_interest."conversationId"
       AND message.kind = 'commission_interest_card'
       AND (message.body::jsonb)->>'commissionId' =
           p_commission_request_id;
    IF existing_message.message_count <> 1
       OR existing_message.authority_valid IS NOT TRUE THEN
      RAISE EXCEPTION 'commission interest message evidence is invalid'
        USING ERRCODE = '23514';
    END IF;

    "conversationId" := source_interest."conversationId";
    "messageId" := existing_message.message_id;
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
        '(?<![[:alnum:]])' || escaped_value || '(?![[:alnum:]])',
        '[deleted account]',
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

DO $grainline_conversation_message_authority_postflight$
DECLARE
  expected record;
  actual record;
  function_oid oid;
  function_count integer;
  policy_count integer;
  public_execute boolean;
  runtime_execute_grantable boolean;
  other_role_execute_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('Conversation', 'Message')
       AND (class.relrowsecurity OR class.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION
      'Conversation/Message authority preparation must retain disabled RLS';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message');
  IF policy_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message authority preparation must not install policies';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY (
       SELECT expected_name
         FROM (VALUES
           ('grainline_conversation_staff_report_visible'),
           ('grainline_conversation_get'),
           ('grainline_conversation_pair'),
           ('grainline_message_list'),
           ('grainline_message_unread_count'),
           ('grainline_message_latest_custom_request'),
           ('grainline_message_report_target_valid'),
           ('grainline_message_export'),
           ('grainline_conversation_inbox'),
           ('grainline_conversation_lock_pair_core'),
           ('grainline_conversation_listing_core'),
           ('grainline_conversation_get_or_create_core'),
           ('grainline_conversation_start'),
           ('grainline_message_send_ordinary'),
           ('grainline_conversation_set_archived'),
           ('grainline_message_mark_read'),
           ('grainline_conversation_claim_message_email'),
           ('grainline_message_send_custom_request'),
           ('grainline_message_create_commission_interest'),
           ('grainline_message_send_custom_order_ready'),
           ('grainline_account_deletion_email_key_core'),
           ('grainline_account_deletion_regex_escape_core'),
           ('grainline_account_deletion_redact_text_core'),
           ('grainline_message_redact_for_account_deletion'),
           ('grainline_seller_message_response_metrics')
         ) AS expected_function(expected_name)
     );
  IF function_count <> 25 THEN
    RAISE EXCEPTION
      'Conversation/Message authority function count drifted: %',
      function_count;
  END IF;

  FOR expected IN
    SELECT *
      FROM (VALUES
        (
      'grainline_conversation_staff_report_visible',
      'text',
      true,
      'sql',
      's',
      'u',
      true
    ),
    (
      'grainline_conversation_get',
      'text,text',
      false,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_conversation_pair',
      'text,text',
      false,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_message_list',
      'text,text,text,timestamp without time zone,text,integer',
      false,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_message_unread_count',
      'text',
      false,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_message_latest_custom_request',
      'text,text,text',
      false,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_message_report_target_valid',
      'text,text,text,text',
      false,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_message_export',
      'text',
      false,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_conversation_inbox',
      'text,boolean,text,timestamp without time zone,text,integer',
      false,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_conversation_lock_pair_core',
      'text,text',
      true,
      'plpgsql',
      'v',
      'u',
      false
    ),
    (
      'grainline_conversation_listing_core',
      'text,text,text',
      true,
      'plpgsql',
      'v',
      'u',
      false
    ),
    (
      'grainline_conversation_get_or_create_core',
      'text,text,text,text',
      true,
      'plpgsql',
      'v',
      'u',
      false
    ),
    (
      'grainline_conversation_start',
      'text,text,text,text',
      true,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_message_send_ordinary',
      'text,text,text,text,text,text',
      true,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_conversation_set_archived',
      'text,text,boolean',
      true,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_message_mark_read',
      'text,text',
      true,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_conversation_claim_message_email',
      'text,text',
      true,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_message_send_custom_request',
      'text,text,text,text,text,text,integer,text,text',
      true,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_message_create_commission_interest',
      'text,text,text,text,text',
      true,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_message_send_custom_order_ready',
      'text,text,text',
      true,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_account_deletion_email_key_core',
      'text',
      true,
      'plpgsql',
      'i',
      's',
      false
    ),
    (
      'grainline_account_deletion_regex_escape_core',
      'text',
      true,
      'plpgsql',
      'i',
      's',
      false
    ),
    (
      'grainline_account_deletion_redact_text_core',
      'text,text[]',
      true,
      'plpgsql',
      'i',
      's',
      false
    ),
    (
      'grainline_message_redact_for_account_deletion',
      'text',
      true,
      'plpgsql',
      'v',
      'u',
      true
    ),
    (
      'grainline_seller_message_response_metrics',
      'text,timestamp without time zone',
      true,
      'plpgsql',
      'v',
      'u',
      true
    )
      ) AS catalog(
        function_name,
        identity_arguments,
        security_definer,
        language_name,
        volatility,
        parallel_safety,
        runtime_execute
      )
  LOOP
    function_oid := pg_catalog.to_regprocedure(
      pg_catalog.format(
        'public.%I(%s)',
        expected.function_name,
        expected.identity_arguments
      )
    );
    IF function_oid IS NULL THEN
      RAISE EXCEPTION
        'Conversation/Message authority function signature is missing: %(%)',
        expected.function_name,
        expected.identity_arguments;
    END IF;

    SELECT
      procedure.prosecdef,
      procedure.proleakproof,
      procedure.provolatile,
      procedure.proparallel,
      procedure.prokind,
      procedure.proconfig,
      language.lanname,
      pg_catalog.pg_get_userbyid(procedure.proowner)
      INTO actual
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_language AS language
        ON language.oid = procedure.prolang
     WHERE procedure.oid = function_oid;

    IF actual.prosecdef IS DISTINCT FROM expected.security_definer
       OR actual.proleakproof
       OR actual.provolatile IS DISTINCT FROM expected.volatility
       OR actual.proparallel IS DISTINCT FROM expected.parallel_safety
       OR actual.prokind <> 'f'
       OR actual.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog']::text[]
       OR actual.lanname IS DISTINCT FROM expected.language_name
       OR actual.pg_get_userbyid IS DISTINCT FROM current_user THEN
      RAISE EXCEPTION
        'Conversation/Message authority catalog drifted for %',
        expected.function_name;
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
    ),
    EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee = (
               SELECT role.oid
                 FROM pg_catalog.pg_roles AS role
                WHERE role.rolname = 'grainline_app_runtime'
             )
         AND acl.privilege_type = 'EXECUTE'
         AND acl.is_grantable
    ),
    (
      SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee NOT IN (
         0,
         procedure.proowner,
         (
           SELECT role.oid
             FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = 'grainline_app_runtime'
         )
       )
         AND acl.privilege_type = 'EXECUTE'
    )
      INTO public_execute, runtime_execute_grantable,
           other_role_execute_count
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = function_oid;

    IF public_execute
       OR runtime_execute_grantable
       OR other_role_execute_count <> 0
       OR pg_catalog.has_function_privilege(
            'grainline_app_runtime',
            function_oid,
            'EXECUTE'
          ) IS DISTINCT FROM expected.runtime_execute THEN
      RAISE EXCEPTION
        'Conversation/Message authority ACL drifted for %',
        expected.function_name;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'Conversation/Message preparation narrowed old-application table CRUD';
  END IF;
END
$grainline_conversation_message_authority_postflight$;

COMMIT;
