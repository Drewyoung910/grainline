BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Compatible preparation only. AdminAuditLog RLS and predecessor table grants
-- remain unchanged until every caller, race proof and rollback passes.
DO $grainline_admin_audit_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."AdminAuditLog"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog RLS must remain off during compatible preparation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid IN (
       pg_catalog.to_regprocedure('public.grainline_admin_audit_append(text,text,text,text,text,jsonb)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_staff_count(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_staff_page(text,text,integer,integer)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_staff_undo_source(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_candidates(text,text[],text[],text,integer)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_ban_repair_candidates(integer)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_ban_repair_state(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)')
     )
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation function already exists';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_indexes AS index_state
     WHERE index_state.schemaname = 'public'
       AND index_state.tablename = 'AdminAuditLog'
       AND index_state.indexname IN (
         'AdminAuditLog_createdAt_id_idx',
         'AdminAuditLog_action_createdAt_id_idx'
       )
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation index already exists';
  END IF;
END;
$grainline_admin_audit_preflight$;

CREATE INDEX "AdminAuditLog_createdAt_id_idx"
  ON public."AdminAuditLog" ("createdAt" DESC, id DESC);

CREATE INDEX "AdminAuditLog_action_createdAt_id_idx"
  ON public."AdminAuditLog" (action, "createdAt" DESC, id DESC);

