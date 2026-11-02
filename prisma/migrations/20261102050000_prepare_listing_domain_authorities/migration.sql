-- Prepare the Listing catalog domain for least-privilege activation.
--
-- This preparation is backward compatible: predecessor functions and direct
-- runtime grants remain until the separate activation migration. The first
-- slice adds the version-bound staff-review overload and durable materials
-- storage bounds; later slices add the reviewed owner/public/history/service
-- authorities before this migration is released.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.listing-domain.rls.preparation', 0)
);

DO $grainline_listing_domain_preflight$
DECLARE
  invalid_material_rows bigint;
BEGIN
  IF pg_catalog.to_regclass('public."Listing"') IS NULL THEN
    RAISE EXCEPTION 'Listing table is absent';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_seller_staff_listing_review_transition(text,text,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Listing predecessor staff-review authority is absent';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_seller_staff_listing_review_transition(text,text,text,text,timestamp without time zone)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing version-bound staff-review authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_seller_staff_listing_remove_transition(text,text,timestamp without time zone)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing version-bound staff-removal authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_favorite_admin_listing_cleanup(text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_stock_notification_admin_listing_cleanup(text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_cart_item_admin_listing_cleanup(text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Listing staff-removal cleanup predecessor is absent';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_message_list(text,text,text,timestamp without time zone,text,integer)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Listing message-list predecessor is absent';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_message_context_titles(text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing message-context authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_materials_guard()'
     ) IS NOT NULL
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger_state
        WHERE trigger_state.tgrelid = 'public."Listing"'::pg_catalog.regclass
          AND trigger_state.tgname = 'grainline_listing_materials_guard'
          AND NOT trigger_state.tgisinternal
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.conrelid = 'public."Listing"'::pg_catalog.regclass
          AND constraint_state.conname = 'Listing_materials_count_chk'
     ) THEN
    RAISE EXCEPTION 'Listing materials guard catalog already exists';
  END IF;

  SELECT pg_catalog.count(*)
    INTO invalid_material_rows
    FROM public."Listing" AS listing
   WHERE pg_catalog.cardinality(listing.materials) > 20
      OR EXISTS (
        SELECT 1
          FROM pg_catalog.unnest(listing.materials) AS material(value)
         WHERE material.value IS NULL
            OR pg_catalog.char_length(material.value) > 100
      );
  IF invalid_material_rows <> 0 THEN
    RAISE EXCEPTION 'Listing materials inventory contains % invalid rows',
      invalid_material_rows;
  END IF;
END
$grainline_listing_domain_preflight$;

