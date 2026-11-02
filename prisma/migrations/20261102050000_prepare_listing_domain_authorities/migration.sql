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
       'public.grainline_seller_staff_listing_undo_transition(text,text,text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing protected staff-undo authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_seller_staff_listing_review_queue(text,integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing protected staff-review queue already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_editor(text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner-editor authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_export_page(timestamp without time zone,text,integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner-export authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_summary_page(text,text,boolean,timestamp without time zone,text,integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner-summary authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_counts()'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner-count authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_action_state(text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner action-state authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_assign_metros(text,timestamp without time zone,text,text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner metro-assignment authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_content_update(text,timestamp without time zone,text,text,text,text,integer,boolean,text[],text,text[],double precision,double precision,double precision,double precision,double precision,double precision,integer,text,text,integer,integer,integer,integer,jsonb,jsonb)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner content-update authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_alt_text_backfill(text,text[],text[])'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner alt-text backfill authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_ai_review_context(text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner AI-review context authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_actor_transaction_source(text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing actor transaction-source authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_actor_transaction_source_core(text,boolean)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing actor transaction-source core already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_actor_cart_transaction_sources(text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing actor cart transaction-source authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_legacy_stock_restore_apply(text,jsonb)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy checkout stock-restore apply authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_account_deletion_redact(text,text,bigint,uuid,timestamp without time zone)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing account-deletion authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_children_replace_core(text,integer,jsonb,jsonb)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing child-manifest core already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_create(text,text,boolean,text,text,text,text,integer,text[],text,text[],double precision,double precision,double precision,double precision,double precision,double precision,integer,text,text,integer,integer,integer,integer,jsonb,jsonb)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner-create authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_delete_lock(text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner delete-lock authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_archive(text,timestamp without time zone)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner archive authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_hard_delete(text,timestamp without time zone)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner hard-delete authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_transition(text,text,timestamp without time zone)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner transition authority already exists';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_listing_owner_review_transition(text,timestamp without time zone,text,text,text[],double precision)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Listing owner review-transition authority already exists';
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

CREATE FUNCTION public.grainline_seller_staff_listing_undo_transition(
  p_actor_id text,
  p_log_id text,
  p_reason text
)
RETURNS TABLE (
  action text,
  "listingId" text,
  "restoredStatus" text,
  "auditId" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_listing_undo_transition$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_audit public."AdminAuditLog"%ROWTYPE;
  source_listing public."Listing"%ROWTYPE;
  source_metadata jsonb;
  has_valid_previous_status boolean := false;
  restored_status public."ListingStatus";
  restored_is_private boolean;
  restored_rejection_reason text;
  undo_id text := pg_catalog.gen_random_uuid()::text;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller listing undo requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_log_id IS NULL
     OR p_log_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_reason IS NULL
     OR pg_catalog.char_length(p_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Seller listing undo input is invalid'
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
    RAISE EXCEPTION 'Seller listing undo actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT source_audit_row.*
    INTO source_audit
    FROM public."AdminAuditLog" AS source_audit_row
   WHERE source_audit_row.id = p_log_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Action not found'
      USING ERRCODE = 'P0002';
  END IF;
  IF source_audit.action NOT IN ('REMOVE_LISTING', 'HOLD_LISTING')
     OR source_audit."targetType" <> 'Listing' THEN
    RAISE EXCEPTION 'Action ''%'' cannot use listing undo', source_audit.action
      USING ERRCODE = '42501';
  END IF;
  IF source_audit."adminId" = p_actor_id THEN
    RAISE EXCEPTION 'Admins cannot undo their own actions'
      USING ERRCODE = '42501';
  END IF;
  IF source_audit.undone THEN
    RAISE EXCEPTION 'Already undone (concurrent request)'
      USING ERRCODE = '55000';
  END IF;
  IF source_audit."createdAt" < (
       pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
     ) - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'Undo window expired (24 hours)'
      USING ERRCODE = '42501';
  END IF;

  SELECT listing.*
    INTO source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = source_audit."targetId"
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing changed before undo could be applied'
      USING ERRCODE = '55000';
  END IF;
  IF (
       source_audit.action = 'REMOVE_LISTING'
       AND (
         source_listing.status::text <> 'REJECTED'
         OR source_listing."isPrivate" = false
       )
     ) OR (
       source_audit.action = 'HOLD_LISTING'
       AND source_listing.status::text <> 'HIDDEN'
     ) THEN
    RAISE EXCEPTION 'Listing changed before undo could be applied'
      USING ERRCODE = '55000';
  END IF;

  source_metadata := CASE
    WHEN pg_catalog.jsonb_typeof(source_audit.metadata) = 'object'
      THEN source_audit.metadata
    ELSE '{}'::jsonb
  END;
  has_valid_previous_status :=
    pg_catalog.jsonb_typeof(source_metadata->'previousStatus') = 'string'
    AND EXISTS (
      SELECT 1
        FROM pg_catalog.unnest(
          pg_catalog.enum_range(NULL::public."ListingStatus")
        ) AS status_value(value)
       WHERE status_value.value::text = source_metadata->>'previousStatus'
    );
  restored_status := CASE
    WHEN has_valid_previous_status
      THEN (source_metadata->>'previousStatus')::public."ListingStatus"
    ELSE 'HIDDEN'::public."ListingStatus"
  END;
  restored_is_private := CASE
    WHEN pg_catalog.jsonb_typeof(source_metadata->'previousIsPrivate') = 'boolean'
      THEN (source_metadata->>'previousIsPrivate')::boolean
    WHEN NOT has_valid_previous_status THEN true
    ELSE source_listing."isPrivate"
  END;
  restored_rejection_reason := CASE
    WHEN pg_catalog.jsonb_typeof(source_metadata->'previousRejectionReason') = 'string'
      THEN source_metadata->>'previousRejectionReason'
    WHEN source_metadata ? 'previousRejectionReason' THEN NULL
    ELSE source_listing."rejectionReason"
  END;

  UPDATE public."Listing"
     SET status = restored_status,
         "isPrivate" = restored_is_private,
         "rejectionReason" = restored_rejection_reason,
         "updatedAt" = source_now
   WHERE id = source_listing.id;

  UPDATE public."AdminAuditLog"
     SET undone = true,
         "undoneAt" = source_now,
         "undoneBy" = p_actor_id,
         "undoneReason" = p_reason
   WHERE id = source_audit.id;

  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason, metadata,
    undone, "createdAt"
  ) VALUES (
    undo_id,
    p_actor_id,
    'UNDO_' || source_audit.action,
    source_audit."targetType",
    source_audit."targetId",
    p_reason,
    pg_catalog.jsonb_build_object(
      'originalActionId', source_audit.id,
      'actorKind', 'staff'
    ),
    false,
    source_now
  );

  RETURN QUERY SELECT
    source_audit.action::text,
    source_listing.id::text,
    restored_status::text,
    undo_id;
END
$grainline_seller_staff_listing_undo_transition$;

REVOKE ALL ON FUNCTION public.grainline_seller_staff_listing_undo_transition(
  text,text,text
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_listing_undo_transition(
  text,text,text
) TO grainline_staff_read_runtime;

CREATE FUNCTION public.grainline_seller_staff_listing_review_queue(
  p_actor_id text,
  p_limit integer
)
RETURNS TABLE (
  "totalPending" bigint,
  "listingId" text,
  "sellerProfileId" text,
  title text,
  "priceCents" integer,
  currency text,
  "createdAt" timestamp(3) without time zone,
  "updatedAt" timestamp(3) without time zone,
  "aiReviewFlags" text[],
  "aiReviewScore" double precision,
  "photoUrl" text,
  "sellerListingCount" bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_listing_review_queue$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller listing review queue requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 100 THEN
    RAISE EXCEPTION 'Seller listing review queue input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = p_actor_id
     AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller listing review queue actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH pending AS MATERIALIZED (
    SELECT source_listing.*
      FROM public."Listing" AS source_listing
     WHERE source_listing.status::text = 'PENDING_REVIEW'
  )
  SELECT
    (SELECT pg_catalog.count(*) FROM pending)::bigint,
    listing.id::text,
    listing."sellerId"::text,
    listing.title::text,
    listing."priceCents",
    listing.currency::text,
    listing."createdAt",
    listing."updatedAt",
    listing."aiReviewFlags"::text[],
    listing."aiReviewScore",
    first_photo.url::text,
    (
      SELECT pg_catalog.count(*)
        FROM public."Listing" AS seller_listing
       WHERE seller_listing."sellerId" = listing."sellerId"
    )::bigint
    FROM pending AS listing
    LEFT JOIN LATERAL (
      SELECT photo.url
        FROM public."Photo" AS photo
       WHERE photo."listingId" = listing.id
       ORDER BY photo."sortOrder" ASC, photo.id ASC
       LIMIT 1
    ) AS first_photo ON true
   ORDER BY listing."createdAt" ASC, listing.id ASC
   LIMIT p_limit;
END
$grainline_seller_staff_listing_review_queue$;

REVOKE ALL ON FUNCTION public.grainline_seller_staff_listing_review_queue(
  text,integer
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_listing_review_queue(
  text,integer
) TO grainline_staff_read_runtime;

CREATE FUNCTION public.grainline_listing_owner_editor(
  p_listing_id text
)
RETURNS TABLE (
  "listingId" text,
  "sellerProfileId" text,
  title text,
  description text,
  "priceCents" integer,
  "priceVersion" integer,
  currency text,
  status text,
  "createdAt" timestamp(3) without time zone,
  "updatedAt" timestamp(3) without time zone,
  "archivedAt" timestamp(3) without time zone,
  "processingTimeMinDays" integer,
  "processingTimeMaxDays" integer,
  "listingType" text,
  "stockQuantity" integer,
  category text,
  tags text[],
  "shipsWithinDays" integer,
  "packagedWeightGrams" integer,
  "packagedLengthCm" double precision,
  "packagedWidthCm" double precision,
  "packagedHeightCm" double precision,
  "isPrivate" boolean,
  "reservedForUserId" text,
  "customOrderConversationId" text,
  "rejectionReason" text,
  "metaDescription" text,
  materials text[],
  "productLengthIn" double precision,
  "productWidthIn" double precision,
  "productHeightIn" double precision,
  photos jsonb,
  "variantGroups" jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_editor$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Listing owner-editor input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive";
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    listing.id::text,
    listing."sellerId"::text,
    listing.title::text,
    listing.description::text,
    listing."priceCents",
    listing."priceVersion",
    listing.currency::text,
    listing.status::text,
    listing."createdAt",
    listing."updatedAt",
    listing."archivedAt",
    listing."processingTimeMinDays",
    listing."processingTimeMaxDays",
    listing."listingType"::text,
    listing."stockQuantity",
    listing.category::text,
    listing.tags::text[],
    listing."shipsWithinDays",
    listing."packagedWeightGrams",
    listing."packagedLengthCm",
    listing."packagedWidthCm",
    listing."packagedHeightCm",
    listing."isPrivate",
    listing."reservedForUserId"::text,
    listing."customOrderConversationId"::text,
    listing."rejectionReason"::text,
    listing."metaDescription"::text,
    listing.materials::text[],
    listing."productLengthIn",
    listing."productWidthIn",
    listing."productHeightIn",
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', photo.id,
          'url', photo.url,
          'originalUrl', photo."originalUrl",
          'altText', photo."altText",
          'sortOrder', photo."sortOrder"
        )
        ORDER BY photo."sortOrder" ASC, photo.id ASC
      )
        FROM public."Photo" AS photo
       WHERE photo."listingId" = listing.id
    ), '[]'::jsonb),
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', variant_group.id,
          'name', variant_group.name,
          'sortOrder', variant_group."sortOrder",
          'options', COALESCE((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'id', variant_option.id,
                'label', variant_option.label,
                'priceAdjustCents', variant_option."priceAdjustCents",
                'sortOrder', variant_option."sortOrder",
                'inStock', variant_option."inStock"
              )
              ORDER BY variant_option."sortOrder" ASC, variant_option.id ASC
            )
              FROM public."ListingVariantOption" AS variant_option
             WHERE variant_option."groupId" = variant_group.id
          ), '[]'::jsonb)
        )
        ORDER BY variant_group."sortOrder" ASC, variant_group.id ASC
      )
        FROM public."ListingVariantGroup" AS variant_group
       WHERE variant_group."listingId" = listing.id
    ), '[]'::jsonb)
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = seller_id
     AND listing."archivedAt" IS NULL;