CREATE FUNCTION public.grainline_admin_audit_append(
  p_actor_id text,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_reason text,
  p_metadata jsonb
)
RETURNS TABLE (
  id text,
  "createdAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_append$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  actor_role text;
  actor_active boolean := false;
  actor_deleted boolean := false;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  audit_id text := pg_catalog.gen_random_uuid()::text;
  stored_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_actor_id IS NULL
     OR p_actor_id <> actor_id THEN
    RAISE EXCEPTION 'Admin audit actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_action IS NULL
     OR pg_catalog.char_length(p_action) NOT BETWEEN 1 AND 100
     OR p_target_type IS NULL
     OR pg_catalog.char_length(p_target_type) NOT BETWEEN 1 AND 100
     OR p_target_id IS NULL
     OR pg_catalog.char_length(p_target_id) NOT BETWEEN 1 AND 255
     OR (p_reason IS NOT NULL AND pg_catalog.char_length(p_reason) > 1000)
     OR pg_catalog.jsonb_typeof(stored_metadata) <> 'object'
     OR pg_catalog.octet_length(stored_metadata::text) > 1000000 THEN
    RAISE EXCEPTION 'Admin audit append input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.role::text,
         actor.banned = false AND actor."deletedAt" IS NULL,
         actor."deletedAt" IS NOT NULL
    INTO actor_role, actor_active, actor_deleted
    FROM public."User" AS actor
   WHERE actor.id = actor_id
   FOR SHARE;
  IF NOT FOUND
     OR actor_deleted
     OR (NOT actor_active AND p_action <> 'USER_ACCOUNT_DELETE') THEN
    RAISE EXCEPTION 'Admin audit actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  CASE p_action
    WHEN 'TERMS_ACCEPTED', 'ACCOUNT_EXPORT', 'USER_ACCOUNT_DELETE' THEN
      IF p_target_type <> 'USER' OR p_target_id <> actor_id THEN
        RAISE EXCEPTION 'Admin audit self-action target is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'user'
      );

    WHEN 'AI_HOLD_LISTING' THEN
      IF p_target_type <> 'LISTING'
         OR NOT EXISTS (
           SELECT 1
             FROM public."Listing" AS listing
             JOIN public."SellerProfile" AS seller
               ON seller.id = listing."sellerId"
            WHERE listing.id = p_target_id
              AND seller."userId" = actor_id
              AND listing.status::text = 'PENDING_REVIEW'
         ) THEN
        RAISE EXCEPTION 'Admin audit automated listing source is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'automated'
      );

    WHEN 'ADMIN_PIN_VERIFY_OK',
         'ADMIN_PIN_VERIFY_FAIL',
         'ADMIN_PIN_RATE_LIMIT' THEN
      IF actor_role NOT IN ('ADMIN', 'EMPLOYEE')
         OR p_target_type <> 'USER'
         OR p_target_id <> actor_id THEN
        RAISE EXCEPTION 'Admin audit PIN actor is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    WHEN 'APPROVE_GUILD_MEMBER_BLOCKED',
         'APPROVE_GUILD_MASTER_BLOCKED' THEN
      IF actor_role NOT IN ('ADMIN', 'EMPLOYEE')
         OR p_target_type <> 'SELLER_PROFILE'
         OR NOT EXISTS (
           SELECT 1 FROM public."SellerProfile" AS seller
            WHERE seller.id = p_target_id
         ) THEN
        RAISE EXCEPTION 'Admin audit Guild actor or target is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    WHEN 'APPROVE_BLOG_COMMENT' THEN
      IF actor_role NOT IN ('ADMIN', 'EMPLOYEE')
         OR p_target_type <> 'BLOG_COMMENT'
         OR NOT EXISTS (
           SELECT 1 FROM public."BlogComment" AS comment
            WHERE comment.id = p_target_id
              AND comment.approved = true
         ) THEN
        RAISE EXCEPTION 'Admin audit comment approval source is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    WHEN 'DELETE_BLOG_COMMENT' THEN
      IF actor_role NOT IN ('ADMIN', 'EMPLOYEE')
         OR p_target_type <> 'BLOG_COMMENT'
         OR pg_catalog.jsonb_typeof(stored_metadata->'postId') <> 'string'
         OR pg_catalog.jsonb_typeof(stored_metadata->'authorId') <> 'string'
         OR pg_catalog.char_length(stored_metadata->>'postId') NOT BETWEEN 1 AND 191
         OR pg_catalog.char_length(stored_metadata->>'authorId') NOT BETWEEN 1 AND 191
         OR NOT EXISTS (
           SELECT 1 FROM public."BlogPost" AS post
            WHERE post.id = stored_metadata->>'postId'
         )
         OR NOT EXISTS (
           SELECT 1 FROM public."User" AS author
            WHERE author.id = stored_metadata->>'authorId'
         )
         OR EXISTS (
           SELECT 1 FROM public."BlogComment" AS comment
            WHERE comment.id = p_target_id
         ) THEN
        RAISE EXCEPTION 'Admin audit comment deletion source is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    WHEN 'DELETE_REVIEW' THEN
      IF actor_role <> 'ADMIN'
         OR p_target_type <> 'Review'
         OR pg_catalog.jsonb_typeof(stored_metadata->'listingId') <> 'string'
         OR pg_catalog.jsonb_typeof(stored_metadata->'reviewerId') <> 'string'
         OR pg_catalog.char_length(stored_metadata->>'listingId') NOT BETWEEN 1 AND 191
         OR pg_catalog.char_length(stored_metadata->>'reviewerId') NOT BETWEEN 1 AND 191
         OR NOT EXISTS (
           SELECT 1 FROM public."Listing" AS listing
            WHERE listing.id = stored_metadata->>'listingId'
         )
         OR NOT EXISTS (
           SELECT 1 FROM public."User" AS reviewer
            WHERE reviewer.id = stored_metadata->>'reviewerId'
         )
         OR EXISTS (
           SELECT 1 FROM public."Review" AS review
            WHERE review.id = p_target_id
         ) THEN
        RAISE EXCEPTION 'Admin audit review deletion source is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    WHEN 'SEND_EMAIL' THEN
      IF actor_role <> 'ADMIN'
         OR p_target_type <> 'USER'
         OR NOT EXISTS (
           SELECT 1 FROM public."User" AS target
            WHERE target.id = p_target_id
         ) THEN
        RAISE EXCEPTION 'Admin audit email target is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    WHEN 'REMOVE_LISTING' THEN
      IF actor_role <> 'ADMIN'
         OR p_target_type <> 'Listing'
         OR NOT EXISTS (
           SELECT 1 FROM public."Listing" AS listing
            WHERE listing.id = p_target_id
              AND listing.status::text = 'REJECTED'
              AND listing."isPrivate" = true
              AND pg_catalog.jsonb_typeof(stored_metadata->'title') = 'string'
              AND stored_metadata->>'title' = listing.title
              AND pg_catalog.jsonb_typeof(stored_metadata->'sellerId') = 'string'
              AND stored_metadata->>'sellerId' = listing."sellerId"
         ) THEN
        RAISE EXCEPTION 'Admin audit listing removal source is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    WHEN 'BAN_USER' THEN
      IF actor_role <> 'ADMIN'
         OR p_target_type <> 'USER'
         OR p_target_id = actor_id
         OR NOT EXISTS (
           SELECT 1 FROM public."User" AS target
            WHERE target.id = p_target_id
              AND target.banned = true
              AND target."bannedBy" = actor_id
              AND target."bannedAt" IS NOT NULL
              AND stored_metadata->>'externalSyncVersion' = '1'
              AND stored_metadata->>'appliedBannedAt' = pg_catalog.to_char(
                target."bannedAt",
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              )
         ) THEN
        RAISE EXCEPTION 'Admin audit ban source is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    WHEN 'UNBAN_USER' THEN
      IF actor_role <> 'ADMIN'
         OR p_target_type <> 'USER'
         OR p_target_id = actor_id
         OR pg_catalog.jsonb_typeof(stored_metadata->'previousUser') <> 'object'
         OR stored_metadata->'previousUser'->>'banned' <> 'true'
         OR NOT EXISTS (
           SELECT 1 FROM public."User" AS target
            WHERE target.id = p_target_id
              AND target.banned = false
         ) THEN
        RAISE EXCEPTION 'Admin audit unban source is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    WHEN 'BAN_USER_CLERK_SYNC',
         'BAN_USER_CLERK_SYNC_FAILED',
         'BAN_USER_CHECKOUT_SESSIONS_EXPIRED' THEN
      IF actor_role <> 'ADMIN'
         OR p_target_type <> 'USER'
         OR p_target_id = actor_id
         OR NOT EXISTS (
           SELECT 1 FROM public."User" AS target
            WHERE target.id = p_target_id
              AND target.banned = true
         )
         OR NOT (
           (
             pg_catalog.jsonb_typeof(stored_metadata->'originalActionId') = 'string'
             AND EXISTS (
               SELECT 1 FROM public."AdminAuditLog" AS source_audit
                WHERE source_audit.id = stored_metadata->>'originalActionId'
                  AND source_audit.action = 'BAN_USER'
                  AND source_audit."targetType" = 'USER'
                  AND source_audit."targetId" = p_target_id
                  AND source_audit.undone = false
             )
           )
           OR (
             p_action <> 'BAN_USER_CHECKOUT_SESSIONS_EXPIRED'
             AND stored_metadata->>'idempotentConvergence' = 'true'
             AND stored_metadata->>'unmatchedHistoricalBan' = 'true'
           )
         ) THEN
        RAISE EXCEPTION 'Admin audit ban side-effect source is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    WHEN 'UNBAN_USER_CLERK_SYNC',
         'UNBAN_USER_CLERK_SYNC_FAILED' THEN
      IF actor_role <> 'ADMIN'
         OR p_target_type <> 'USER'
         OR p_target_id = actor_id
         OR NOT EXISTS (
           SELECT 1 FROM public."User" AS target
            WHERE target.id = p_target_id
              AND target.banned = false
         )
         OR NOT (
           (
             pg_catalog.jsonb_typeof(stored_metadata->'originalActionId') = 'string'
             AND EXISTS (
               SELECT 1 FROM public."AdminAuditLog" AS source_audit
                WHERE source_audit.id = stored_metadata->>'originalActionId'
                  AND source_audit.action = 'UNBAN_USER'
                  AND source_audit."targetType" = 'USER'
                  AND source_audit."targetId" = p_target_id
             )
           )
           OR stored_metadata->>'idempotentConvergence' = 'true'
         ) THEN
        RAISE EXCEPTION 'Admin audit unban side-effect source is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    WHEN 'UNDO_BAN_USER_CLERK_SYNC',
         'UNDO_BAN_USER_CLERK_SYNC_FAILED' THEN
      IF actor_role <> 'ADMIN'
         OR p_target_type <> 'USER'
         OR p_target_id = actor_id
         OR NOT EXISTS (
           SELECT 1 FROM public."User" AS target
            WHERE target.id = p_target_id
              AND target.banned = false
         )
         OR pg_catalog.jsonb_typeof(stored_metadata->'originalActionId') <> 'string'
         OR NOT EXISTS (
           SELECT 1 FROM public."AdminAuditLog" AS source_audit
            WHERE source_audit.id = stored_metadata->>'originalActionId'
              AND source_audit.action = 'BAN_USER'
              AND source_audit."targetType" = 'USER'
              AND source_audit."targetId" = p_target_id
              AND source_audit.undone = true
         ) THEN
        RAISE EXCEPTION 'Admin audit undo-ban side-effect source is invalid'
          USING ERRCODE = '42501';
      END IF;
      stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
        'actorKind', 'staff'
      );

    ELSE
      RAISE EXCEPTION 'Admin audit action is not available to the application writer'
        USING ERRCODE = '42501';
  END CASE;

  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason, metadata,
    undone, "createdAt"
  )
  VALUES (
    audit_id, actor_id, p_action, p_target_type, p_target_id, p_reason,
    stored_metadata, false, source_now
  );

  RETURN QUERY SELECT audit_id, source_now;