CREATE FUNCTION public.grainline_seller_staff_listing_review_transition(
  p_actor_id text,
  p_listing_id text,
  p_operation text,
  p_reason text,
  p_reviewed_updated_at timestamp without time zone
)
RETURNS TABLE (
  applied boolean,
  "auditId" text,
  "blockReason" text,
  "listingId" text,
  title text,
  "priceCents" integer,
  currency text,
  status text,
  "listingType" text,
  "stockQuantity" integer,
  "sellerProfileId" text,
  "customOrderConversationId" text,
  "reservedForUserId" text,
  "sellerUserId" text,
  "sellerDisplayName" text,
  "ownerAccountActive" boolean,
  "chargesEnabled" boolean,
  "vacationMode" boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_listing_review_transition_v2$
DECLARE
  source_listing public."Listing"%ROWTYPE;
  source_seller public."SellerProfile"%ROWTYPE;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller listing review transition requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_operation IS NULL
     OR p_operation NOT IN ('APPROVE', 'REJECT')
     OR p_reason IS NULL
     OR pg_catalog.length(p_reason) > 500
     OR p_reviewed_updated_at IS NULL THEN
    RAISE EXCEPTION 'Seller listing review transition input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = p_actor_id
     AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller listing review transition actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT listing.*
    INTO source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT seller.*
    INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller.id = source_listing."sellerId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller listing review transition seller is missing'
      USING ERRCODE = '23503';
  END IF;

  IF source_listing."updatedAt" IS DISTINCT FROM p_reviewed_updated_at THEN
    RETURN QUERY SELECT
      false, NULL::text, 'LISTING_VERSION_CHANGED'::text,
      source_listing.id::text, source_listing.title::text,
      source_listing."priceCents", source_listing.currency::text,
      source_listing.status::text, source_listing."listingType"::text,
      source_listing."stockQuantity", source_seller.id::text,
      source_listing."customOrderConversationId"::text,
      source_listing."reservedForUserId"::text,
      source_seller."userId"::text, source_seller."displayName"::text,
      source_seller."ownerAccountActive", source_seller."chargesEnabled",
      source_seller."vacationMode";
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
    FROM public.grainline_seller_staff_listing_review_transition(
      p_actor_id,
      p_listing_id,
      p_operation,
      p_reason
    );
END
$grainline_seller_staff_listing_review_transition_v2$;

REVOKE ALL ON FUNCTION public.grainline_seller_staff_listing_review_transition(
  text,text,text,text,timestamp without time zone
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_listing_review_transition(
  text,text,text,text,timestamp without time zone
) TO grainline_staff_read_runtime;

CREATE FUNCTION public.grainline_seller_staff_listing_remove_transition(
  p_actor_id text,
  p_listing_id text,
  p_reviewed_updated_at timestamp without time zone
)
RETURNS TABLE (
  applied boolean,
  "auditId" text,
  "blockReason" text,
  "listingId" text,
  title text,
  "sellerProfileId" text,
  "previousStatus" text,
  "previousIsPrivate" boolean,
  "previousRejectionReason" text,
  "removedFavorites" integer,
  "removedStockNotifications" bigint,
  "removedCartItems" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_listing_remove_transition$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_listing public."Listing"%ROWTYPE;
  audit_id text;
  removed_favorites integer := 0;
  removed_stock_notifications bigint := 0;
  removed_cart_items integer := 0;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller listing removal transition requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_reviewed_updated_at IS NULL THEN
    RAISE EXCEPTION 'Seller listing removal transition input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = p_actor_id
     AND actor.role::text = 'ADMIN'
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller listing removal transition actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT listing.*
    INTO source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF source_listing."updatedAt" IS DISTINCT FROM p_reviewed_updated_at THEN
    RETURN QUERY SELECT
      false, NULL::text, 'LISTING_VERSION_CHANGED'::text,
      source_listing.id::text, source_listing.title::text,
      source_listing."sellerId"::text, source_listing.status::text,
      source_listing."isPrivate", source_listing."rejectionReason"::text,
      0::integer, 0::bigint, 0::integer;
    RETURN;
  END IF;

  UPDATE public."Listing"
     SET status = 'REJECTED'::public."ListingStatus",
         "isPrivate" = true,
         "rejectionReason" = 'Removed by Grainline staff.',
         "updatedAt" = source_now
   WHERE id = source_listing.id;

  PERFORM pg_catalog.set_config('app.user_id', p_actor_id, true);
  SELECT public.grainline_favorite_admin_listing_cleanup(p_listing_id)
    INTO removed_favorites;
  SELECT public.grainline_stock_notification_admin_listing_cleanup(p_listing_id)
    INTO removed_stock_notifications;
  SELECT cleanup.deleted_count
    INTO removed_cart_items
    FROM public.grainline_cart_item_admin_listing_cleanup(p_listing_id) AS cleanup;

  audit_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason, metadata,
    undone, "createdAt"
  ) VALUES (
    audit_id,
    p_actor_id,
    'REMOVE_LISTING',
    'Listing',
    source_listing.id,
    NULL,
    pg_catalog.jsonb_build_object(
      'title', source_listing.title,
      'sellerId', source_listing."sellerId",
      'previousStatus', source_listing.status::text,
      'previousIsPrivate', source_listing."isPrivate",
      'previousRejectionReason', source_listing."rejectionReason",
      'removedFavorites', removed_favorites,
      'removedStockNotifications', removed_stock_notifications,
      'removedCartItems', removed_cart_items
    ),
    false,
    source_now
  );

  RETURN QUERY SELECT
    true, audit_id, NULL::text,
    source_listing.id::text, source_listing.title::text,
    source_listing."sellerId"::text, source_listing.status::text,
    source_listing."isPrivate", source_listing."rejectionReason"::text,
    removed_favorites, removed_stock_notifications, removed_cart_items;
END
$grainline_seller_staff_listing_remove_transition$;

REVOKE ALL ON FUNCTION public.grainline_seller_staff_listing_remove_transition(
  text,text,timestamp without time zone
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_listing_remove_transition(
  text,text,timestamp without time zone
) TO grainline_staff_read_runtime;

CREATE FUNCTION public.grainline_listing_message_context_titles(
  p_conversation_id text
)
RETURNS TABLE (
  "listingId" text,
  title text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_message_context_titles$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_conversation_id IS NULL
     OR p_conversation_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Listing message-context input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT DISTINCT listing.id::text, listing.title::text
    FROM public."Conversation" AS conversation
    JOIN public."Message" AS message
      ON message."conversationId" = conversation.id
    JOIN public."Listing" AS listing
      ON message."contextListingId" = listing.id
   WHERE conversation.id = p_conversation_id
     AND (
       conversation."userAId" = actor_id
       OR conversation."userBId" = actor_id
       OR public.grainline_conversation_staff_report_visible(conversation.id)
     );
END
$grainline_listing_message_context_titles$;

REVOKE ALL ON FUNCTION public.grainline_listing_message_context_titles(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_message_context_titles(text)
  TO grainline_app_runtime;

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
      context_listing.title::text,
      message."createdAt",
      message."readAt"
      FROM public."Message" AS message
      LEFT JOIN public.grainline_listing_message_context_titles(
        p_conversation_id
      ) AS context_listing
        ON context_listing."listingId" = message."contextListingId"
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
      context_listing.title::text,
      message."createdAt",
      message."readAt"
      FROM public."Message" AS message
      LEFT JOIN public.grainline_listing_message_context_titles(
        p_conversation_id
      ) AS context_listing
        ON context_listing."listingId" = message."contextListingId"
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
END
$grainline_message_list$;

ALTER TABLE public."Listing"
  ADD CONSTRAINT "Listing_materials_count_chk"
  CHECK (pg_catalog.cardinality(materials) <= 20) NOT VALID;
ALTER TABLE public."Listing"
  VALIDATE CONSTRAINT "Listing_materials_count_chk";

CREATE FUNCTION public.grainline_listing_materials_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_materials_guard$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(NEW.materials) AS material(value)
     WHERE material.value IS NULL
        OR pg_catalog.char_length(material.value) > 100
  ) THEN
    RAISE EXCEPTION 'Listing materials are invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$grainline_listing_materials_guard$;

REVOKE ALL ON FUNCTION public.grainline_listing_materials_guard()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

CREATE TRIGGER grainline_listing_materials_guard
BEFORE INSERT OR UPDATE OF materials ON public."Listing"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_listing_materials_guard();

COMMIT;