END
$grainline_listing_owner_editor$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_editor(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_editor(text)
  TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_export_page(
  p_before_created_at timestamp without time zone,
  p_before_listing_id text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  title text,
  description text,
  "priceCents" integer,
  "priceVersion" integer,
  currency text,
  status text,
  "videoUrl" text,
  "isPrivate" boolean,
  "listingType" text,
  "stockQuantity" integer,
  "processingTimeMinDays" integer,
  "processingTimeMaxDays" integer,
  "shipsWithinDays" integer,
  category text,
  tags text[],
  "packagedWeightGrams" integer,
  "packagedLengthCm" double precision,
  "packagedWidthCm" double precision,
  "packagedHeightCm" double precision,
  "reservedForUserId" text,
  "customOrderConversationId" text,
  "metaDescription" text,
  materials text[],
  "productLengthIn" double precision,
  "productWidthIn" double precision,
  "productHeightIn" double precision,
  "createdAt" timestamp(3) without time zone,
  "updatedAt" timestamp(3) without time zone,
  photos jsonb,
  "variantGroups" jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_export_page$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_before_created_at IS NULL) <> (p_before_listing_id IS NULL)
     OR (
       p_before_listing_id IS NOT NULL
       AND p_before_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 100 THEN
    RAISE EXCEPTION 'Listing owner-export input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    listing.id::text,
    listing.title::text,
    listing.description::text,
    listing."priceCents",
    listing."priceVersion",
    listing.currency::text,
    listing.status::text,
    listing."videoUrl"::text,
    listing."isPrivate",
    listing."listingType"::text,
    listing."stockQuantity",
    listing."processingTimeMinDays",
    listing."processingTimeMaxDays",
    listing."shipsWithinDays",
    listing.category::text,
    listing.tags::text[],
    listing."packagedWeightGrams",
    listing."packagedLengthCm",
    listing."packagedWidthCm",
    listing."packagedHeightCm",
    listing."reservedForUserId"::text,
    listing."customOrderConversationId"::text,
    listing."metaDescription"::text,
    listing.materials::text[],
    listing."productLengthIn",
    listing."productWidthIn",
    listing."productHeightIn",
    listing."createdAt",
    listing."updatedAt",
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'url', photo.url,
          'originalUrl', photo."originalUrl",
          'altText', photo."altText",
          'sortOrder', photo."sortOrder"
        )
        ORDER BY photo."sortOrder" ASC, photo.id ASC
      )
        FROM public."Photo" AS photo
       WHERE photo."listingId" = listing.id
    ), '[]'::jsonb),
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', variant_group.name,
          'sortOrder', variant_group."sortOrder",
          'options', COALESCE((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'label', variant_option.label,
                'priceAdjustCents', variant_option."priceAdjustCents",
                'sortOrder', variant_option."sortOrder",
                'inStock', variant_option."inStock"
              )
              ORDER BY variant_option."sortOrder" ASC, variant_option.id ASC
            )
              FROM public."ListingVariantOption" AS variant_option
             WHERE variant_option."groupId" = variant_group.id
          ), '[]'::jsonb)
        )
        ORDER BY variant_group."sortOrder" ASC, variant_group.id ASC
      )
        FROM public."ListingVariantGroup" AS variant_group
       WHERE variant_group."listingId" = listing.id
    ), '[]'::jsonb)
    FROM public."Listing" AS listing
   WHERE listing."sellerId" = seller_id
     AND (
       p_before_created_at IS NULL
       OR listing."createdAt" < p_before_created_at
       OR (
         listing."createdAt" = p_before_created_at
         AND listing.id < p_before_listing_id
       )
     )
   ORDER BY listing."createdAt" DESC, listing.id DESC
   LIMIT p_limit;
END
$grainline_listing_owner_export_page$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_export_page(
  timestamp without time zone,text,integer
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_export_page(
  timestamp without time zone,text,integer
) TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_summary_page(
  p_status text,
  p_listing_type text,
  p_include_archived boolean,
  p_before_updated_at timestamp without time zone,
  p_before_listing_id text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  title text,
  "priceCents" integer,
  currency text,
  status text,
  "isPrivate" boolean,
  "listingType" text,
  "stockQuantity" integer,
  "viewCount" integer,
  "clickCount" integer,
  "favoriteCount" integer,
  "aiReviewFlags" text[],
  "reviewedByAdmin" boolean,
  "createdAt" timestamp(3) without time zone,
  "updatedAt" timestamp(3) without time zone,
  "archivedAt" timestamp(3) without time zone,
  photos jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_summary_page$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (
       p_status IS NOT NULL
       AND p_status NOT IN (
         'DRAFT', 'ACTIVE', 'SOLD', 'SOLD_OUT', 'HIDDEN',
         'PENDING_REVIEW', 'REJECTED'
       )
     )
     OR (
       p_listing_type IS NOT NULL
       AND p_listing_type NOT IN ('MADE_TO_ORDER', 'IN_STOCK')
     )
     OR p_include_archived IS NULL
     OR (p_before_updated_at IS NULL) <> (p_before_listing_id IS NULL)
     OR (
       p_before_listing_id IS NOT NULL
       AND p_before_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 100 THEN
    RAISE EXCEPTION 'Listing owner-summary input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    listing.id::text,
    listing.title::text,
    listing."priceCents",
    listing.currency::text,
    listing.status::text,
    listing."isPrivate",
    listing."listingType"::text,
    listing."stockQuantity",
    listing."viewCount",
    listing."clickCount",
    listing."favoriteCount",
    listing."aiReviewFlags"::text[],
    listing."reviewedByAdmin",
    listing."createdAt",
    listing."updatedAt",
    listing."archivedAt",
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('url', photo.url)
        ORDER BY photo."sortOrder" ASC, photo.id ASC
      )
        FROM (
          SELECT source_photo.id,
                 source_photo.url,
                 source_photo."sortOrder"
            FROM public."Photo" AS source_photo
           WHERE source_photo."listingId" = listing.id
           ORDER BY source_photo."sortOrder" ASC, source_photo.id ASC
           LIMIT 1
        ) AS photo
    ), '[]'::jsonb)
    FROM public."Listing" AS listing
   WHERE listing."sellerId" = seller_id
     AND (p_status IS NULL OR listing.status::text = p_status)
     AND (
       p_listing_type IS NULL
       OR listing."listingType"::text = p_listing_type
     )
     AND (p_include_archived OR listing."archivedAt" IS NULL)
     AND (
       p_before_updated_at IS NULL
       OR listing."updatedAt" < p_before_updated_at
       OR (
         listing."updatedAt" = p_before_updated_at
         AND listing.id < p_before_listing_id
       )
     )
   ORDER BY listing."updatedAt" DESC, listing.id DESC
   LIMIT p_limit;