END;
$grainline_admin_audit_append$;

CREATE FUNCTION public.grainline_admin_audit_staff_count(
  p_actor_id text,
  p_action text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_staff_count$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_action IS NOT NULL AND (
       pg_catalog.char_length(p_action) NOT BETWEEN 1 AND 100
     ))
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = p_actor_id
          AND actor.role::text = 'ADMIN'
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Admin audit staff count context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT pg_catalog.count(*)::bigint
      FROM public."AdminAuditLog" AS audit
     WHERE p_action IS NULL OR audit.action = p_action
  );
END;
$grainline_admin_audit_staff_count$;

CREATE FUNCTION public.grainline_admin_audit_staff_page(
  p_actor_id text,
  p_action text,
  p_offset integer,
  p_limit integer
)
RETURNS TABLE (
  id text,
  "adminId" text,
  action text,
  "targetType" text,
  "targetId" text,
  reason text,
  undone boolean,
  "createdAt" timestamp(3) without time zone,
  "actorKind" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_staff_page$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_action IS NOT NULL AND (
       pg_catalog.char_length(p_action) NOT BETWEEN 1 AND 100
     ))
     OR p_offset IS NULL
     OR p_offset < 0
     OR p_offset > 29970
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 100
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = p_actor_id
          AND actor.role::text = 'ADMIN'
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Admin audit staff page context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT audit.id::text,
         audit."adminId"::text,
         audit.action::text,
         audit."targetType"::text,
         audit."targetId"::text,
         audit.reason::text,
         audit.undone,
         audit."createdAt",
         CASE
           WHEN audit.action = 'AI_HOLD_LISTING' THEN 'automated'
           WHEN audit.metadata->>'actorKind' = 'automated' THEN 'automated'
           WHEN audit.metadata->>'actorKind' = 'user'
             OR audit.action IN ('TERMS_ACCEPTED', 'ACCOUNT_EXPORT', 'USER_ACCOUNT_DELETE')
             THEN 'user'
           ELSE 'staff'
         END::text
    FROM public."AdminAuditLog" AS audit
   WHERE p_action IS NULL OR audit.action = p_action
   ORDER BY audit."createdAt" DESC, audit.id DESC
   OFFSET p_offset
   LIMIT p_limit;
