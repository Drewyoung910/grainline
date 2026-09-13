-- Durable Conversation/Message row-shape invariants. RLS is intentionally
-- still off in this preparation phase; policies and grant narrowing land in
-- later, separately reviewed migrations.
BEGIN;

DO $grainline_conversation_message_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."Conversation"
     WHERE "userAId" >= "userBId"
  ) THEN
    RAISE EXCEPTION 'Conversation participants are not distinct canonical pairs';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Message" AS message
      JOIN public."Conversation" AS conversation
        ON conversation.id = message."conversationId"
     WHERE NOT (
       (message."senderId" = conversation."userAId"
        AND message."recipientId" = conversation."userBId")
       OR
       (message."senderId" = conversation."userBId"
        AND message."recipientId" = conversation."userAId")
     )
  ) THEN
    RAISE EXCEPTION 'Message participant routing does not match its Conversation';
  END IF;
END
$grainline_conversation_message_preflight$;

ALTER TABLE public."Conversation"
  ADD CONSTRAINT "Conversation_canonical_participant_pair_check"
  CHECK ("userAId" < "userBId")
  NOT VALID;

ALTER TABLE public."Conversation"
  VALIDATE CONSTRAINT "Conversation_canonical_participant_pair_check";

CREATE OR REPLACE FUNCTION public.grainline_conversation_participants_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $grainline_conversation_participants_immutable$
BEGIN
  IF NEW."userAId" IS DISTINCT FROM OLD."userAId"
     OR NEW."userBId" IS DISTINCT FROM OLD."userBId" THEN
    RAISE EXCEPTION 'Conversation participants are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$grainline_conversation_participants_immutable$;

REVOKE ALL ON FUNCTION public.grainline_conversation_participants_immutable()
  FROM PUBLIC;

CREATE TRIGGER grainline_conversation_participants_immutable
BEFORE UPDATE OF "userAId", "userBId" ON public."Conversation"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_conversation_participants_immutable();

CREATE OR REPLACE FUNCTION public.grainline_message_participants_match_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $grainline_message_participants_match_conversation$
DECLARE
  participant_a text;
  participant_b text;
BEGIN
  SELECT conversation."userAId", conversation."userBId"
    INTO participant_a, participant_b
    FROM public."Conversation" AS conversation
   WHERE conversation.id = NEW."conversationId"
   FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message Conversation does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF NOT (
    (NEW."senderId" = participant_a AND NEW."recipientId" = participant_b)
    OR
    (NEW."senderId" = participant_b AND NEW."recipientId" = participant_a)
  ) THEN
    RAISE EXCEPTION 'Message participants do not match Conversation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$grainline_message_participants_match_conversation$;

REVOKE ALL ON FUNCTION public.grainline_message_participants_match_conversation()
  FROM PUBLIC;

CREATE TRIGGER grainline_message_participants_match_conversation
BEFORE INSERT ON public."Message"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_message_participants_match_conversation();

CREATE OR REPLACE FUNCTION public.grainline_message_route_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $grainline_message_route_immutable$
BEGIN
  IF NEW."conversationId" IS DISTINCT FROM OLD."conversationId"
     OR NEW."senderId" IS DISTINCT FROM OLD."senderId"
     OR NEW."recipientId" IS DISTINCT FROM OLD."recipientId" THEN
    RAISE EXCEPTION 'Message routing is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$grainline_message_route_immutable$;

REVOKE ALL ON FUNCTION public.grainline_message_route_immutable()
  FROM PUBLIC;

CREATE TRIGGER grainline_message_route_immutable
BEFORE UPDATE OF "conversationId", "senderId", "recipientId" ON public."Message"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_message_route_immutable();

-- Repair the two aggregate-only legacy inconsistencies observed by the
-- 2026-07-22 read-only production inspection. The predicates are semantic,
-- not row-id based, so reruns remain idempotent and do not retain identifiers.
UPDATE public."Message"
   SET "isSystemMessage" = true
 WHERE kind IN ('custom_order_link', 'commission_interest_card')
   AND "isSystemMessage" = false;

WITH latest_message AS (
  SELECT "conversationId", pg_catalog.max("createdAt") AS latest_created_at
    FROM public."Message"
   GROUP BY "conversationId"
)
UPDATE public."Conversation" AS conversation
   SET "updatedAt" = latest_message.latest_created_at
  FROM latest_message
 WHERE latest_message."conversationId" = conversation.id
   AND conversation."updatedAt" < latest_message.latest_created_at;

CREATE OR REPLACE FUNCTION public.grainline_message_maintain_thread_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $grainline_message_maintain_thread_state$
BEGIN
  UPDATE public."Conversation"
     SET "updatedAt" = GREATEST("updatedAt", NEW."createdAt"),
         "archivedAAt" = NULL,
         "archivedBAt" = NULL
   WHERE id = NEW."conversationId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message Conversation does not exist'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$grainline_message_maintain_thread_state$;

REVOKE ALL ON FUNCTION public.grainline_message_maintain_thread_state()
  FROM PUBLIC;

CREATE TRIGGER grainline_message_maintain_thread_state
AFTER INSERT ON public."Message"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_message_maintain_thread_state();

COMMIT;
