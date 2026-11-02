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
       pg_catalog.to_regprocedure('public.grainline_admin_audit_staff_page(text,text,integer,integer)')
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
         actor.banned = false AND actor."deletedAt" IS NULL
    INTO actor_role, actor_active
    FROM public."User" AS actor
   WHERE actor.id = actor_id
   FOR SHARE;
  IF NOT FOUND OR NOT actor_active THEN
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

    WHEN 'BAN_USER',
         'UNBAN_USER',
         'BAN_USER_CLERK_SYNC',
         'BAN_USER_CLERK_SYNC_FAILED',
         'BAN_USER_CHECKOUT_SESSIONS_EXPIRED',
         'UNBAN_USER_CLERK_SYNC',
         'UNBAN_USER_CLERK_SYNC_FAILED',
         'UNDO_BAN_USER_CLERK_SYNC',
         'UNDO_BAN_USER_CLERK_SYNC_FAILED' THEN
      IF actor_role <> 'ADMIN'
         OR p_target_type <> 'USER'
         OR p_target_id = actor_id
         OR NOT EXISTS (
           SELECT 1 FROM public."User" AS target
            WHERE target.id = p_target_id
         ) THEN
        RAISE EXCEPTION 'Admin audit account action actor or target is invalid'
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

REVOKE ALL ON FUNCTION
  public.grainline_admin_audit_append(text,text,text,text,text,jsonb),
  public.grainline_admin_audit_staff_count(text,text),
  public.grainline_admin_audit_staff_page(text,text,integer,integer)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.grainline_admin_audit_append(text,text,text,text,text,jsonb)
TO grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_admin_audit_staff_count(text,text),
  public.grainline_admin_audit_staff_page(text,text,integer,integer)
TO grainline_staff_read_runtime;

DO $grainline_admin_audit_postflight$
BEGIN
  IF NOT pg_catalog.has_function_privilege(
    'grainline_app_runtime',
    'public.grainline_admin_audit_append(text,text,text,text,text,jsonb)',
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
     OR pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime',
       'public.grainline_admin_audit_append(text,text,text,text,text,jsonb)',
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