END
$grainline_listing_owner_summary_page$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_summary_page(
  text,text,boolean,timestamp without time zone,text,integer
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_summary_page(
  text,text,boolean,timestamp without time zone,text,integer
) TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_counts()
RETURNS TABLE (
  "draftCount" bigint,
  "activeCount" bigint,
  "activePublicCount" bigint,
  "oldestListingId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_counts$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Listing owner-count actor is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE listing.status = 'DRAFT'
    ) AS "draftCount",
    pg_catalog.count(*) FILTER (
      WHERE listing.status = 'ACTIVE'
    ) AS "activeCount",
    pg_catalog.count(*) FILTER (
      WHERE listing.status = 'ACTIVE'
        AND listing."isPrivate" = false
    ) AS "activePublicCount",
    (
      SELECT oldest_listing.id::text
        FROM public."Listing" AS oldest_listing
       WHERE oldest_listing."sellerId" = seller_id
       ORDER BY oldest_listing."createdAt" ASC, oldest_listing.id ASC
       LIMIT 1
    ) AS "oldestListingId"
    FROM public."Listing" AS listing
   WHERE listing."sellerId" = seller_id;
END
$grainline_listing_owner_counts$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_counts()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_counts()
  TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_action_state(
  p_listing_id text
)
RETURNS TABLE (
  "listingId" text,
  "sellerProfileId" text,
  title text,
  description text,
  "priceCents" integer,
  currency text,
  status text,
  "updatedAt" timestamp(3) without time zone,
  "archivedAt" timestamp(3) without time zone,
  "listingType" text,
  "stockQuantity" integer,
  category text,
  tags text[],
  "isPrivate" boolean,
  "reservedForUserId" text,
  "customOrderConversationId" text,
  "rejectionReason" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_action_state$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Listing owner action-state input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    listing.id::text,
    listing."sellerId"::text,
    listing.title::text,
    listing.description::text,
    listing."priceCents",
    listing.currency::text,
    listing.status::text,
    listing."updatedAt",
    listing."archivedAt",
    listing."listingType"::text,
    listing."stockQuantity",
    listing.category::text,
    listing.tags::text[],
    listing."isPrivate",
    listing."reservedForUserId"::text,
    listing."customOrderConversationId"::text,
    listing."rejectionReason"::text
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = seller_id;
END
$grainline_listing_owner_action_state$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_action_state(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_action_state(text)
  TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_assign_metros(
  p_listing_id text,
  p_expected_updated_at timestamp without time zone,
  p_metro_id text,
  p_city_metro_id text
)
RETURNS TABLE (applied boolean, "updatedAt" timestamp without time zone)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_assign_metros$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
  source_listing public."Listing"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_expected_updated_at IS NULL
     OR p_metro_id IS NULL
     OR p_metro_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (
       p_city_metro_id IS NOT NULL
       AND p_city_metro_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'Listing owner metro-assignment input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::timestamp without time zone;
    RETURN;
  END IF;

  SELECT listing.*
    INTO source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = seller_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::timestamp without time zone;
    RETURN;
  END IF;

  IF source_listing."updatedAt" IS DISTINCT FROM p_expected_updated_at
     OR source_listing."archivedAt" IS NOT NULL
     OR source_listing.status::text NOT IN ('DRAFT', 'PENDING_REVIEW')
     OR source_listing."metroId" IS NOT NULL
     OR source_listing."cityMetroId" IS NOT NULL THEN
    RETURN QUERY SELECT false, NULL::timestamp without time zone;
    RETURN;
  END IF;

  UPDATE public."Listing" AS listing
     SET "metroId" = p_metro_id,
         "cityMetroId" = p_city_metro_id,
         "updatedAt" = source_now
   WHERE listing.id = source_listing.id
     AND EXISTS (
       SELECT 1
         FROM public."Metro" AS major_metro
        WHERE major_metro.id = p_metro_id
          AND major_metro."isActive" = true
          AND major_metro."parentMetroId" IS NULL
     )
     AND (
       p_city_metro_id IS NULL
       OR EXISTS (
         SELECT 1
           FROM public."Metro" AS city_metro
          WHERE city_metro.id = p_city_metro_id
            AND city_metro."isActive" = true
            AND city_metro."parentMetroId" = p_metro_id
       )
     );
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::timestamp without time zone;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, source_now;
END
$grainline_listing_owner_assign_metros$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_assign_metros(
  text,timestamp without time zone,text,text
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_assign_metros(
  text,timestamp without time zone,text,text
) TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_children_replace_core(
  p_listing_id text,
  p_base_price_cents integer,
  p_photos jsonb,
  p_variant_groups jsonb
)
RETURNS TABLE ("photoCount" integer, "variantGroupCount" integer)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_children_replace_core$
DECLARE
  photo_value jsonb;
  group_value jsonb;
  option_value jsonb;
  minimum_adjustment bigint;
  maximum_adjustment bigint;
  inserted_photos integer := 0;
  inserted_groups integer := 0;
BEGIN
  IF p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_base_price_cents IS NULL
     OR p_base_price_cents < 1
     OR p_base_price_cents > 10000000
     OR p_photos IS NULL
     OR pg_catalog.jsonb_typeof(p_photos) <> 'array'
     OR pg_catalog.jsonb_array_length(p_photos) > 10
     OR p_variant_groups IS NULL
     OR pg_catalog.jsonb_typeof(p_variant_groups) <> 'array'
     OR pg_catalog.jsonb_array_length(p_variant_groups) > 3 THEN
    RAISE EXCEPTION 'Listing child manifest is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_photos)
           WITH ORDINALITY AS photo(value, ordinal)
     WHERE pg_catalog.jsonb_typeof(photo.value) <> 'object'
        OR COALESCE(photo.value->>'id', '') !~ '^[A-Za-z0-9._:-]{1,191}$'
        OR pg_catalog.jsonb_typeof(photo.value->'url') <> 'string'
        OR pg_catalog.char_length(photo.value->>'url') NOT BETWEEN 1 AND 2048
        OR pg_catalog.jsonb_typeof(photo.value->'originalUrl') <> 'string'
        OR pg_catalog.char_length(photo.value->>'originalUrl') NOT BETWEEN 1 AND 2048
        OR NOT (photo.value ? 'altText')
        OR pg_catalog.jsonb_typeof(photo.value->'altText') NOT IN ('string', 'null')
        OR (
          pg_catalog.jsonb_typeof(photo.value->'altText') = 'string'
          AND pg_catalog.char_length(photo.value->>'altText') > 200
        )
        OR pg_catalog.jsonb_typeof(photo.value->'sortOrder') <> 'number'
        OR COALESCE(photo.value->>'sortOrder', '') !~ '^[0-9]+$'
        OR (photo.value->>'sortOrder')::integer <> photo.ordinal - 1
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_photos) AS photo(value)
     GROUP BY photo.value->>'id'
    HAVING pg_catalog.count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'Listing photo manifest is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variant_groups)
           WITH ORDINALITY AS variant_group(value, ordinal)
     WHERE pg_catalog.jsonb_typeof(variant_group.value) <> 'object'
        OR COALESCE(variant_group.value->>'id', '') !~ '^[A-Za-z0-9._:-]{1,191}$'
        OR pg_catalog.jsonb_typeof(variant_group.value->'name') <> 'string'
        OR pg_catalog.char_length(variant_group.value->>'name') NOT BETWEEN 1 AND 50
        OR pg_catalog.jsonb_typeof(variant_group.value->'sortOrder') <> 'number'
        OR COALESCE(variant_group.value->>'sortOrder', '') !~ '^[0-9]+$'
        OR (variant_group.value->>'sortOrder')::integer <> variant_group.ordinal - 1
        OR pg_catalog.jsonb_typeof(variant_group.value->'options') <> 'array'
        OR pg_catalog.jsonb_array_length(variant_group.value->'options') NOT BETWEEN 1 AND 10
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variant_groups) AS variant_group(value)
     GROUP BY variant_group.value->>'id'
    HAVING pg_catalog.count(*) <> 1
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variant_groups) AS variant_group(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(variant_group.value->'options')
           WITH ORDINALITY AS variant_option(value, ordinal)
     WHERE pg_catalog.jsonb_typeof(variant_option.value) <> 'object'
        OR COALESCE(variant_option.value->>'id', '') !~ '^[A-Za-z0-9._:-]{1,191}$'
        OR pg_catalog.jsonb_typeof(variant_option.value->'label') <> 'string'
        OR pg_catalog.char_length(variant_option.value->>'label') NOT BETWEEN 1 AND 50
        OR pg_catalog.jsonb_typeof(variant_option.value->'priceAdjustCents') <> 'number'
        OR COALESCE(variant_option.value->>'priceAdjustCents', '') !~ '^-?[0-9]+$'
        OR (variant_option.value->>'priceAdjustCents')::bigint NOT BETWEEN -10000000 AND 10000000
        OR pg_catalog.jsonb_typeof(variant_option.value->'sortOrder') <> 'number'
        OR COALESCE(variant_option.value->>'sortOrder', '') !~ '^[0-9]+$'
        OR (variant_option.value->>'sortOrder')::integer <> variant_option.ordinal - 1
        OR pg_catalog.jsonb_typeof(variant_option.value->'inStock') <> 'boolean'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variant_groups) AS variant_group(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(variant_group.value->'options')
           AS variant_option(value)
     GROUP BY variant_option.value->>'id'
    HAVING pg_catalog.count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'Listing variant manifest is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(pg_catalog.sum(group_adjustment.minimum_value), 0),
    COALESCE(pg_catalog.sum(group_adjustment.maximum_value), 0)
    INTO minimum_adjustment, maximum_adjustment
    FROM (
      SELECT
        pg_catalog.min((variant_option.value->>'priceAdjustCents')::bigint) AS minimum_value,
        pg_catalog.max((variant_option.value->>'priceAdjustCents')::bigint) AS maximum_value
        FROM pg_catalog.jsonb_array_elements(p_variant_groups)
             WITH ORDINALITY AS variant_group(value, ordinal)
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(variant_group.value->'options')
             AS variant_option(value)
       GROUP BY variant_group.ordinal
    ) AS group_adjustment;
  IF p_base_price_cents::bigint + minimum_adjustment < 1
     OR p_base_price_cents::bigint + maximum_adjustment > 10000000 THEN
    RAISE EXCEPTION 'Listing variant prices are invalid'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public."Photo" AS photo
   WHERE photo."listingId" = p_listing_id
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(p_photos) AS retained(value)
        WHERE retained.value->>'id' = photo.id
     );

  FOR photo_value IN
    SELECT photo.value
      FROM pg_catalog.jsonb_array_elements(p_photos)
           WITH ORDINALITY AS photo(value, ordinal)
     ORDER BY photo.ordinal
  LOOP
    UPDATE public."Photo" AS photo
       SET url = photo_value->>'url',
           "originalUrl" = photo_value->>'originalUrl',
           "altText" = CASE
             WHEN pg_catalog.jsonb_typeof(photo_value->'altText') = 'null' THEN NULL
             ELSE photo_value->>'altText'
           END,
           "sortOrder" = (photo_value->>'sortOrder')::integer
     WHERE photo.id = photo_value->>'id'
       AND photo."listingId" = p_listing_id;
    IF NOT FOUND THEN
      IF EXISTS (
        SELECT 1 FROM public."Photo" AS other_photo
         WHERE other_photo.id = photo_value->>'id'
      ) THEN
        RAISE EXCEPTION 'Listing photo id belongs to another listing'
          USING ERRCODE = '42501';
      END IF;
      INSERT INTO public."Photo" (
        id, "listingId", url, "originalUrl", "altText", "sortOrder", "createdAt"
      ) VALUES (
        photo_value->>'id',
        p_listing_id,
        photo_value->>'url',
        photo_value->>'originalUrl',
        CASE
          WHEN pg_catalog.jsonb_typeof(photo_value->'altText') = 'null' THEN NULL
          ELSE photo_value->>'altText'
        END,
        (photo_value->>'sortOrder')::integer,
        (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
      );
    END IF;
    inserted_photos := inserted_photos + 1;
  END LOOP;

  DELETE FROM public."ListingVariantGroup" AS variant_group
   WHERE variant_group."listingId" = p_listing_id;

  FOR group_value IN
    SELECT variant_group.value
      FROM pg_catalog.jsonb_array_elements(p_variant_groups)
           WITH ORDINALITY AS variant_group(value, ordinal)
     ORDER BY variant_group.ordinal
  LOOP
    IF EXISTS (
      SELECT 1 FROM public."ListingVariantGroup" AS other_group
       WHERE other_group.id = group_value->>'id'
    ) THEN
      RAISE EXCEPTION 'Listing variant group id is already in use'
        USING ERRCODE = '42501';
    END IF;
    INSERT INTO public."ListingVariantGroup" (id, "listingId", name, "sortOrder")
    VALUES (
      group_value->>'id', p_listing_id, group_value->>'name',
      (group_value->>'sortOrder')::integer
    );
    inserted_groups := inserted_groups + 1;

    FOR option_value IN
      SELECT variant_option.value
        FROM pg_catalog.jsonb_array_elements(group_value->'options')
             WITH ORDINALITY AS variant_option(value, ordinal)
       ORDER BY variant_option.ordinal
    LOOP
      IF EXISTS (
        SELECT 1 FROM public."ListingVariantOption" AS other_option
         WHERE other_option.id = option_value->>'id'
      ) THEN
        RAISE EXCEPTION 'Listing variant option id is already in use'
          USING ERRCODE = '42501';
      END IF;
      INSERT INTO public."ListingVariantOption" (
        id, "groupId", label, "priceAdjustCents", "sortOrder", "inStock"
      ) VALUES (
        option_value->>'id',
        group_value->>'id',
        option_value->>'label',
        (option_value->>'priceAdjustCents')::integer,
        (option_value->>'sortOrder')::integer,
        (option_value->>'inStock')::boolean
      );
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT inserted_photos, inserted_groups;
END
$grainline_listing_children_replace_core$;

REVOKE ALL ON FUNCTION public.grainline_listing_children_replace_core(
  text,integer,jsonb,jsonb
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

CREATE FUNCTION public.grainline_listing_owner_create(
  p_listing_id text,
  p_status text,
  p_is_private boolean,
  p_reserved_for_user_id text,
  p_custom_order_conversation_id text,
  p_title text,
  p_description text,
  p_price_cents integer,
  p_tags text[],
  p_meta_description text,
  p_materials text[],
  p_product_length_in double precision,
  p_product_width_in double precision,
  p_product_height_in double precision,
  p_packaged_length_cm double precision,
  p_packaged_width_cm double precision,
  p_packaged_height_cm double precision,
  p_packaged_weight_grams integer,
  p_category text,
  p_listing_type text,
  p_stock_quantity integer,
  p_ships_within_days integer,
  p_processing_time_min_days integer,
  p_processing_time_max_days integer,
  p_photos jsonb,
  p_variant_groups jsonb
)
RETURNS TABLE (
  created boolean,
  id text,
  title text,
  description text,
  "priceCents" integer,
  currency text,
  status text,
  "updatedAt" timestamp without time zone,
  category text,
  tags text[]
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_create$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_state public."SellerProfile"%ROWTYPE;
  pair record;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_status IS NULL
     OR p_status NOT IN ('DRAFT', 'PENDING_REVIEW')
     OR p_is_private IS NULL
     OR p_title IS NULL
     OR pg_catalog.char_length(p_title) NOT BETWEEN 1 AND 150
     OR p_description IS NULL
     OR pg_catalog.char_length(p_description) > 5000
     OR p_price_cents IS NULL
     OR p_price_cents NOT BETWEEN 1 AND 10000000
     OR p_tags IS NULL
     OR pg_catalog.cardinality(p_tags) > 10
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_tags) AS tag(value)
        WHERE tag.value IS NULL OR pg_catalog.char_length(tag.value) > 100
     )
     OR (p_meta_description IS NOT NULL AND pg_catalog.char_length(p_meta_description) > 160)
     OR p_materials IS NULL
     OR pg_catalog.cardinality(p_materials) > 20
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_materials) AS material(value)
        WHERE material.value IS NULL
           OR pg_catalog.char_length(material.value) NOT BETWEEN 1 AND 100
     )
     OR p_product_length_in = 'NaN'::double precision
     OR p_product_length_in IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR p_product_width_in = 'NaN'::double precision
     OR p_product_width_in IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR p_product_height_in = 'NaN'::double precision
     OR p_product_height_in IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR p_packaged_length_cm = 'NaN'::double precision
     OR p_packaged_length_cm IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR p_packaged_width_cm = 'NaN'::double precision
     OR p_packaged_width_cm IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR p_packaged_height_cm = 'NaN'::double precision
     OR p_packaged_height_cm IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR (p_category IS NOT NULL AND p_category NOT IN (
       'FURNITURE', 'KITCHEN', 'DECOR', 'TOOLS', 'TOYS',
       'JEWELRY', 'ART', 'OUTDOOR', 'STORAGE', 'OTHER'
     ))
     OR p_listing_type IS NULL
     OR p_listing_type NOT IN ('MADE_TO_ORDER', 'IN_STOCK')
     OR (
       p_listing_type = 'IN_STOCK'
       AND (
         p_stock_quantity IS NULL OR p_stock_quantity NOT BETWEEN 1 AND 1000000
         OR p_processing_time_min_days IS NOT NULL
         OR p_processing_time_max_days IS NOT NULL
         OR (p_ships_within_days IS NOT NULL AND p_ships_within_days NOT BETWEEN 1 AND 365)
       )
     )
     OR (
       p_listing_type = 'MADE_TO_ORDER'
       AND (
         p_stock_quantity IS NOT NULL
         OR p_ships_within_days IS NOT NULL
         OR (p_processing_time_min_days IS NOT NULL AND p_processing_time_min_days NOT BETWEEN 1 AND 365)
         OR (p_processing_time_max_days IS NOT NULL AND p_processing_time_max_days NOT BETWEEN 1 AND 365)
         OR (
           p_processing_time_min_days IS NOT NULL
           AND p_processing_time_max_days IS NOT NULL
           AND p_processing_time_min_days > p_processing_time_max_days
         )
       )
     )
     OR (
       p_is_private = false
       AND (
         p_reserved_for_user_id IS NOT NULL
         OR p_custom_order_conversation_id IS NOT NULL
         OR CASE
           WHEN pg_catalog.jsonb_typeof(p_photos) = 'array'
           THEN pg_catalog.jsonb_array_length(p_photos) < 1
           ELSE true
         END
       )
     )
     OR (
       p_is_private = true
       AND (
         p_status <> 'PENDING_REVIEW'
         OR p_reserved_for_user_id IS NULL
         OR p_reserved_for_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
         OR p_custom_order_conversation_id IS NULL
         OR p_custom_order_conversation_id !~ '^[A-Za-z0-9._:-]{1,191}$'
         OR CASE
           WHEN pg_catalog.jsonb_typeof(p_variant_groups) = 'array'
           THEN pg_catalog.jsonb_array_length(p_variant_groups) <> 0
           ELSE true
         END
       )
     ) THEN
    RAISE EXCEPTION 'Listing owner-create input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_is_private THEN
    SELECT *
      INTO pair
      FROM public.grainline_conversation_lock_pair_core(
        actor_id, p_reserved_for_user_id
      );
  END IF;

  SELECT seller.*
    INTO seller_state
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true
   FOR SHARE OF actor, seller;
  IF NOT FOUND OR (
    p_status = 'PENDING_REVIEW'
    AND NOT (
      seller_state."chargesEnabled" = true
      AND seller_state."stripeAccountSupported" = true
      AND seller_state."vacationMode" = false
    )
  ) THEN
    RETURN QUERY SELECT
      false, NULL::text, NULL::text, NULL::text, NULL::integer,
      NULL::text, NULL::text, NULL::timestamp without time zone,
      NULL::text, NULL::text[];
    RETURN;
  END IF;

  IF p_is_private THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public."Conversation" AS conversation
       WHERE conversation.id = p_custom_order_conversation_id
         AND conversation."userAId" = pair.user_a_id
         AND conversation."userBId" = pair.user_b_id
    ) THEN
      RETURN QUERY SELECT
        false, NULL::text, NULL::text, NULL::text, NULL::integer,
        NULL::text, NULL::text, NULL::timestamp without time zone,
        NULL::text, NULL::text[];
      RETURN;
    END IF;
  END IF;

  INSERT INTO public."Listing" (
    id, "sellerId", title, description, "priceCents", currency, status,
    "createdAt", "updatedAt", tags, "metaDescription", materials,
    "productLengthIn", "productWidthIn", "productHeightIn",
    "packagedLengthCm", "packagedWidthCm", "packagedHeightCm",
    "packagedWeightGrams", category, "listingType", "stockQuantity",
    "shipsWithinDays", "processingTimeMinDays", "processingTimeMaxDays",
    "isPrivate", "reservedForUserId", "customOrderConversationId"
  ) VALUES (
    p_listing_id, seller_state.id, p_title, p_description, p_price_cents,
    'usd', p_status::public."ListingStatus", source_now, source_now,
    p_tags, p_meta_description, p_materials,
    p_product_length_in, p_product_width_in, p_product_height_in,
    p_packaged_length_cm, p_packaged_width_cm, p_packaged_height_cm,
    p_packaged_weight_grams, p_category::public."Category",
    p_listing_type::public."ListingType", p_stock_quantity,
    p_ships_within_days, p_processing_time_min_days, p_processing_time_max_days,
    p_is_private, p_reserved_for_user_id, p_custom_order_conversation_id
  );

  PERFORM * FROM public.grainline_listing_children_replace_core(
    p_listing_id, p_price_cents, p_photos, p_variant_groups
  );

  RETURN QUERY SELECT
    true, p_listing_id, p_title, p_description, p_price_cents,
    'usd'::text, p_status, source_now, p_category, p_tags;