END;
$grainline_admin_audit_staff_page$;

CREATE FUNCTION public.grainline_admin_audit_staff_undo_source(
  p_actor_id text,
  p_log_id text
)
RETURNS TABLE (
  id text,
  "adminId" text,
  action text,
  "targetType" text,
  "targetId" text,
  reason text,
  metadata jsonb,
  undone boolean,
  "createdAt" timestamp(3) without time zone,
  "latestUndoSyncAction" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_staff_undo_source$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_log_id IS NULL
     OR p_log_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = p_actor_id
          AND actor.role::text = 'ADMIN'
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Admin audit undo-source context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT source_audit.id::text,
         source_audit."adminId"::text,
         source_audit.action::text,
         source_audit."targetType"::text,
         source_audit."targetId"::text,
         source_audit.reason::text,
         source_audit.metadata,
         source_audit.undone,
         source_audit."createdAt",
         (
           SELECT related.action::text
             FROM public."AdminAuditLog" AS related
            WHERE source_audit.action = 'BAN_USER'
              AND related.action IN (
                    'UNDO_BAN_USER_CLERK_SYNC',
                    'UNDO_BAN_USER_CLERK_SYNC_FAILED'
                  )
              AND related."targetType" = source_audit."targetType"
              AND related."targetId" = source_audit."targetId"
              AND related.metadata->>'originalActionId' = source_audit.id
            ORDER BY related."createdAt" DESC, related.id DESC
            LIMIT 1
         )
    FROM public."AdminAuditLog" AS source_audit
   WHERE source_audit.id = p_log_id;
END;
$grainline_admin_audit_staff_undo_source$;

CREATE FUNCTION public.grainline_admin_audit_undo_claim(
  p_actor_id text,
  p_log_id text,
  p_reason text,
  p_expected_admin_id text,
  p_expected_action text,
  p_expected_target_type text,
  p_expected_target_id text,
  p_expected_metadata jsonb
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_undo_claim$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  actor_role text;
  actor_active boolean := false;
  source_admin_id text;
  source_action text;
  source_target_type text;
  source_target_id text;
  source_metadata jsonb;
  source_undone boolean;
  source_created_at timestamp(3) without time zone;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  undo_id text := pg_catalog.gen_random_uuid()::text;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_actor_id IS NULL
     OR p_actor_id <> actor_id THEN
    RAISE EXCEPTION 'Admin audit undo actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF p_log_id IS NULL
     OR p_log_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_reason IS NULL
     OR pg_catalog.char_length(p_reason) NOT BETWEEN 1 AND 500
     OR p_expected_admin_id IS NULL
     OR p_expected_admin_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_expected_action IS NULL
     OR p_expected_target_type IS NULL
     OR p_expected_target_id IS NULL
     OR p_expected_metadata IS NULL
     OR pg_catalog.octet_length(p_expected_metadata::text) > 1000000 THEN
    RAISE EXCEPTION 'Admin audit undo input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.role::text,
         actor.banned = false AND actor."deletedAt" IS NULL
    INTO actor_role, actor_active
    FROM public."User" AS actor
   WHERE actor.id = actor_id
   FOR SHARE;
  IF NOT FOUND OR NOT actor_active OR actor_role <> 'ADMIN' THEN
    RAISE EXCEPTION 'Admin audit undo actor context is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT source_audit."adminId"::text,
         source_audit.action::text,
         source_audit."targetType"::text,
         source_audit."targetId"::text,
         source_audit.metadata,
         source_audit.undone,
         source_audit."createdAt"
    INTO source_admin_id, source_action, source_target_type, source_target_id,
         source_metadata, source_undone, source_created_at
    FROM public."AdminAuditLog" AS source_audit
   WHERE source_audit.id = p_log_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Action not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF source_action NOT IN ('BAN_USER', 'REMOVE_LISTING', 'HOLD_LISTING')
     OR (source_action = 'BAN_USER' AND source_target_type <> 'USER')
     OR (
       source_action IN ('REMOVE_LISTING', 'HOLD_LISTING')
       AND source_target_type <> 'Listing'
     ) THEN
    RAISE EXCEPTION 'Action ''%'' cannot be undone', source_action
      USING ERRCODE = '42501';
  END IF;
  IF source_admin_id = actor_id THEN
    RAISE EXCEPTION 'Admins cannot undo their own actions'
      USING ERRCODE = '42501';
  END IF;
  IF source_undone THEN
    RAISE EXCEPTION 'Already undone (concurrent request)'
      USING ERRCODE = '55000';
  END IF;
  IF source_created_at < (
       pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
     ) - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'Undo window expired (24 hours)'
      USING ERRCODE = '42501';
  END IF;
  IF source_admin_id <> p_expected_admin_id
     OR source_action <> p_expected_action
     OR source_target_type <> p_expected_target_type
     OR source_target_id <> p_expected_target_id
     OR source_metadata IS DISTINCT FROM p_expected_metadata THEN
    RAISE EXCEPTION 'Action changed before undo could be applied'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public."AdminAuditLog"
     SET undone = true,
         "undoneAt" = source_now,
         "undoneBy" = actor_id,
         "undoneReason" = p_reason
   WHERE id = p_log_id;

  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason, metadata,
    undone, "createdAt"
  )
  VALUES (
    undo_id, actor_id, 'UNDO_' || source_action, source_target_type,
    source_target_id, p_reason,
    pg_catalog.jsonb_build_object(
      'originalActionId', p_log_id,
      'actorKind', 'staff'
    ),
    false, source_now
  );

  RETURN undo_id;
END;
$grainline_admin_audit_undo_claim$;

CREATE FUNCTION public.grainline_admin_audit_account_deletion_candidates(
  p_user_id text,
  p_target_ids text[],
  p_reference_values text[],
  p_after_id text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  metadata jsonb,
  reason text,
  "metadataSha256" text,
  "reasonSha256" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_account_deletion_candidates$
BEGIN
  IF SESSION_USER <> 'grainline_account_deletion_runtime'
     OR p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_ids IS NULL
     OR pg_catalog.cardinality(p_target_ids) NOT BETWEEN 1 AND 16
     OR NOT (p_user_id = ANY(p_target_ids))
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_target_ids) AS value
        WHERE value IS NULL OR pg_catalog.char_length(value) NOT BETWEEN 1 AND 255
     )
     OR p_reference_values IS NULL
     OR pg_catalog.cardinality(p_reference_values) NOT BETWEEN 1 AND 16
     OR NOT (p_user_id = ANY(p_reference_values))
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_reference_values) AS value
        WHERE value IS NULL OR pg_catalog.char_length(value) NOT BETWEEN 1 AND 255
     )
     OR (p_after_id IS NOT NULL AND p_after_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 500
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS deleted_user
        WHERE deleted_user.id = p_user_id
          AND deleted_user."deletedAt" IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public."AdminAuditLog" AS deletion_audit
        WHERE deletion_audit."adminId" = p_user_id
          AND deletion_audit.action = 'USER_ACCOUNT_DELETE'
          AND deletion_audit."targetType" = 'USER'
          AND deletion_audit."targetId" = p_user_id
     ) THEN
    RAISE EXCEPTION 'Admin audit account-deletion candidate context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT audit.id::text,
         audit.metadata,
         audit.reason::text,
         pg_catalog.encode(
           pg_catalog.sha256(
             pg_catalog.convert_to(audit.metadata::text, 'UTF8')
           ),
           'hex'
         ),
         pg_catalog.encode(
           pg_catalog.sha256(
             pg_catalog.convert_to(
               pg_catalog.jsonb_build_object('reason', audit.reason)::text,
               'UTF8'
             )
           ),
           'hex'
         )
    FROM public."AdminAuditLog" AS audit
   WHERE (p_after_id IS NULL OR audit.id > p_after_id)
     AND (
       audit."adminId" = p_user_id
       OR audit."targetId" = ANY(p_target_ids)
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.unnest(p_reference_values) AS reference_value
          WHERE pg_catalog.jsonb_path_exists(
            audit.metadata,
            '$.** ? (@ == $account_reference)'::pg_catalog.jsonpath,
            pg_catalog.jsonb_build_object(
              'account_reference',
              pg_catalog.to_jsonb(reference_value)
            ),
            true
          )
       )
     )
   ORDER BY audit.id ASC
   LIMIT p_limit;
