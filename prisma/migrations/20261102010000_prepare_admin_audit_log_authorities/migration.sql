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
       pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_ban_repair_candidates(integer)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_ban_repair_state(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb)'),
       pg_catalog.to_regprocedure('public.grainline_admin_audit_redact_deleted_references(jsonb)')
     )
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation function already exists';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.grainline_admin_audit_insert_write_fence()'
     ) IS NOT NULL
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger
        WHERE trigger.tgrelid = 'public."AdminAuditLog"'::pg_catalog.regclass
          AND trigger.tgname = 'AdminAuditLog_insert_write_fence'
          AND NOT trigger.tgisinternal
     ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation write fence already exists';
  END IF;

  IF pg_catalog.to_regprocedure(
       'public.grainline_account_deletion_claim_user(text,bigint,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'AdminAuditLog preparation requires the account-deletion claim fence';
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

-- Replace exact deleted-account ids in newly-written JSON evidence without
-- changing keys, array order, booleans, numbers, or unrelated text. Stable
-- adminId references remain intact because the column is a required FK and is
-- retained audit provenance; all free-form locations are redacted before the
-- row becomes visible.
CREATE FUNCTION public.grainline_admin_audit_redact_deleted_references(
  p_value jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_redact_deleted_references$
DECLARE
  value_type text;
  result jsonb;
  item record;
  changed boolean := false;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  value_type := pg_catalog.jsonb_typeof(p_value);
  IF value_type = 'string' THEN
    IF EXISTS (
      SELECT 1
        FROM public."User" AS deleted_user
       WHERE deleted_user.id = p_value #>> '{}'
         AND deleted_user."deletedAt" IS NOT NULL
    ) THEN
      RETURN pg_catalog.to_jsonb('[deleted account]'::text);
    END IF;
    RETURN p_value;
  END IF;

  IF value_type = 'array' THEN
    result := '[]'::jsonb;
    FOR item IN
      SELECT element.value, element.ordinality
        FROM pg_catalog.jsonb_array_elements(p_value)
          WITH ORDINALITY AS element(value, ordinality)
       ORDER BY element.ordinality
    LOOP
      result := result || pg_catalog.jsonb_build_array(
        public.grainline_admin_audit_redact_deleted_references(item.value)
      );
    END LOOP;
    RETURN result;
  END IF;

  IF value_type = 'object' THEN
    result := '{}'::jsonb;
    FOR item IN
      SELECT entry.key, entry.value
        FROM pg_catalog.jsonb_each(p_value) AS entry(key, value)
       ORDER BY entry.key
    LOOP
      DECLARE
        redacted_value jsonb :=
          public.grainline_admin_audit_redact_deleted_references(item.value);
      BEGIN
        changed := changed OR redacted_value IS DISTINCT FROM item.value;
        result := result || pg_catalog.jsonb_build_object(item.key, redacted_value);
      END;
    END LOOP;
    IF changed THEN
      result := result || pg_catalog.jsonb_build_object(
        'redactedForAccountDeletion', true
      );
    END IF;
    RETURN result;
  END IF;

  RETURN p_value;
END;
$grainline_admin_audit_redact_deleted_references$;

REVOKE ALL ON FUNCTION
  public.grainline_admin_audit_redact_deleted_references(jsonb)
FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime,
  grainline_account_deletion_runtime;

-- Every AdminAuditLog producer, including retained domain functions and the
-- predecessor direct-table path, crosses one transaction-scoped write fence.
-- Account deletion acquires the same fence before it locks account/domain
-- rows. A producer that was already in flight commits before the deletion scan;
-- a later producer waits and has deleted-user references redacted before the
-- row is retained, without blocking recovery or moderation work.
CREATE FUNCTION public.grainline_admin_audit_insert_write_fence()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_insert_write_fence$
BEGIN
  -- Ordinary writers share the fence so unrelated audit actions remain
  -- concurrent. Account deletion takes the matching exclusive lock.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(11240001, 20261102);

  IF EXISTS (
    SELECT 1
      FROM public."User" AS deleted_user
     WHERE deleted_user.id = NEW."targetId"
       AND deleted_user."deletedAt" IS NOT NULL
  ) THEN
    NEW."targetId" := '[deleted account]';
  END IF;

  NEW.metadata := public.grainline_admin_audit_redact_deleted_references(
    COALESCE(NEW.metadata, '{}'::jsonb)
  );

  IF EXISTS (
    SELECT 1
      FROM public."User" AS deleted_admin
     WHERE deleted_admin.id = NEW."adminId"
       AND deleted_admin."deletedAt" IS NOT NULL
  ) THEN
    NEW.metadata := NEW.metadata || pg_catalog.jsonb_build_object(
      'adminAccountDeleted', true,
      'redactedForAccountDeletion', true
    );
  END IF;

  RETURN NEW;
END;
$grainline_admin_audit_insert_write_fence$;

REVOKE ALL ON FUNCTION public.grainline_admin_audit_insert_write_fence()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime,
       grainline_account_deletion_runtime;

CREATE TRIGGER "AdminAuditLog_insert_write_fence"
BEFORE INSERT ON public."AdminAuditLog"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_admin_audit_insert_write_fence();

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

CREATE FUNCTION public.grainline_admin_audit_account_deletion_write_fence(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_account_deletion_write_fence$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  claimed_user_id text;
BEGIN
  IF SESSION_USER <> 'grainline_app_runtime'
     OR p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Admin audit account-deletion write-fence context is invalid'
      USING ERRCODE = '42501';
  END IF;

  -- This must be the first domain authority called by the deletion
  -- transaction. All audit inserts take the same key in the table trigger.
  PERFORM pg_catalog.pg_advisory_xact_lock(11240001, 20261102);

  claimed_user_id := public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );
  IF actor_id IS NULL OR actor_id <> claimed_user_id THEN
    RAISE EXCEPTION 'Admin audit account-deletion write-fence actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN claimed_user_id;
END;
$grainline_admin_audit_account_deletion_write_fence$;

CREATE FUNCTION public.grainline_admin_audit_account_deletion_candidates(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
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
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_account_deletion_candidates$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  claimed_user_id text;
BEGIN
  IF SESSION_USER <> 'grainline_app_runtime'
     OR p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL
     OR p_target_ids IS NULL
     OR pg_catalog.cardinality(p_target_ids) NOT BETWEEN 1 AND 16
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_target_ids) AS value
        WHERE value IS NULL OR pg_catalog.char_length(value) NOT BETWEEN 1 AND 255
     )
     OR p_reference_values IS NULL
     OR pg_catalog.cardinality(p_reference_values) NOT BETWEEN 1 AND 16
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_reference_values) AS value
        WHERE value IS NULL OR pg_catalog.char_length(value) NOT BETWEEN 1 AND 255
     )
     OR (p_after_id IS NOT NULL AND p_after_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 500 THEN
    RAISE EXCEPTION 'Admin audit account-deletion candidate context is invalid'
      USING ERRCODE = '42501';
  END IF;

  claimed_user_id := public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );
  IF actor_id IS NULL
     OR actor_id <> claimed_user_id
     OR NOT (claimed_user_id = ANY(p_target_ids))
     OR NOT (claimed_user_id = ANY(p_reference_values)) THEN
    RAISE EXCEPTION 'Admin audit account-deletion candidate actor is invalid'
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
       audit."adminId" = claimed_user_id
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

