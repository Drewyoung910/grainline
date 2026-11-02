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