END;
$grainline_admin_audit_account_deletion_candidates$;

CREATE FUNCTION public.grainline_admin_audit_account_deletion_redaction_apply(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_log_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_account_deletion_redaction_apply$
DECLARE
  source_effect public."AccountDeletionSideEffect"%ROWTYPE;
  current_metadata jsonb;
  current_reason text;
  current_metadata_sha256 text;
  current_reason_sha256 text;
  next_metadata jsonb;
  next_reason text;
  update_metadata boolean;
  update_reason boolean;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF SESSION_USER <> 'grainline_account_deletion_runtime'
     OR p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL
     OR p_log_id IS NULL
     OR p_log_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Admin audit account-deletion redaction input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT effect.*
    INTO source_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
     AND effect.status = 'PROCESSING'
     AND effect.kind = 'AUDIT_REDACT'
     AND effect."dedupKey" = 'account-delete:audit:' || effect."userId" || ':' || p_log_id
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
     AND effect.payload->>'logId' = p_log_id
     AND pg_catalog.jsonb_typeof(effect.payload->'planVersion') = 'number'
     AND effect.payload->>'planVersion' = '2'
     AND effect.payload->>'expectedMetadataSha256' ~ '^[0-9a-f]{64}$'
     AND effect.payload->>'expectedReasonSha256' ~ '^[0-9a-f]{64}$'
     AND NOT (effect.payload ? 'sensitiveValues')
     AND (
       pg_catalog.jsonb_typeof(effect.payload->'metadata') = 'object'
       OR pg_catalog.jsonb_typeof(effect.payload->'reason') = 'string'
     )
     AND (
       NOT (effect.payload ? 'metadata')
       OR (
         pg_catalog.jsonb_typeof(effect.payload->'metadata') = 'object'
         AND pg_catalog.octet_length((effect.payload->'metadata')::text) <= 1000000
       )
     )
     AND (
       NOT (effect.payload ? 'reason')
       OR (
         pg_catalog.jsonb_typeof(effect.payload->'reason') = 'string'
         AND pg_catalog.char_length(effect.payload->>'reason') <= 1000
       )
     )
     AND pg_catalog.octet_length(effect.payload::text) <= 1000000
   FOR UPDATE;
  IF NOT FOUND
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS deleted_user
        WHERE deleted_user.id = source_effect."userId"
          AND deleted_user."deletedAt" IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public."AdminAuditLog" AS deletion_audit
        WHERE deletion_audit."adminId" = source_effect."userId"
          AND deletion_audit.action = 'USER_ACCOUNT_DELETE'
          AND deletion_audit."targetType" = 'USER'
          AND deletion_audit."targetId" = source_effect."userId"
     ) THEN
    RAISE EXCEPTION 'Admin audit account-deletion redaction claim is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT audit.metadata, audit.reason::text
    INTO current_metadata, current_reason
    FROM public."AdminAuditLog" AS audit
   WHERE audit.id = p_log_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin audit account-deletion redaction target is missing'
      USING ERRCODE = '55000';
  END IF;

  current_metadata_sha256 := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(current_metadata::text, 'UTF8')
    ),
    'hex'
  );
  current_reason_sha256 := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object('reason', current_reason)::text,
        'UTF8'
      )
    ),
    'hex'
  );
  IF current_metadata_sha256 <> source_effect.payload->>'expectedMetadataSha256'
     OR current_reason_sha256 <> source_effect.payload->>'expectedReasonSha256' THEN
    RETURN false;
  END IF;

  update_metadata := source_effect.payload ? 'metadata';
  update_reason := source_effect.payload ? 'reason';
  next_metadata := source_effect.payload->'metadata';
  next_reason := source_effect.payload->>'reason';

  UPDATE public."AdminAuditLog" AS audit
     SET metadata = CASE
           WHEN update_metadata THEN next_metadata
           ELSE audit.metadata
         END,
         reason = CASE
           WHEN update_reason THEN next_reason
           ELSE audit.reason
         END
   WHERE audit.id = p_log_id;

  UPDATE public."AccountDeletionSideEffect" AS effect
     SET status = 'DONE',
         "processingStartedAt" = NULL,
         "processedAt" = source_now,
         "nextAttemptAt" = NULL,
         "lastError" = NULL,
         payload = '{}'::jsonb,
         "updatedAt" = source_now
   WHERE effect.id = p_side_effect_id
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token;

  RETURN true;