CREATE FUNCTION public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_target_ids text[],
  p_reference_values text[],
  p_plans jsonb
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_admin_audit_account_deletion_redaction_plans_enqueue$
DECLARE
  actor_id text := NULLIF(pg_catalog.current_setting('app.user_id', true), '');
  claimed_user_id text;
  plan_count integer;
  distinct_plan_count integer;
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  IF SESSION_USER <> 'grainline_app_runtime'
     OR p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL
     OR p_target_ids IS NULL
     OR pg_catalog.cardinality(p_target_ids) NOT BETWEEN 1 AND 16
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_target_ids) AS value
        WHERE value IS NULL OR pg_catalog.char_length(value) NOT BETWEEN 1 AND 255
     )
     OR p_reference_values IS NULL
     OR pg_catalog.cardinality(p_reference_values) NOT BETWEEN 1 AND 16
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_reference_values) AS value
        WHERE value IS NULL OR pg_catalog.char_length(value) NOT BETWEEN 1 AND 255
     )
     OR p_plans IS NULL
     OR pg_catalog.jsonb_typeof(p_plans) <> 'array'
     OR pg_catalog.jsonb_array_length(p_plans) NOT BETWEEN 1 AND 16
     OR pg_catalog.octet_length(p_plans::text) > 16000000 THEN
    RAISE EXCEPTION 'Admin audit account-deletion redaction plans are invalid'
      USING ERRCODE = '22023';
  END IF;

  claimed_user_id := public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );
  IF actor_id IS NULL
     OR actor_id <> claimed_user_id
     OR NOT (claimed_user_id = ANY(p_target_ids))
     OR NOT (claimed_user_id = ANY(p_reference_values)) THEN
    RAISE EXCEPTION 'Admin audit account-deletion redaction-plan actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_plans) AS supplied(plan)
     WHERE pg_catalog.jsonb_typeof(supplied.plan) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Admin audit account-deletion redaction plan must be an object'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_plans) AS supplied(plan)
      CROSS JOIN LATERAL pg_catalog.jsonb_object_keys(supplied.plan) AS field(key)
     WHERE field.key NOT IN (
       'logId', 'planVersion', 'expectedMetadataSha256',
       'expectedReasonSha256', 'metadataPatches', 'reasonPatches'
     )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_plans) AS supplied(plan)
     WHERE supplied.plan->>'logId' !~ '^[A-Za-z0-9._:-]{1,191}$'
        OR pg_catalog.jsonb_typeof(supplied.plan->'planVersion') <> 'number'
        OR supplied.plan->>'planVersion' <> '3'
        OR supplied.plan->>'expectedMetadataSha256' !~ '^[0-9a-f]{64}$'
        OR supplied.plan->>'expectedReasonSha256' !~ '^[0-9a-f]{64}$'
        OR (
          NOT (supplied.plan ? 'metadataPatches')
          AND NOT (supplied.plan ? 'reasonPatches')
        )
        OR (
          supplied.plan ? 'metadataPatches'
          AND (
            pg_catalog.jsonb_typeof(supplied.plan->'metadataPatches') <> 'array'
            OR pg_catalog.jsonb_array_length(supplied.plan->'metadataPatches')
                 NOT BETWEEN 1 AND 1024
          )
        )
        OR (
          supplied.plan ? 'reasonPatches'
          AND (
            pg_catalog.jsonb_typeof(supplied.plan->'reasonPatches') <> 'array'
            OR pg_catalog.jsonb_array_length(supplied.plan->'reasonPatches')
                 NOT BETWEEN 1 AND 128
          )
        )
        OR pg_catalog.octet_length(supplied.plan::text) > 1000000
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_plans) AS supplied(plan)
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
        COALESCE(supplied.plan->'metadataPatches', '[]'::jsonb)
      ) AS patch(value)
     WHERE pg_catalog.jsonb_typeof(patch.value) <> 'object'
        OR NOT (patch.value ? 'path')
        OR NOT (patch.value ? 'value')
        OR pg_catalog.jsonb_typeof(patch.value->'path') <> 'array'
        OR pg_catalog.jsonb_array_length(patch.value->'path') > 32
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.jsonb_array_elements(patch.value->'path') AS part(value)
           WHERE pg_catalog.jsonb_typeof(part.value) <> 'string'
              OR pg_catalog.char_length(part.value #>> '{}') NOT BETWEEN 1 AND 255
        )
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.jsonb_object_keys(patch.value) AS patch_field(key)
           WHERE patch_field.key NOT IN ('path', 'value')
        )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_plans) AS supplied(plan)
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
        COALESCE(supplied.plan->'reasonPatches', '[]'::jsonb)
      ) AS patch(value)
     WHERE pg_catalog.jsonb_typeof(patch.value) <> 'object'
        OR patch.value->>'expectedSha256' !~ '^[0-9a-f]{64}$'
        OR pg_catalog.jsonb_typeof(patch.value->'length') <> 'number'
        OR (patch.value->>'length')::integer NOT BETWEEN 1 AND 1000
        OR pg_catalog.jsonb_typeof(patch.value->'replacement') <> 'string'
        OR pg_catalog.char_length(patch.value->>'replacement') NOT BETWEEN 1 AND 1000
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.jsonb_object_keys(patch.value) AS patch_field(key)
           WHERE patch_field.key NOT IN ('expectedSha256', 'length', 'replacement')
        )
  ) THEN
    RAISE EXCEPTION 'Admin audit account-deletion redaction plan shape is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(DISTINCT supplied.plan->>'logId')::integer
    INTO plan_count, distinct_plan_count
    FROM pg_catalog.jsonb_array_elements(p_plans) AS supplied(plan);
  IF plan_count <> distinct_plan_count THEN
    RAISE EXCEPTION 'Admin audit account-deletion redaction plan ids are duplicated'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_plans) AS supplied(plan)
      LEFT JOIN public."AdminAuditLog" AS audit
        ON audit.id = supplied.plan->>'logId'
     WHERE audit.id IS NULL
        OR NOT (
          audit."adminId" = claimed_user_id
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
        OR supplied.plan->>'expectedMetadataSha256' <> pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(audit.metadata::text, 'UTF8')),
          'hex'
        )
        OR supplied.plan->>'expectedReasonSha256' <> pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to(
              pg_catalog.jsonb_build_object('reason', audit.reason)::text,
              'UTF8'
            )
          ),
          'hex'
        )
  ) THEN
    RAISE EXCEPTION 'Admin audit account-deletion redaction plan source changed'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public."AccountDeletionSideEffect" (
    id, "userId", kind, "dedupKey", payload, status, attempts,
    "claimGeneration", "createdAt", "updatedAt"
  )
  SELECT pg_catalog.gen_random_uuid()::text,
         claimed_user_id,
         'AUDIT_REDACT',
         'account-delete:audit:' || claimed_user_id || ':' ||
           (supplied.plan->>'logId'),
         supplied.plan,
         'PENDING',
         0,
         0,
         source_now,
         source_now
    FROM pg_catalog.jsonb_array_elements(p_plans) AS supplied(plan)
  ON CONFLICT ("dedupKey") DO NOTHING;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_plans) AS supplied(plan)
      LEFT JOIN public."AccountDeletionSideEffect" AS effect
        ON effect."dedupKey" =
          'account-delete:audit:' || claimed_user_id || ':' ||
            (supplied.plan->>'logId')
     WHERE effect.id IS NULL
        OR effect."userId" <> claimed_user_id
        OR effect.kind <> 'AUDIT_REDACT'
        OR effect.payload IS DISTINCT FROM supplied.plan
  ) THEN
    RAISE EXCEPTION 'Admin audit account-deletion redaction plan was not retained'
      USING ERRCODE = '55000';
  END IF;

  RETURN plan_count;