END
$grainline_listing_owner_create$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_create(
  text,text,boolean,text,text,text,text,integer,text[],text,text[],
  double precision,double precision,double precision,double precision,
  double precision,double precision,integer,text,text,integer,integer,
  integer,integer,jsonb,jsonb
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_create(
  text,text,boolean,text,text,text,text,integer,text[],text,text[],
  double precision,double precision,double precision,double precision,
  double precision,double precision,integer,text,text,integer,integer,
  integer,integer,jsonb,jsonb
) TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_content_update(
  p_listing_id text,
  p_expected_updated_at timestamp without time zone,
  p_expected_status text,
  p_expected_listing_type text,
  p_title text,
  p_description text,
  p_price_cents integer,
  p_increment_price_version boolean,
  p_tags text[],
  p_meta_description text,
  p_materials text[],
  p_product_length_in double precision,
  p_product_width_in double precision,
  p_product_height_in double precision,
  p_packaged_length_cm double precision,
  p_packaged_width_cm double precision,
  p_packaged_height_cm double precision,
  p_packaged_weight_grams integer,
  p_category text,
  p_listing_type text,
  p_stock_quantity integer,
  p_ships_within_days integer,
  p_processing_time_min_days integer,
  p_processing_time_max_days integer,
  p_photos jsonb,
  p_variant_groups jsonb
)
RETURNS TABLE (
  applied boolean,
  title text,
  "updatedAt" timestamp without time zone,
  "requiresReview" boolean,
  "approvedStatus" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_content_update$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
  source_listing public."Listing"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  next_stock integer;
  requires_review boolean;
  approved_status text;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_expected_updated_at IS NULL
     OR p_expected_status IS NULL
     OR p_expected_status NOT IN ('DRAFT', 'ACTIVE', 'SOLD_OUT', 'HIDDEN', 'REJECTED')
     OR p_expected_listing_type IS NULL
     OR p_expected_listing_type NOT IN ('MADE_TO_ORDER', 'IN_STOCK')
     OR p_title IS NULL
     OR pg_catalog.char_length(p_title) < 1
     OR pg_catalog.char_length(p_title) > 150
     OR p_description IS NULL
     OR pg_catalog.char_length(p_description) > 5000
     OR p_price_cents IS NULL
     OR p_price_cents < 1
     OR p_price_cents > 10000000
     OR p_increment_price_version IS NULL
     OR p_tags IS NULL
     OR pg_catalog.cardinality(p_tags) > 10
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_tags) AS tag(value)
        WHERE tag.value IS NULL
           OR pg_catalog.char_length(tag.value) > 100
     )
     OR (
       p_meta_description IS NOT NULL
       AND pg_catalog.char_length(p_meta_description) > 160
     )
     OR p_materials IS NULL
     OR pg_catalog.cardinality(p_materials) > 20
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_materials) AS material(value)
        WHERE material.value IS NULL
           OR pg_catalog.char_length(material.value) < 1
           OR pg_catalog.char_length(material.value) > 100
     )
     OR p_product_length_in = 'NaN'::double precision
     OR p_product_length_in IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR p_product_width_in = 'NaN'::double precision
     OR p_product_width_in IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR p_product_height_in = 'NaN'::double precision
     OR p_product_height_in IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR p_packaged_length_cm = 'NaN'::double precision
     OR p_packaged_length_cm IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR p_packaged_width_cm = 'NaN'::double precision
     OR p_packaged_width_cm IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR p_packaged_height_cm = 'NaN'::double precision
     OR p_packaged_height_cm IN ('Infinity'::double precision, '-Infinity'::double precision)
     OR (
       p_category IS NOT NULL
       AND p_category NOT IN (
         'FURNITURE', 'KITCHEN', 'DECOR', 'TOOLS', 'TOYS',
         'JEWELRY', 'ART', 'OUTDOOR', 'STORAGE', 'OTHER'
       )
     )
     OR p_listing_type IS NULL
     OR p_listing_type NOT IN ('MADE_TO_ORDER', 'IN_STOCK')
     OR (
       p_expected_listing_type <> p_listing_type
       AND p_listing_type = 'IN_STOCK'
       AND (
         p_stock_quantity IS NULL
         OR p_stock_quantity < 1
         OR p_stock_quantity > 1000000
       )
     )
     OR (
       p_expected_listing_type <> p_listing_type
       AND p_listing_type = 'MADE_TO_ORDER'
       AND p_stock_quantity IS NOT NULL
     )
     OR (
       p_listing_type = 'IN_STOCK'
       AND (
         p_processing_time_min_days IS NOT NULL
         OR p_processing_time_max_days IS NOT NULL
         OR (
           p_ships_within_days IS NOT NULL
           AND (p_ships_within_days < 1 OR p_ships_within_days > 365)
         )
       )
     )
     OR (
       p_listing_type = 'MADE_TO_ORDER'
       AND (
         p_ships_within_days IS NOT NULL
         OR (
           p_processing_time_min_days IS NOT NULL
           AND (p_processing_time_min_days < 1 OR p_processing_time_min_days > 365)
         )
         OR (
           p_processing_time_max_days IS NOT NULL
           AND (p_processing_time_max_days < 1 OR p_processing_time_max_days > 365)
         )
         OR (
           p_processing_time_min_days IS NOT NULL
           AND p_processing_time_max_days IS NOT NULL
           AND p_processing_time_min_days > p_processing_time_max_days
         )
       )
     )
     OR (CASE
       WHEN pg_catalog.jsonb_typeof(p_photos) = 'array'
       THEN pg_catalog.jsonb_array_length(p_photos) < 1
       ELSE true
     END) THEN
    RAISE EXCEPTION 'Listing owner content-update input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::text, NULL::timestamp without time zone,
      NULL::boolean, NULL::text;
    RETURN;
  END IF;

  SELECT listing.*
    INTO source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = seller_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, NULL::text, NULL::timestamp without time zone,
      NULL::boolean, NULL::text;
    RETURN;
  END IF;

  IF source_listing."updatedAt" IS DISTINCT FROM p_expected_updated_at
     OR source_listing.status::text <> p_expected_status
     OR source_listing."listingType"::text <> p_expected_listing_type
     OR source_listing."archivedAt" IS NOT NULL
     OR source_listing.status::text = 'PENDING_REVIEW'
     OR source_listing.status::text = 'SOLD'
     OR (
       source_listing.status::text = 'REJECTED'
       AND source_listing."rejectionReason" = 'Removed by Grainline staff.'
     ) THEN
    RETURN QUERY SELECT
      false, NULL::text, NULL::timestamp without time zone,
      NULL::boolean, NULL::text;
    RETURN;
  END IF;

  next_stock := CASE
    WHEN p_expected_listing_type <> p_listing_type THEN p_stock_quantity
    ELSE source_listing."stockQuantity"
  END;
  requires_review := source_listing.status::text IN ('ACTIVE', 'SOLD_OUT');
  approved_status := CASE
    WHEN source_listing.status::text = 'ACTIVE'
      AND p_listing_type = 'IN_STOCK'
      AND COALESCE(next_stock, 0) <= 0
    THEN 'SOLD_OUT'
    ELSE source_listing.status::text
  END;

  UPDATE public."Listing" AS listing
     SET title = p_title,
         description = p_description,
         "priceCents" = p_price_cents,
         "priceVersion" = CASE
           WHEN p_increment_price_version
           THEN source_listing."priceVersion" + 1
           ELSE source_listing."priceVersion"
         END,
         tags = p_tags,
         "metaDescription" = p_meta_description,
         materials = p_materials,
         "productLengthIn" = p_product_length_in,
         "productWidthIn" = p_product_width_in,
         "productHeightIn" = p_product_height_in,
         "packagedLengthCm" = p_packaged_length_cm,
         "packagedWidthCm" = p_packaged_width_cm,
         "packagedHeightCm" = p_packaged_height_cm,
         "packagedWeightGrams" = p_packaged_weight_grams,
         category = p_category::public."Category",
         "listingType" = p_listing_type::public."ListingType",
         "stockQuantity" = next_stock,
         "shipsWithinDays" = p_ships_within_days,
         "processingTimeMinDays" = p_processing_time_min_days,
         "processingTimeMaxDays" = p_processing_time_max_days,
         status = CASE
           WHEN requires_review THEN 'PENDING_REVIEW'::public."ListingStatus"
           ELSE source_listing.status
         END,
         "updatedAt" = source_now
   WHERE listing.id = source_listing.id;

  PERFORM * FROM public.grainline_listing_children_replace_core(
    source_listing.id, p_price_cents, p_photos, p_variant_groups
  );

  RETURN QUERY SELECT
    true, p_title, source_now, requires_review, approved_status;