END;
$grainline_admin_audit_account_deletion_redaction_apply$;

-- Drain predecessor AUDIT_REDACT rows that may already be pending when the
-- fixed-plan application code deploys. The old payload stores the already
-- redacted metadata/reason. Bind that payload to the exact claimed row, keep
-- every undo field untouched, and refuse to overwrite a different completed
-- account-deletion redaction.
CREATE FUNCTION public.grainline_admin_audit_account_deletion_legacy_redaction_apply(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_log_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_account_deletion_legacy_redaction_apply$
DECLARE
  source_effect public."AccountDeletionSideEffect"%ROWTYPE;
  current_metadata jsonb;
  current_reason text;
  next_metadata jsonb;
  next_reason text;
  update_metadata boolean;
  update_reason boolean;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF SESSION_USER <> 'grainline_account_deletion_runtime'
     OR p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL
     OR p_log_id IS NULL
     OR p_log_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Legacy admin audit account-deletion redaction claim is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT effect.*
    INTO source_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
     AND effect.status = 'PROCESSING'
     AND effect.kind = 'AUDIT_REDACT'
     AND effect."dedupKey" = 'account-delete:audit:' || effect."userId" || ':' || p_log_id
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
     AND effect.payload->>'logId' = p_log_id
     AND NOT (effect.payload ? 'sensitiveValues')
     AND NOT (effect.payload ? 'directAccountReference')
     AND (effect.payload ? 'metadata' OR effect.payload ? 'reason')
     AND (
       NOT (effect.payload ? 'metadata')
       OR pg_catalog.octet_length((effect.payload->'metadata')::text) <= 1000000
     )
     AND (
       NOT (effect.payload ? 'reason')
       OR (
         pg_catalog.jsonb_typeof(effect.payload->'reason') = 'string'
         AND pg_catalog.char_length(effect.payload->>'reason') <= 1000
       )
     )
   FOR UPDATE;
  IF NOT FOUND
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS deleted_user
        WHERE deleted_user.id = source_effect."userId"
          AND deleted_user."deletedAt" IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public."AdminAuditLog" AS deletion_audit
        WHERE deletion_audit."adminId" = source_effect."userId"
          AND deletion_audit.action = 'USER_ACCOUNT_DELETE'
          AND deletion_audit."targetType" = 'USER'
          AND deletion_audit."targetId" = source_effect."userId"
     ) THEN
    RAISE EXCEPTION 'Legacy admin audit account-deletion redaction claim is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT audit.metadata, audit.reason::text
    INTO current_metadata, current_reason
    FROM public."AdminAuditLog" AS audit
   WHERE audit.id = p_log_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legacy admin audit account-deletion redaction target is missing'
      USING ERRCODE = '55000';
  END IF;

  update_metadata := source_effect.payload ? 'metadata';
  update_reason := source_effect.payload ? 'reason';
  next_metadata := source_effect.payload->'metadata';
  next_reason := source_effect.payload->>'reason';

  IF current_metadata->>'redactedForAccountDeletion' = 'true'
     AND (
       (update_metadata AND current_metadata IS DISTINCT FROM next_metadata)
       OR (update_reason AND current_reason IS DISTINCT FROM next_reason)
     ) THEN
    RAISE EXCEPTION 'Legacy admin audit redaction conflicts with a newer redaction'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public."AdminAuditLog" AS audit
     SET metadata = CASE
           WHEN update_metadata THEN next_metadata
           ELSE audit.metadata
         END,
         reason = CASE
           WHEN update_reason THEN next_reason
           ELSE audit.reason
         END
   WHERE audit.id = p_log_id;

  UPDATE public."AccountDeletionSideEffect" AS effect
     SET status = 'DONE',
         "processingStartedAt" = NULL,
         "processedAt" = source_now,
         "nextAttemptAt" = NULL,
         "lastError" = NULL,
         payload = '{}'::jsonb,
         "updatedAt" = source_now
   WHERE effect.id = p_side_effect_id
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token;

  RETURN true;