END;
$grainline_admin_audit_account_deletion_redaction_plans_enqueue$;

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
  next_metadata jsonb;
  next_reason text;
  update_metadata boolean;
  update_reason boolean;
  patch record;
  patch_path text[];
  reason_patch record;
  search_position integer;
  patch_length integer;
  patch_replacement text;
  candidate_segment text;
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
     AND effect.payload->>'planVersion' = '3'
     AND effect.payload->>'expectedMetadataSha256' ~ '^[0-9a-f]{64}$'
     AND effect.payload->>'expectedReasonSha256' ~ '^[0-9a-f]{64}$'
     AND NOT (effect.payload ? 'sensitiveValues')
     AND (
       pg_catalog.jsonb_typeof(effect.payload->'metadataPatches') = 'array'
       OR pg_catalog.jsonb_typeof(effect.payload->'reasonPatches') = 'array'
     )
     AND (
       NOT (effect.payload ? 'metadataPatches')
       OR (
         pg_catalog.jsonb_typeof(effect.payload->'metadataPatches') = 'array'
         AND pg_catalog.jsonb_array_length(effect.payload->'metadataPatches')
               BETWEEN 1 AND 1024
         AND pg_catalog.octet_length(
           (effect.payload->'metadataPatches')::text
         ) <= 1000000
       )
     )
     AND (
       NOT (effect.payload ? 'reasonPatches')
       OR (
         pg_catalog.jsonb_typeof(effect.payload->'reasonPatches') = 'array'
         AND pg_catalog.jsonb_array_length(effect.payload->'reasonPatches')
               BETWEEN 1 AND 128
         AND pg_catalog.octet_length(
           (effect.payload->'reasonPatches')::text
         ) <= 1000000
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

  update_metadata := source_effect.payload ? 'metadataPatches';
  update_reason := source_effect.payload ? 'reasonPatches';

  -- Metadata plans are monotonic path edits. Apply them to the current row so
  -- a completed redaction for another account is never restored by an older
  -- whole-row snapshot. Reason patches carry only a hash and character count
  -- for the sensitive fragment, so they can rebase without retaining PII.

  next_metadata := current_metadata;
  IF update_metadata THEN
    FOR patch IN
      SELECT supplied.value
        FROM pg_catalog.jsonb_array_elements(
          source_effect.payload->'metadataPatches'
        ) WITH ORDINALITY AS supplied(value, ordinality)
       ORDER BY supplied.ordinality
    LOOP
      SELECT COALESCE(pg_catalog.array_agg(path_part.value #>> '{}' ORDER BY path_part.ordinality), ARRAY[]::text[])
        INTO patch_path
        FROM pg_catalog.jsonb_array_elements(patch.value->'path')
          WITH ORDINALITY AS path_part(value, ordinality);
      IF pg_catalog.cardinality(patch_path) = 0 THEN
        next_metadata := patch.value->'value';
      ELSE
        next_metadata := pg_catalog.jsonb_set(
          next_metadata,
          patch_path,
          patch.value->'value',
          true
        );
      END IF;
    END LOOP;
  END IF;
  next_reason := current_reason;
  IF update_reason AND next_reason IS NOT NULL THEN
    FOR reason_patch IN
      SELECT supplied.value
        FROM pg_catalog.jsonb_array_elements(
          source_effect.payload->'reasonPatches'
        ) WITH ORDINALITY AS supplied(value, ordinality)
       ORDER BY supplied.ordinality
    LOOP
      patch_length := (reason_patch.value->>'length')::integer;
      patch_replacement := reason_patch.value->>'replacement';
      search_position := 1;
      WHILE search_position <= pg_catalog.char_length(next_reason) - patch_length + 1 LOOP
        candidate_segment := pg_catalog.substring(
          next_reason,
          search_position,
          patch_length
        );
        IF pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(candidate_segment, 'UTF8')),
          'hex'
        ) = reason_patch.value->>'expectedSha256' THEN
          next_reason := pg_catalog.overlay(
            next_reason,
            patch_replacement,
            search_position,
            patch_length
          );
          search_position := search_position + pg_catalog.char_length(patch_replacement);
        ELSE
          search_position := search_position + 1;
        END IF;
      END LOOP;
    END LOOP;
    next_reason := pg_catalog.substring(next_reason, 1, 1000);
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
  public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid),
  public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer),
  public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb),
  public.grainline_admin_audit_account_deletion_redaction_apply(text,bigint,uuid,text),
  public.grainline_admin_audit_account_deletion_legacy_redaction_apply(text,bigint,uuid,text),
  public.grainline_admin_audit_staff_ban_rows(text,text,boolean,integer),
  public.grainline_admin_audit_ban_repair_candidates(integer),
  public.grainline_admin_audit_ban_repair_state(text,text),
  public.grainline_admin_audit_ban_repair_append(text,text,text,jsonb),
  public.grainline_admin_audit_redact_deleted_references(jsonb)
FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime,
  grainline_account_deletion_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_admin_audit_append(text,text,text,text,text,jsonb),
  public.grainline_admin_audit_undo_claim(text,text,text,text,text,text,text,jsonb),
  public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid),
  public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer),
  public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb)
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
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb)',
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
       'public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb)',
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
     OR pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       'public.grainline_admin_audit_account_deletion_write_fence(text,bigint,uuid)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       'public.grainline_admin_audit_account_deletion_candidates(text,bigint,uuid,text[],text[],text,integer)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'grainline_account_deletion_runtime',
       'public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(text,bigint,uuid,text[],text[],jsonb)',
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

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = trigger.tgfoid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE trigger.tgrelid = 'public."AdminAuditLog"'::pg_catalog.regclass
       AND trigger.tgname = 'AdminAuditLog_insert_write_fence'
       AND trigger.tgenabled = 'O'
       AND trigger.tgtype = 7
       AND NOT trigger.tgisinternal
       AND namespace.nspname = 'public'
       AND procedure.proname = 'grainline_admin_audit_insert_write_fence'
       AND procedure.prosecdef
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
  ) THEN
    RAISE EXCEPTION 'AdminAuditLog preparation write fence drifted';
  END IF;
END;
$grainline_admin_audit_postflight$;

COMMIT;