END
$grainline_listing_owner_content_update$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_content_update(
  text,timestamp without time zone,text,text,text,text,integer,boolean,
  text[],text,text[],double precision,double precision,double precision,
  double precision,double precision,double precision,integer,text,text,
  integer,integer,integer,integer,jsonb,jsonb
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_content_update(
  text,timestamp without time zone,text,text,text,text,integer,boolean,
  text[],text,text[],double precision,double precision,double precision,
  double precision,double precision,double precision,integer,text,text,
  integer,integer,integer,integer,jsonb,jsonb
) TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_actor_transaction_source_core(
  p_listing_id text,
  p_allow_cart_owner boolean
)
RETURNS TABLE (
  id text,
  "sellerId" text,
  title text,
  description text,
  "priceCents" integer,
  "priceVersion" integer,
  currency text,
  status text,
  "listingType" text,
  "processingTimeMinDays" integer,
  "processingTimeMaxDays" integer,
  "shipsWithinDays" integer,
  category text,
  tags text[],
  "stockQuantity" integer,
  "packagedWeightGrams" integer,
  "packagedLengthCm" double precision,
  "packagedWidthCm" double precision,
  "packagedHeightCm" double precision,
  "isPrivate" boolean,
  "reservedForUserId" text,
  photos jsonb,
  "variantGroups" jsonb,
  "sellerUserId" text,
  "sellerDisplayName" text,
  "sellerChargesEnabled" boolean,
  "sellerStripeAccountSupported" boolean,
  "sellerOwnerAccountActive" boolean,
  "sellerVacationMode" boolean,
  "sellerAcceptingNewOrders" boolean,
  "sellerFreeShippingOverCents" integer,
  "sellerShippingFlatRateCents" integer,
  "sellerAllowLocalPickup" boolean,
  "sellerOffersGiftWrapping" boolean,
  "sellerGiftWrappingPriceCents" integer
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_actor_transaction_source_core$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_allow_cart_owner IS NULL THEN
    RAISE EXCEPTION 'Listing actor transaction-source input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT listing.id::text,
         listing."sellerId"::text,
         listing.title::text,
         listing.description::text,
         listing."priceCents",
         listing."priceVersion",
         listing.currency::text,
         listing.status::text,
         listing."listingType"::text,
         listing."processingTimeMinDays",
         listing."processingTimeMaxDays",
         listing."shipsWithinDays",
         listing.category::text,
         listing.tags,
         listing."stockQuantity",
         listing."packagedWeightGrams",
         listing."packagedLengthCm",
         listing."packagedWidthCm",
         listing."packagedHeightCm",
         listing."isPrivate",
         listing."reservedForUserId"::text,
         COALESCE(
           (
             SELECT pg_catalog.jsonb_agg(
                      pg_catalog.jsonb_build_object('url', photo.url)
                      ORDER BY photo."sortOrder", photo.id
                    )
               FROM public."Photo" AS photo
              WHERE photo."listingId" = listing.id
           ),
           '[]'::jsonb
         ),
         COALESCE(
           (
             SELECT pg_catalog.jsonb_agg(
                      pg_catalog.jsonb_build_object(
                        'id', variant_group.id,
                        'name', variant_group.name,
                        'options', COALESCE(
                          (
                            SELECT pg_catalog.jsonb_agg(
                                     pg_catalog.jsonb_build_object(
                                       'id', variant_option.id,
                                       'label', variant_option.label,
                                       'priceAdjustCents', variant_option."priceAdjustCents",
                                       'inStock', variant_option."inStock"
                                     )
                                     ORDER BY variant_option."sortOrder", variant_option.id
                                   )
                              FROM public."ListingVariantOption" AS variant_option
                             WHERE variant_option."groupId" = variant_group.id
                          ),
                          '[]'::jsonb
                        )
                      )
                      ORDER BY variant_group."sortOrder", variant_group.id
                    )
               FROM public."ListingVariantGroup" AS variant_group
              WHERE variant_group."listingId" = listing.id
           ),
           '[]'::jsonb
         ),
         seller."userId"::text,
         seller."displayName"::text,
         seller."chargesEnabled",
         seller."stripeAccountSupported",
         seller."ownerAccountActive",
         seller."vacationMode",
         seller."acceptingNewOrders",
         seller."freeShippingOverCents",
         seller."shippingFlatRateCents",
         seller."allowLocalPickup",
         seller."offersGiftWrapping",
         seller."giftWrappingPriceCents"
    FROM public."User" AS actor
    JOIN public."Listing" AS listing
      ON listing.id = p_listing_id
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND (
       (
         listing."archivedAt" IS NULL
         AND (
           (
             listing."isPrivate" = false
             AND listing.status IN ('ACTIVE', 'SOLD_OUT')
           )
           OR (
             listing."isPrivate" = true
             AND listing."reservedForUserId" = actor_id
             AND listing.status IN ('ACTIVE', 'SOLD')
           )
         )
       )
       OR (
         p_allow_cart_owner
         AND EXISTS (
         SELECT 1
           FROM public."Cart" AS actor_cart
           JOIN public."CartItem" AS actor_cart_item
             ON actor_cart_item."cartId" = actor_cart.id
          WHERE actor_cart."userId" = actor_id
            AND actor_cart_item."listingId" = listing.id
         )
       )
     );
END
$grainline_listing_actor_transaction_source_core$;

REVOKE ALL ON FUNCTION public.grainline_listing_actor_transaction_source_core(text,boolean)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

CREATE FUNCTION public.grainline_listing_actor_transaction_source(
  p_listing_id text
)
RETURNS TABLE (
  id text,
  "sellerId" text,
  title text,
  description text,
  "priceCents" integer,
  "priceVersion" integer,
  currency text,
  status text,
  "listingType" text,
  "processingTimeMinDays" integer,
  "processingTimeMaxDays" integer,
  "shipsWithinDays" integer,
  category text,
  tags text[],
  "stockQuantity" integer,
  "packagedWeightGrams" integer,
  "packagedLengthCm" double precision,
  "packagedWidthCm" double precision,
  "packagedHeightCm" double precision,
  "isPrivate" boolean,
  "reservedForUserId" text,
  photos jsonb,
  "variantGroups" jsonb,
  "sellerUserId" text,
  "sellerDisplayName" text,
  "sellerChargesEnabled" boolean,
  "sellerStripeAccountSupported" boolean,
  "sellerOwnerAccountActive" boolean,
  "sellerVacationMode" boolean,
  "sellerAcceptingNewOrders" boolean,
  "sellerFreeShippingOverCents" integer,
  "sellerShippingFlatRateCents" integer,
  "sellerAllowLocalPickup" boolean,
  "sellerOffersGiftWrapping" boolean,
  "sellerGiftWrappingPriceCents" integer
)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_actor_transaction_source$
  SELECT *
    FROM public.grainline_listing_actor_transaction_source_core(
      p_listing_id,
      false
    )
$grainline_listing_actor_transaction_source$;

REVOKE ALL ON FUNCTION public.grainline_listing_actor_transaction_source(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_actor_transaction_source(text)
  TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_actor_cart_transaction_sources(
  p_cart_id text
)
RETURNS TABLE (
  "cartItemId" text,
  id text,
  "sellerId" text,
  title text,
  description text,
  "priceCents" integer,
  "priceVersion" integer,
  currency text,
  status text,
  "listingType" text,
  "processingTimeMinDays" integer,
  "processingTimeMaxDays" integer,
  "shipsWithinDays" integer,
  category text,
  tags text[],
  "stockQuantity" integer,
  "packagedWeightGrams" integer,
  "packagedLengthCm" double precision,
  "packagedWidthCm" double precision,
  "packagedHeightCm" double precision,
  "isPrivate" boolean,
  "reservedForUserId" text,
  photos jsonb,
  "variantGroups" jsonb,
  "sellerUserId" text,
  "sellerDisplayName" text,
  "sellerChargesEnabled" boolean,
  "sellerStripeAccountSupported" boolean,
  "sellerOwnerAccountActive" boolean,
  "sellerVacationMode" boolean,
  "sellerAcceptingNewOrders" boolean,
  "sellerFreeShippingOverCents" integer,
  "sellerShippingFlatRateCents" integer,
  "sellerAllowLocalPickup" boolean,
  "sellerOffersGiftWrapping" boolean,
  "sellerGiftWrappingPriceCents" integer
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_actor_cart_transaction_sources$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_cart_id IS NULL
     OR p_cart_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Listing actor cart transaction-source input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT cart_item.id::text,
         source.id,
         source."sellerId",
         source.title,
         source.description,
         source."priceCents",
         source."priceVersion",
         source.currency,
         source.status,
         source."listingType",
         source."processingTimeMinDays",
         source."processingTimeMaxDays",
         source."shipsWithinDays",
         source.category,
         source.tags,
         source."stockQuantity",
         source."packagedWeightGrams",
         source."packagedLengthCm",
         source."packagedWidthCm",
         source."packagedHeightCm",
         source."isPrivate",
         source."reservedForUserId",
         source.photos,
         source."variantGroups",
         source."sellerUserId",
         source."sellerDisplayName",
         source."sellerChargesEnabled",
         source."sellerStripeAccountSupported",
         source."sellerOwnerAccountActive",
         source."sellerVacationMode",
         source."sellerAcceptingNewOrders",
         source."sellerFreeShippingOverCents",
         source."sellerShippingFlatRateCents",
         source."sellerAllowLocalPickup",
         source."sellerOffersGiftWrapping",
         source."sellerGiftWrappingPriceCents"
    FROM public."User" AS actor
    JOIN public."Cart" AS cart
      ON cart.id = p_cart_id
     AND cart."userId" = actor.id
    JOIN public."CartItem" AS cart_item
      ON cart_item."cartId" = cart.id
    CROSS JOIN LATERAL public.grainline_listing_actor_transaction_source_core(
      cart_item."listingId",
      true
    ) AS source
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   ORDER BY cart_item."createdAt", cart_item.id
   LIMIT 51;
END
$grainline_listing_actor_cart_transaction_sources$;

REVOKE ALL ON FUNCTION public.grainline_listing_actor_cart_transaction_sources(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_actor_cart_transaction_sources(text)
  TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_ai_review_context(
  p_listing_id text
)
RETURNS TABLE (
  "sellerProfileId" text,
  "listingUpdatedAt" timestamp without time zone,
  "recentTitles" text[],
  "photoUrls" text[]
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_ai_review_context$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
  listing_updated_at timestamp without time zone;
  source_now timestamp without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Listing owner AI-review context input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id, listing."updatedAt"
    INTO seller_id, listing_updated_at
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
    JOIN public."Listing" AS listing
      ON listing."sellerId" = seller.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true
     AND listing.id = p_listing_id
     AND listing."archivedAt" IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    seller_id,
    listing_updated_at,
    COALESCE(
      ARRAY(
        SELECT recent_listing.title::text
          FROM public."Listing" AS recent_listing
         WHERE recent_listing."sellerId" = seller_id
           AND recent_listing.id <> p_listing_id
           AND recent_listing."createdAt" >= source_now - INTERVAL '7 days'
         ORDER BY recent_listing."createdAt" DESC, recent_listing.id DESC
      ),
      ARRAY[]::text[]
    ),
    COALESCE(
      ARRAY(
        SELECT photo.url::text
          FROM public."Photo" AS photo
         WHERE photo."listingId" = p_listing_id
         ORDER BY photo."sortOrder", photo.id
         LIMIT 10
      ),
      ARRAY[]::text[]
    );
END
$grainline_listing_owner_ai_review_context$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_ai_review_context(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_ai_review_context(text)
  TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_alt_text_backfill(
  p_listing_id text,
  p_alt_texts text[],
  p_reviewed_image_urls text[]
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_alt_text_backfill$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
  source_photo_ids text[];
  source_photo_urls text[];
  source_index integer;
  updated_count integer;
  total_updated integer := 0;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_alt_texts IS NULL
     OR p_reviewed_image_urls IS NULL
     OR pg_catalog.cardinality(p_reviewed_image_urls) NOT BETWEEN 1 AND 10
     OR pg_catalog.cardinality(p_alt_texts)
          IS DISTINCT FROM pg_catalog.cardinality(p_reviewed_image_urls)
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_reviewed_image_urls) AS reviewed_url(value)
        WHERE reviewed_url.value IS NULL
           OR pg_catalog.char_length(reviewed_url.value) NOT BETWEEN 1 AND 2048
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_alt_texts) AS alt_text(value)
        WHERE alt_text.value IS NULL
           OR pg_catalog.char_length(alt_text.value) > 200
     ) THEN
    RAISE EXCEPTION 'Listing owner alt-text backfill input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  PERFORM 1
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = seller_id
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT
    pg_catalog.array_agg(photo.id ORDER BY photo."sortOrder", photo.id),
    pg_catalog.array_agg(photo.url ORDER BY photo."sortOrder", photo.id)
    INTO source_photo_ids, source_photo_urls
    FROM public."Photo" AS photo
   WHERE photo."listingId" = p_listing_id;

  IF source_photo_urls IS DISTINCT FROM p_reviewed_image_urls THEN
    RETURN 0;
  END IF;

  FOR source_index IN 1..pg_catalog.cardinality(source_photo_ids)
  LOOP
    IF p_alt_texts[source_index] <> '' THEN
      UPDATE public."Photo" AS photo
         SET "altText" = p_alt_texts[source_index]
       WHERE photo.id = source_photo_ids[source_index]
         AND photo."listingId" = p_listing_id
         AND photo.url = p_reviewed_image_urls[source_index]
         AND (photo."altText" IS NULL OR photo."altText" = '');
      GET DIAGNOSTICS updated_count = ROW_COUNT;
      total_updated := total_updated + updated_count;
    END IF;
  END LOOP;

  RETURN total_updated;
END
$grainline_listing_owner_alt_text_backfill$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_alt_text_backfill(
  text,text[],text[]
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_alt_text_backfill(
  text,text[],text[]
) TO grainline_app_runtime;

CREATE FUNCTION public.grainline_legacy_stock_restore_apply(
  p_session_id text,
  p_reserved_items jsonb
)
RETURNS TABLE (claimed boolean, stock_visibility_changed integer)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_legacy_stock_restore_apply$
DECLARE
  source_item record;
  source_claimed boolean;
  updated_count integer;
  visibility_count integer := 0;
BEGIN
  IF p_session_id IS NULL
     OR pg_catalog.char_length(p_session_id) = 0
     OR pg_catalog.char_length(p_session_id) > 255
     OR p_session_id IS DISTINCT FROM pg_catalog.btrim(p_session_id)
     OR p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$'
     OR p_reserved_items IS NULL
     OR pg_catalog.jsonb_typeof(p_reserved_items) <> 'array'
     OR pg_catalog.jsonb_array_length(p_reserved_items) NOT BETWEEN 1 AND 100
     OR pg_catalog.octet_length(p_reserved_items::text) > 65536
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(p_reserved_items) AS item(value)
        WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
           OR pg_catalog.jsonb_typeof(item.value->'listingId') <> 'string'
           OR item.value->>'listingId' !~ '^[A-Za-z0-9._:-]{1,191}$'
           OR pg_catalog.jsonb_typeof(item.value->'quantity') <> 'number'
           OR item.value->>'quantity' !~ '^[1-9][0-9]{0,6}$'
           OR (item.value->>'quantity')::bigint > 1000000
     )
     OR EXISTS (
       SELECT 1
         FROM (
           SELECT
             item.value->>'listingId' AS listing_id,
             pg_catalog.sum((item.value->>'quantity')::bigint) AS quantity
             FROM pg_catalog.jsonb_array_elements(p_reserved_items) AS item(value)
            GROUP BY item.value->>'listingId'
         ) AS grouped_item
        WHERE grouped_item.quantity > 1000000
     ) THEN
    RAISE EXCEPTION 'Legacy checkout stock-restore input is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- The predecessor claim owns the shared Session advisory lock, exact Order
  -- absence fence, and durable one-shot event. Calling it inside this function
  -- keeps that claim and every stock mutation in one database statement and
  -- therefore one transaction.
  source_claimed := public.grainline_legacy_stock_restore_claim(p_session_id);
  IF NOT source_claimed THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  FOR source_item IN
    SELECT
      item.value->>'listingId' AS listing_id,
      pg_catalog.sum((item.value->>'quantity')::integer)::integer AS quantity
      FROM pg_catalog.jsonb_array_elements(p_reserved_items) AS item(value)
     GROUP BY item.value->>'listingId'
     ORDER BY item.value->>'listingId'
  LOOP
    UPDATE public."Listing" AS listing
       SET "stockQuantity" = listing."stockQuantity" + source_item.quantity
     WHERE listing.id = source_item.listing_id
       AND listing."listingType" = 'IN_STOCK';

    UPDATE public."Listing" AS listing
       SET status = 'ACTIVE'
     WHERE listing.id = source_item.listing_id
       AND listing.status = 'SOLD_OUT'
       AND listing."stockQuantity" > 0;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    visibility_count := visibility_count + updated_count;
  END LOOP;

  RETURN QUERY SELECT true, visibility_count;
END
$grainline_legacy_stock_restore_apply$;

REVOKE ALL ON FUNCTION public.grainline_legacy_stock_restore_apply(text,jsonb)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_legacy_stock_restore_apply(text,jsonb)
  TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_account_deletion_redact(
  p_side_effect_id text,
  p_expected_user_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_archived_at timestamp without time zone
)
RETURNS TABLE (
  seller_profile_id text,
  photos_deleted integer,
  variant_groups_deleted integer,
  listings_redacted integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_account_deletion_redact$
DECLARE
  claimed_user_id text;
  source_seller_profile_id text;
  source_photos_deleted integer;
  source_variant_groups_deleted integer;
  source_listings_redacted integer;
BEGIN
  IF p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_expected_user_id IS NULL
     OR p_expected_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL
     OR p_archived_at IS NULL THEN
    RAISE EXCEPTION 'Listing account-deletion input is invalid'
      USING ERRCODE = '22023';
  END IF;

  claimed_user_id := public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );
  IF claimed_user_id IS DISTINCT FROM p_expected_user_id THEN
    RAISE EXCEPTION 'Listing account-deletion claim belongs to another user'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id
    INTO source_seller_profile_id
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = claimed_user_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing account-deletion seller profile is missing'
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public."Photo" AS photo
   USING public."Listing" AS listing
   WHERE photo."listingId" = listing.id
     AND listing."sellerId" = source_seller_profile_id;
  GET DIAGNOSTICS source_photos_deleted = ROW_COUNT;

  DELETE FROM public."ListingVariantGroup" AS variant_group
   USING public."Listing" AS listing
   WHERE variant_group."listingId" = listing.id
     AND listing."sellerId" = source_seller_profile_id;
  GET DIAGNOSTICS source_variant_groups_deleted = ROW_COUNT;

  UPDATE public."Listing" AS listing
     SET title = 'Deleted listing',
         status = 'HIDDEN',
         "isPrivate" = true,
         "archivedAt" = p_archived_at,
         description = '[Listing removed]',
         "videoUrl" = NULL,
         tags = ARRAY[]::text[],
         "metaDescription" = NULL,
         materials = ARRAY[]::text[],
         "aiReviewFlags" = ARRAY[]::text[],
         "aiReviewScore" = NULL,
         "rejectionReason" = 'Seller account deleted',
         "updatedAt" = p_archived_at
   WHERE listing."sellerId" = source_seller_profile_id;
  GET DIAGNOSTICS source_listings_redacted = ROW_COUNT;

  RETURN QUERY SELECT
    source_seller_profile_id,
    source_photos_deleted,
    source_variant_groups_deleted,
    source_listings_redacted;
END
$grainline_listing_account_deletion_redact$;

REVOKE ALL ON FUNCTION public.grainline_listing_account_deletion_redact(
  text,text,bigint,uuid,timestamp without time zone
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_account_deletion_redact(
  text,text,bigint,uuid,timestamp without time zone
) TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_delete_lock(
  p_listing_id text
)
RETURNS TABLE (
  id text,
  "sellerId" text,
  status text,
  "isPrivate" boolean,
  "archivedAt" timestamp without time zone,
  "customOrderConversationId" text,
  "updatedAt" timestamp without time zone
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_delete_lock$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
  source_listing public."Listing"%ROWTYPE;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Listing owner delete-lock input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT listing.*
    INTO source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = seller_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT
    source_listing.id::text,
    source_listing."sellerId"::text,
    source_listing.status::text,
    source_listing."isPrivate",
    source_listing."archivedAt",
    source_listing."customOrderConversationId"::text,
    source_listing."updatedAt";
END
$grainline_listing_owner_delete_lock$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_delete_lock(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_delete_lock(text)
  TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_archive(
  p_listing_id text,
  p_expected_updated_at timestamp without time zone
)
RETURNS TABLE (
  applied boolean,
  "updatedAt" timestamp without time zone,
  "archivedAt" timestamp without time zone
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_archive$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
  source_listing public."Listing"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Listing owner archive input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::timestamp, NULL::timestamp;
    RETURN;
  END IF;

  SELECT listing.*
    INTO source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = seller_id
     AND listing."updatedAt" = p_expected_updated_at
     AND listing."archivedAt" IS NULL
     AND listing.status <> 'PENDING_REVIEW'::public."ListingStatus"
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::timestamp, NULL::timestamp;
    RETURN;
  END IF;

  UPDATE public."Listing" AS listing
     SET status = 'HIDDEN'::public."ListingStatus",
         "isPrivate" = true,
         "archivedAt" = source_now,
         "updatedAt" = source_now
   WHERE listing.id = source_listing.id
     AND listing."sellerId" = seller_id;

  RETURN QUERY SELECT true, source_now, source_now;
END
$grainline_listing_owner_archive$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_archive(
  text,timestamp without time zone
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_archive(
  text,timestamp without time zone
) TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_hard_delete(
  p_listing_id text,
  p_expected_updated_at timestamp without time zone
)
RETURNS TABLE (
  applied boolean,
  "removedPhotos" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_hard_delete$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
  reference_state record;
  upload_result record;
  removed_photos integer := 0;
  deleted_count integer := 0;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Listing owner hard-delete input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  PERFORM 1
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = seller_id
     AND listing."updatedAt" = p_expected_updated_at
     AND listing."archivedAt" IS NULL
     AND listing."customOrderConversationId" IS NULL
     AND listing.status <> 'PENDING_REVIEW'::public."ListingStatus"
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  SELECT *
    INTO reference_state
    FROM public.grainline_listing_delete_reference_state(
      actor_id,
      p_listing_id
    );
  IF NOT FOUND
     OR reference_state."hasOrderItems"
     OR reference_state."hasReviews"
     OR reference_state."hasConversations"
     OR reference_state."hasMessages"
     OR reference_state."hasCheckoutReservations" THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  -- Re-run the durable media reconciliation inside the deleting authority.
  -- The application performs the same check first for its actionable error,
  -- but this fence prevents a future caller from bypassing it.
  SELECT *
    INTO upload_result
    FROM public.grainline_direct_upload_sync_listing(
      actor_id,
      p_listing_id
    );
  IF NOT FOUND OR upload_result.untracked <> 0 THEN
    RAISE EXCEPTION 'Listing upload lifecycle is incomplete'
      USING ERRCODE = '23514';
  END IF;

  -- Photo intentionally uses RESTRICT. Delete it only after the upload ledger
  -- is reconciled; the Listing delete trigger then releases those references.
  DELETE FROM public."Photo" AS photo
   WHERE photo."listingId" = p_listing_id;
  GET DIAGNOSTICS removed_photos = ROW_COUNT;

  DELETE FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = seller_id
     AND listing."updatedAt" = p_expected_updated_at
     AND listing."archivedAt" IS NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> 1 THEN
    RAISE EXCEPTION 'Listing owner hard-delete lost its locked row'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT true, removed_photos;
END
$grainline_listing_owner_hard_delete$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_hard_delete(
  text,timestamp without time zone
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_hard_delete(
  text,timestamp without time zone
) TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_transition(
  p_listing_id text,
  p_operation text,
  p_expected_updated_at timestamp without time zone
)
RETURNS TABLE (applied boolean)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_transition$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
  source_listing public."Listing"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_operation IS NULL
     OR p_operation NOT IN ('HIDE', 'MARK_SOLD', 'WITHDRAW_REVIEW', 'RETURN_TO_DRAFT')
     OR (
       p_operation IN ('WITHDRAW_REVIEW', 'RETURN_TO_DRAFT')
       AND p_expected_updated_at IS NULL
     )
     OR (
       p_operation NOT IN ('WITHDRAW_REVIEW', 'RETURN_TO_DRAFT')
       AND p_expected_updated_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Listing owner transition input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  SELECT listing.*
    INTO source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = seller_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  IF p_operation = 'HIDE' THEN
    IF source_listing."archivedAt" IS NOT NULL
       OR source_listing.status::text NOT IN ('ACTIVE', 'SOLD_OUT') THEN
      RETURN QUERY SELECT false;
      RETURN;
    END IF;
    UPDATE public."Listing" AS listing
       SET status = 'HIDDEN'::public."ListingStatus",
           "updatedAt" = source_now
     WHERE listing.id = source_listing.id;
  ELSIF p_operation = 'MARK_SOLD' THEN
    IF source_listing."archivedAt" IS NOT NULL
       OR source_listing.status::text NOT IN ('ACTIVE', 'SOLD_OUT') THEN
      RETURN QUERY SELECT false;
      RETURN;
    END IF;
    UPDATE public."Listing" AS listing
       SET status = 'SOLD'::public."ListingStatus",
           "updatedAt" = source_now
     WHERE listing.id = source_listing.id;
  ELSIF p_operation = 'WITHDRAW_REVIEW' THEN
    IF source_listing.status::text <> 'PENDING_REVIEW'
       OR source_listing."updatedAt" IS DISTINCT FROM p_expected_updated_at THEN
      RETURN QUERY SELECT false;
      RETURN;
    END IF;
    UPDATE public."Listing" AS listing
       SET status = 'DRAFT'::public."ListingStatus",
           "aiReviewFlags" = ARRAY[]::text[],
           "aiReviewScore" = NULL,
           "reviewedByAdmin" = false,
           "reviewedAt" = NULL,
           "rejectionReason" = NULL,
           "updatedAt" = source_now
     WHERE listing.id = source_listing.id;
  ELSIF p_operation = 'RETURN_TO_DRAFT' THEN
    IF source_listing."archivedAt" IS NOT NULL
       OR source_listing.status::text NOT IN ('PENDING_REVIEW', 'ACTIVE', 'SOLD_OUT')
       OR source_listing."updatedAt" IS DISTINCT FROM p_expected_updated_at THEN
      RETURN QUERY SELECT false;
      RETURN;
    END IF;
    UPDATE public."Listing" AS listing
       SET status = 'DRAFT'::public."ListingStatus",
           "updatedAt" = source_now
     WHERE listing.id = source_listing.id;
  ELSE
    RAISE EXCEPTION 'Listing owner transition operation is unsupported'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT true;
END
$grainline_listing_owner_transition$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_transition(
  text,text,timestamp without time zone
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_transition(
  text,text,timestamp without time zone
) TO grainline_app_runtime;

CREATE FUNCTION public.grainline_listing_owner_review_transition(
  p_listing_id text,
  p_reviewed_at timestamp without time zone,
  p_source_status text,
  p_status text,
  p_flags text[],
  p_score double precision
)
RETURNS TABLE (applied boolean, "updatedAt" timestamp without time zone)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_owner_review_transition$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  seller_id text;
  source_listing public."Listing"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_listing_id IS NULL
     OR p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_reviewed_at IS NULL
     OR p_source_status IS NULL
     OR p_status IS NULL
     OR NOT (
       (
         p_source_status = 'PENDING_REVIEW'
         AND p_status IN ('PENDING_REVIEW', 'ACTIVE', 'SOLD_OUT', 'DRAFT')
       )
       OR (
         p_source_status IN ('DRAFT', 'HIDDEN', 'SOLD', 'SOLD_OUT', 'REJECTED')
         AND p_status IN ('PENDING_REVIEW', 'ACTIVE')
       )
     )
     OR p_flags IS NULL
     OR pg_catalog.cardinality(p_flags) > 20
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_flags) AS flag(value)
        WHERE flag.value IS NULL
           OR pg_catalog.char_length(flag.value) > 80
     )
     OR p_score IS NULL
     OR p_score < 0
     OR p_score > 1
     OR p_score = 'NaN'::double precision THEN
    RAISE EXCEPTION 'Listing owner review-transition input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.id
    INTO seller_id
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = actor_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller."ownerAccountActive" = true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::timestamp without time zone;
    RETURN;
  END IF;

  SELECT listing.*
    INTO source_listing
    FROM public."Listing" AS listing
   WHERE listing.id = p_listing_id
     AND listing."sellerId" = seller_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::timestamp without time zone;
    RETURN;
  END IF;

  IF source_listing.status::text <> p_source_status
     OR source_listing."updatedAt" IS DISTINCT FROM p_reviewed_at
     OR source_listing."archivedAt" IS NOT NULL
     OR (
       p_status IN ('ACTIVE', 'SOLD_OUT')
       AND NOT source_listing."sellerPubliclyOrderable"
     )
     OR (
       p_source_status <> 'PENDING_REVIEW'
       AND (
         source_listing."rejectionReason" = 'Removed by Grainline staff.'
         OR (
           source_listing."listingType"::text = 'IN_STOCK'
           AND COALESCE(source_listing."stockQuantity", 0) <= 0
         )
       )
     ) THEN
    RETURN QUERY SELECT false, NULL::timestamp without time zone;
    RETURN;
  END IF;

  UPDATE public."Listing" AS listing
     SET status = CASE
           WHEN p_source_status = 'PENDING_REVIEW'
             AND p_status = 'ACTIVE'
             AND source_listing."listingType"::text = 'IN_STOCK'
             AND COALESCE(source_listing."stockQuantity", 0) <= 0
           THEN 'SOLD_OUT'::public."ListingStatus"
           ELSE p_status::public."ListingStatus"
         END,
         "aiReviewFlags" = p_flags,
         "aiReviewScore" = p_score,
         "rejectionReason" = CASE
           WHEN p_source_status = 'PENDING_REVIEW'
           THEN source_listing."rejectionReason"
           ELSE NULL
         END,
         "updatedAt" = source_now
   WHERE listing.id = source_listing.id;

  RETURN QUERY SELECT true, source_now;
END
$grainline_listing_owner_review_transition$;

REVOKE ALL ON FUNCTION public.grainline_listing_owner_review_transition(
  text,timestamp without time zone,text,text,text[],double precision
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_listing_owner_review_transition(
  text,timestamp without time zone,text,text,text[],double precision
) TO grainline_app_runtime;

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