END;
$grainline_admin_audit_account_deletion_legacy_redaction_apply$;

CREATE FUNCTION public.grainline_admin_audit_staff_ban_rows(
  p_actor_id text,
  p_target_id text,
  p_only_active boolean,
  p_limit integer
)
RETURNS TABLE (
  id text,
  metadata jsonb,
  undone boolean,
  "createdAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_staff_ban_rows$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_id IS NULL
     OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_only_active IS NULL
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 25
     OR NOT EXISTS (
       SELECT 1 FROM public."User" AS actor
        WHERE actor.id = p_actor_id
          AND actor.role::text = 'ADMIN'
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'Admin audit ban-row context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT audit.id::text,
         audit.metadata,
         audit.undone,
         audit."createdAt"
    FROM public."AdminAuditLog" AS audit
   WHERE audit.action = 'BAN_USER'
     AND audit."targetType" = 'USER'
     AND audit."targetId" = p_target_id
     AND (NOT p_only_active OR audit.undone = false)
   ORDER BY audit."createdAt" DESC, audit.id DESC
   LIMIT p_limit;
END;
$grainline_admin_audit_staff_ban_rows$;

CREATE FUNCTION public.grainline_admin_audit_ban_repair_candidates(
  p_limit integer
)
RETURNS TABLE (
  id text,
  "targetId" text,
  metadata jsonb,
  "createdAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_ban_repair_candidates$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 100 THEN
    RAISE EXCEPTION 'Admin audit ban-repair candidate context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT audit.id::text,
         audit."targetId"::text,
         audit.metadata,
         audit."createdAt"
    FROM public."AdminAuditLog" AS audit
   WHERE audit.action = 'BAN_USER'
     AND audit."targetType" = 'USER'
     AND audit.undone = false
     AND audit."createdAt" >= (
       pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
     ) - INTERVAL '14 days'
     AND audit.metadata->>'externalSyncVersion' = '1'
   ORDER BY audit."createdAt" DESC, audit.id DESC
   LIMIT p_limit;
END;
$grainline_admin_audit_ban_repair_candidates$;

CREATE FUNCTION public.grainline_admin_audit_ban_repair_state(
  p_original_action_id text,
  p_target_id text
)
RETURNS TABLE (
  "latestSyncAction" text,
  "checkoutExpired" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_ban_repair_state$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_original_action_id IS NULL
     OR p_original_action_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_id IS NULL
     OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1 FROM public."AdminAuditLog" AS source_audit
        WHERE source_audit.id = p_original_action_id
          AND source_audit.action = 'BAN_USER'
          AND source_audit."targetType" = 'USER'
          AND source_audit."targetId" = p_target_id
          AND source_audit.undone = false
          AND source_audit.metadata->>'externalSyncVersion' = '1'
     ) THEN
    RAISE EXCEPTION 'Admin audit ban-repair source is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT (
           SELECT related.action::text
             FROM public."AdminAuditLog" AS related
            WHERE related.action IN (
                    'BAN_USER_CLERK_SYNC',
                    'BAN_USER_CLERK_SYNC_FAILED'
                  )
              AND related."targetType" = 'USER'
              AND related."targetId" = p_target_id
              AND related.metadata->>'originalActionId' = p_original_action_id
            ORDER BY related."createdAt" DESC, related.id DESC
            LIMIT 1
         ),
         EXISTS (
           SELECT 1
             FROM public."AdminAuditLog" AS related
            WHERE related.action = 'BAN_USER_CHECKOUT_SESSIONS_EXPIRED'
              AND related."targetType" = 'USER'
              AND related."targetId" = p_target_id
              AND related.metadata->>'originalActionId' = p_original_action_id
         );
END;
$grainline_admin_audit_ban_repair_state$;

CREATE FUNCTION public.grainline_admin_audit_ban_repair_append(
  p_original_action_id text,
  p_action text,
  p_target_id text,
  p_metadata jsonb
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_ban_repair_append$
DECLARE
  source_admin_id text;
  audit_id text := pg_catalog.gen_random_uuid()::text;
  stored_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_original_action_id IS NULL
     OR p_original_action_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_action NOT IN (
       'BAN_USER_CLERK_SYNC',
       'BAN_USER_CLERK_SYNC_FAILED',
       'BAN_USER_CHECKOUT_SESSIONS_EXPIRED'
     )
     OR p_target_id IS NULL
     OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR pg_catalog.jsonb_typeof(stored_metadata) <> 'object'
     OR pg_catalog.octet_length(stored_metadata::text) > 1000000 THEN
    RAISE EXCEPTION 'Admin audit ban-repair append input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT source_audit."adminId"::text
    INTO source_admin_id
    FROM public."AdminAuditLog" AS source_audit
    JOIN public."User" AS target
      ON target.id = source_audit."targetId"
   WHERE source_audit.id = p_original_action_id
     AND source_audit.action = 'BAN_USER'
     AND source_audit."targetType" = 'USER'
     AND source_audit."targetId" = p_target_id
     AND source_audit.undone = false
     AND source_audit.metadata->>'externalSyncVersion' = '1'
     AND target.banned = true
     AND target."deletedAt" IS NULL
   FOR SHARE OF source_audit, target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin audit ban-repair source is invalid'
      USING ERRCODE = '42501';
  END IF;

  stored_metadata := stored_metadata || pg_catalog.jsonb_build_object(
    'originalActionId', p_original_action_id,
    'actorKind', 'staff'
  );

  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", metadata,
    undone, "createdAt"
  )
  VALUES (
    audit_id, source_admin_id, p_action, 'USER', p_target_id,
    stored_metadata, false,
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
  );
  RETURN audit_id;
END;
$grainline_admin_audit_ban_repair_append$;

REVOKE ALL ON FUNCTION
  public.grainline_admin_audit_append(text,text,text,text,text,jsonb),
  public.grainline_admin_audit_staff_count(text,text),
  public.grainline_admin_audit_staff_page(text,text,integer,integer),
  public.grainline_admin_audit_staff_undo_source(text,text),
  public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb),
  public.grainline_admin_audit_account_deletion_candidates(text,text[],text[],text,integer),
  public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text),
  public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text),
  public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer),
  public.grainline_admin_audit_ban_repair_candidates(integer),
  public.grainline_admin_audit_ban_repair_state(text,text),
  public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)
FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime,
  grainline_account_deletion_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_admin_audit_append(text,text,text,text,text,jsonb),
  public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb)
TO grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_admin_audit_staff_count(text,text),
  public.grainline_admin_audit_staff_page(text,text,integer,integer),
  public.grainline_admin_audit_staff_undo_source(text,text),
  public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer),
  public.grainline_admin_audit_ban_repair_candidates(integer),
  public.grainline_admin_audit_ban_repair_state(text,text),
  public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)
TO grainline_staff_read_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_admin_audit_account_deletion_candidates(text,text[],text[],text,integer),
  public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text),
  public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)
TO grainline_account_deletion_runtime;

DO $grainline_admin_audit_postflight$
BEGIN
  IF NOT pg_catalog.has_function_privilege(
    'grainline_app_runtime',
    'public.grainline_admin_audit_append(text,text,text,text,text,jsonb)',
    'EXECUTE'
  )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_staff_count(text,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_staff_page(text,text,integer,integer)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_staff_undo_source(text,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_account_deletion_candidates(text,text[],text[],text,integer)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_ban_repair_candidates(integer)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_ban_repair_state(text,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_staff_count(text,text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_staff_page(text,text,integer,integer)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_staff_undo_source(text,text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_ban_repair_candidates(integer)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_ban_repair_state(text,text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_append(text,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_account_deletion_candidates(text,text[],text[],text,integer)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       'public.grainline_admin_audit_account_deletion_candidates(text,text[],text[],text,integer)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       'public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       'public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       'public.grainline_admin_audit_append(text,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       'public.grainline_admin_audit_staff_page(text,text,integer,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation function ACL drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."AdminAuditLog"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation changed RLS';
  END IF;
END;
$grainline_admin_audit_postflight$;

COMMIT;
