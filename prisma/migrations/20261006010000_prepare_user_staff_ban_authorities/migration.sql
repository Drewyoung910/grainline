CREATE OR REPLACE FUNCTION public.grainline_user_staff_directory_count(
  p_actor_id text,
  p_query text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_staff_directory_count$
DECLARE
  normalized_query text;
  result_count bigint;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'User staff directory requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User staff actor input is invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."User" AS actor
     WHERE actor.id = p_actor_id
       AND actor.role::text = 'ADMIN'
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'User staff actor is not authorized' USING ERRCODE = '42501';
  END IF;
  normalized_query := pg_catalog.btrim(COALESCE(p_query, ''));
  IF pg_catalog.char_length(normalized_query) > 200 THEN
    RAISE EXCEPTION 'User staff directory query is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*) INTO result_count
    FROM public."User" AS account_user
   WHERE normalized_query = ''
      OR account_user.email ILIKE '%' || normalized_query || '%'
      OR account_user.name ILIKE '%' || normalized_query || '%';
  RETURN result_count;
END
$grainline_user_staff_directory_count$;

CREATE OR REPLACE FUNCTION public.grainline_user_staff_directory_page(
  p_actor_id text,
  p_query text,
  p_page integer
)
RETURNS TABLE (
  id text,
  email text,
  name text,
  role public."Role",
  banned boolean,
  "bannedAt" timestamp(3),
  "banReason" text,
  "createdAt" timestamp(3),
  "sellerDisplayName" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_staff_directory_page$
DECLARE
  normalized_query text;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'User staff directory requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User staff actor input is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page > 1000 THEN
    RAISE EXCEPTION 'User staff directory page is invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."User" AS actor
     WHERE actor.id = p_actor_id
       AND actor.role::text = 'ADMIN'
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'User staff actor is not authorized' USING ERRCODE = '42501';
  END IF;
  normalized_query := pg_catalog.btrim(COALESCE(p_query, ''));
  IF pg_catalog.char_length(normalized_query) > 200 THEN
    RAISE EXCEPTION 'User staff directory query is invalid' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    account_user.id,
    account_user.email::text,
    account_user.name::text,
    account_user.role,
    account_user.banned,
    account_user."bannedAt",
    account_user."banReason"::text,
    account_user."createdAt",
    seller."displayName"::text
  FROM public."User" AS account_user
  LEFT JOIN public."SellerProfile" AS seller ON seller."userId" = account_user.id
  WHERE normalized_query = ''
     OR account_user.email ILIKE '%' || normalized_query || '%'
     OR account_user.name ILIKE '%' || normalized_query || '%'
  ORDER BY account_user."createdAt" DESC, account_user.id DESC
  OFFSET ((p_page - 1) * 30)
  LIMIT 30;
END
$grainline_user_staff_directory_page$;

CREATE OR REPLACE FUNCTION public.grainline_user_staff_exact_email_target(
  p_actor_id text,
  p_email text
)
RETURNS TABLE (id text, name text, email text)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_staff_exact_email_target$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'User staff email lookup requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_email IS NULL
     OR p_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email))
     OR pg_catalog.char_length(p_email) NOT BETWEEN 3 AND 254
     OR pg_catalog.strpos(p_email, '@') <= 1 THEN
    RAISE EXCEPTION 'User staff email target input is invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."User" AS actor
     WHERE actor.id = p_actor_id
       AND actor.role::text = 'ADMIN'
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'User staff actor is not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT account_user.id, account_user.name::text, account_user.email::text
    FROM public."User" AS account_user
   WHERE account_user.email = p_email;
END
$grainline_user_staff_exact_email_target$;

CREATE OR REPLACE FUNCTION public.grainline_user_staff_report_labels(
  p_actor_id text,
  p_user_ids text[]
)
RETURNS TABLE (id text, name text, email text, "deletedAt" timestamp(3))
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_staff_report_labels$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'User staff report labels require the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_user_ids IS NULL
     OR pg_catalog.cardinality(p_user_ids) > 5
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_user_ids) AS requested(id)
        WHERE requested.id IS NULL OR requested.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'User staff report-label input is invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."User" AS actor
     WHERE actor.id = p_actor_id
       AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'User staff actor is not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT account_user.id, account_user.name::text, account_user.email::text, account_user."deletedAt"
    FROM pg_catalog.unnest(p_user_ids) WITH ORDINALITY AS requested(id, ordinal)
    JOIN public."User" AS account_user ON account_user.id = requested.id
   ORDER BY requested.ordinal;
END
$grainline_user_staff_report_labels$;

CREATE OR REPLACE FUNCTION public.grainline_user_staff_email_recipient(
  p_actor_id text,
  p_user_id text,
  p_email text
)
RETURNS TABLE (id text, email text, name text, banned boolean, "deletedAt" timestamp(3))
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_staff_email_recipient$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'User staff recipient lookup requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR ((p_user_id IS NULL) = (p_email IS NULL))
     OR (p_user_id IS NOT NULL AND p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR (p_email IS NOT NULL AND (
       p_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email))
       OR pg_catalog.char_length(p_email) NOT BETWEEN 3 AND 254
       OR pg_catalog.strpos(p_email, '@') <= 1
     )) THEN
    RAISE EXCEPTION 'User staff recipient input is invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."User" AS actor
     WHERE actor.id = p_actor_id
       AND actor.role::text = 'ADMIN'
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'User staff actor is not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT account_user.id, account_user.email::text, account_user.name::text,
         account_user.banned, account_user."deletedAt"
    FROM public."User" AS account_user
   WHERE (p_user_id IS NOT NULL AND account_user.id = p_user_id)
      OR (p_email IS NOT NULL AND account_user.email = p_email);
END
$grainline_user_staff_email_recipient$;

CREATE OR REPLACE FUNCTION public.grainline_user_staff_ban_target(
  p_actor_id text,
  p_target_id text
)
RETURNS TABLE (
  role public."Role",
  "deletedAt" timestamp(3),
  banned boolean,
  "bannedAt" timestamp(3),
  "clerkId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_staff_ban_target$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'User staff ban review requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_id IS NULL OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User staff ban target input is invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."User" AS actor
     WHERE actor.id = p_actor_id
       AND actor.role::text = 'ADMIN'
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'User staff actor is not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT target.role, target."deletedAt", target.banned, target."bannedAt", target."clerkId"::text
    FROM public."User" AS target
   WHERE target.id = p_target_id;
END
$grainline_user_staff_ban_target$;

ALTER TABLE public."OrderStaffCapability"
  DROP CONSTRAINT "OrderStaffCapability_operation_check";
ALTER TABLE public."OrderStaffCapability"
  ADD CONSTRAINT "OrderStaffCapability_operation_check"
  CHECK (operation IN (
    'BAN_REVIEW_FLAG',
    'BAN_REVIEW_RESTORE',
    'USER_BAN',
    'USER_UNBAN'
  ));
ALTER TABLE public."OrderStaffCapability"
  DROP CONSTRAINT "OrderStaffCapability_payload_check";
ALTER TABLE public."OrderStaffCapability"
  ADD CONSTRAINT "OrderStaffCapability_payload_check"
  CHECK (
    (operation IN ('BAN_REVIEW_FLAG', 'USER_BAN') AND "payloadHash" IS NULL)
    OR
    (operation IN ('BAN_REVIEW_RESTORE', 'USER_UNBAN') AND "payloadHash" ~ '^[a-f0-9]{64}$')
  );

CREATE OR REPLACE FUNCTION public.grainline_user_staff_capability_mint(
  p_actor_id text,
  p_target_id text,
  p_operation text,
  p_expected_banned_at timestamp(3)
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_staff_capability_mint$
DECLARE
  capability_id text;
  payload_hash text;
  target_role text;
  target_banned boolean;
  target_banned_at timestamp(3);
  target_deleted_at timestamp(3);
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'User staff capability requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_id IS NULL OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_actor_id = p_target_id
     OR p_operation NOT IN ('USER_BAN', 'USER_UNBAN')
     OR (p_operation = 'USER_BAN' AND p_expected_banned_at IS NOT NULL) THEN
    RAISE EXCEPTION 'User staff capability input is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public."User" AS actor
   WHERE actor.id = p_actor_id AND actor.role::text = 'ADMIN'
     AND actor.banned = false AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User staff actor is not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT target.role::text, target.banned, target."bannedAt", target."deletedAt"
    INTO target_role, target_banned, target_banned_at, target_deleted_at
    FROM public."User" AS target WHERE target.id = p_target_id FOR SHARE;
  IF NOT FOUND OR target_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  ELSIF target_role = 'ADMIN' THEN
    RAISE EXCEPTION 'Cannot change admin ban state' USING ERRCODE = '42501';
  ELSIF p_operation = 'USER_BAN' AND target_banned THEN
    RAISE EXCEPTION 'User ban state changed' USING ERRCODE = '40001';
  ELSIF p_operation = 'USER_UNBAN'
        AND (NOT target_banned OR target_banned_at IS DISTINCT FROM p_expected_banned_at) THEN
    RAISE EXCEPTION 'User ban state changed' USING ERRCODE = '40001';
  END IF;

  payload_hash := CASE WHEN p_operation = 'USER_BAN' THEN NULL ELSE
    pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(
        COALESCE(pg_catalog.to_char(
          p_expected_banned_at,
          'YYYY-MM-DD"T"HH24:MI:SS.MS'
        ), '<NULL>'),
        'UTF8'
      )),
      'hex'
    )
  END;

  DELETE FROM public."OrderStaffCapability"
   WHERE "expiresAt" < pg_catalog.clock_timestamp();
  INSERT INTO public."OrderStaffCapability" (
    "actorUserId", "targetUserId", operation, "payloadHash", "expiresAt"
  ) VALUES (
    p_actor_id,
    p_target_id,
    p_operation,
    payload_hash,
    pg_catalog.clock_timestamp() + INTERVAL '5 minutes'
  )
  RETURNING id INTO capability_id;
  RETURN capability_id;
END
$grainline_user_staff_capability_mint$;

CREATE OR REPLACE FUNCTION public.grainline_user_staff_ban_apply(
  p_capability_id text,
  p_target_id text,
  p_banned_at timestamp(3),
  p_reason text
)
RETURNS TABLE ("clerkId" text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_staff_ban_apply$
DECLARE
  source_actor_id text;
  target_clerk_id text;
  target_role text;
  target_banned boolean;
  target_deleted_at timestamp(3);
BEGIN
  IF p_capability_id IS NULL
     OR p_capability_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR p_target_id IS NULL OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_banned_at IS NULL
     OR p_reason IS NULL OR pg_catalog.char_length(p_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'User staff ban input is invalid' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public."OrderStaffCapability" AS capability
   WHERE capability.id = p_capability_id
     AND capability."targetUserId" = p_target_id
     AND capability.operation = 'USER_BAN'
     AND capability."payloadHash" IS NULL
     AND capability."expiresAt" >= pg_catalog.clock_timestamp()
  RETURNING capability."actorUserId" INTO source_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User ban capability is invalid or expired' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public."User" AS actor
   WHERE actor.id = source_actor_id AND actor.role::text = 'ADMIN'
     AND actor.banned = false AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User staff actor is not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT target."clerkId", target.role::text, target.banned, target."deletedAt"
    INTO target_clerk_id, target_role, target_banned, target_deleted_at
    FROM public."User" AS target WHERE target.id = p_target_id FOR UPDATE;
  IF NOT FOUND OR target_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  ELSIF target_role = 'ADMIN' THEN
    RAISE EXCEPTION 'Cannot ban admin accounts' USING ERRCODE = '42501';
  ELSIF target_banned THEN
    RAISE EXCEPTION 'User ban state changed' USING ERRCODE = '40001';
  END IF;
  UPDATE public."User" AS target
     SET banned = true, "bannedAt" = p_banned_at, "banReason" = p_reason,
         "bannedBy" = source_actor_id,
         "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
   WHERE target.id = p_target_id;
  RETURN QUERY SELECT target_clerk_id;
END
$grainline_user_staff_ban_apply$;

CREATE OR REPLACE FUNCTION public.grainline_user_staff_unban_apply(
  p_capability_id text,
  p_target_id text,
  p_expected_banned_at timestamp(3)
)
RETURNS TABLE (
  "clerkId" text,
  banned boolean,
  "bannedAt" timestamp(3),
  "banReason" text,
  "bannedBy" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_staff_unban_apply$
DECLARE
  expected_payload_hash text;
  source_actor_id text;
  prior_clerk_id text;
  prior_role text;
  prior_banned boolean;
  prior_banned_at timestamp(3);
  prior_ban_reason text;
  prior_banned_by text;
  prior_deleted_at timestamp(3);
BEGIN
  IF p_capability_id IS NULL
     OR p_capability_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR p_target_id IS NULL OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User staff unban input is invalid' USING ERRCODE = '22023';
  END IF;
  expected_payload_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(
      COALESCE(pg_catalog.to_char(
        p_expected_banned_at,
        'YYYY-MM-DD"T"HH24:MI:SS.MS'
      ), '<NULL>'),
      'UTF8'
    )),
    'hex'
  );
  DELETE FROM public."OrderStaffCapability" AS capability
   WHERE capability.id = p_capability_id
     AND capability."targetUserId" = p_target_id
     AND capability.operation = 'USER_UNBAN'
     AND capability."payloadHash" = expected_payload_hash
     AND capability."expiresAt" >= pg_catalog.clock_timestamp()
  RETURNING capability."actorUserId" INTO source_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User unban capability is invalid or expired' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public."User" AS actor
   WHERE actor.id = source_actor_id AND actor.role::text = 'ADMIN'
     AND actor.banned = false AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User staff actor is not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT target."clerkId", target.role::text, target.banned, target."bannedAt",
         target."banReason", target."bannedBy", target."deletedAt"
    INTO prior_clerk_id, prior_role, prior_banned, prior_banned_at,
         prior_ban_reason, prior_banned_by, prior_deleted_at
    FROM public."User" AS target WHERE target.id = p_target_id FOR UPDATE;
  IF NOT FOUND OR prior_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  ELSIF prior_role = 'ADMIN' THEN
    RAISE EXCEPTION 'Cannot unban admin accounts' USING ERRCODE = '42501';
  ELSIF NOT prior_banned OR prior_banned_at IS DISTINCT FROM p_expected_banned_at THEN
    RAISE EXCEPTION 'User ban state changed' USING ERRCODE = '40001';
  END IF;
  UPDATE public."User" AS target
     SET banned = false, "bannedAt" = NULL, "banReason" = NULL, "bannedBy" = NULL,
         "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
   WHERE target.id = p_target_id;
  RETURN QUERY SELECT prior_clerk_id, prior_banned, prior_banned_at,
                      prior_ban_reason, prior_banned_by;
END
$grainline_user_staff_unban_apply$;

CREATE OR REPLACE FUNCTION public.grainline_user_ban_repair_target(
  p_original_action_id text,
  p_target_id text
)
RETURNS TABLE (
  "clerkId" text,
  banned boolean,
  "deletedAt" timestamp(3),
  "sellerProfileId" text,
  "stripeAccountId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_ban_repair_target$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'User ban repair requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_original_action_id IS NULL OR p_original_action_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_id IS NULL OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User ban repair target input is invalid' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT target."clerkId"::text, target.banned, target."deletedAt",
         seller.id, seller."stripeAccountId"::text
    FROM public."User" AS target
    LEFT JOIN public."SellerProfile" AS seller ON seller."userId" = target.id
   WHERE target.id = p_target_id
     AND target.banned = true
     AND target."deletedAt" IS NULL
     AND EXISTS (
       SELECT 1
         FROM public."AdminAuditLog" AS audit
        WHERE audit.id = p_original_action_id
          AND audit.action = 'BAN_USER'
          AND audit."targetType" = 'USER'
          AND audit."targetId" = p_target_id
          AND audit.undone = false
          AND audit.metadata->>'externalSyncVersion' = '1'
          AND audit.metadata->>'appliedBannedAt' = pg_catalog.to_char(
            target."bannedAt",
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
     );
END
$grainline_user_ban_repair_target$;

REVOKE ALL ON FUNCTION public.grainline_user_staff_directory_count(text, text) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_staff_directory_page(text, text, integer) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_staff_exact_email_target(text, text) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_staff_report_labels(text, text[]) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_staff_email_recipient(text, text, text) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_staff_ban_target(text, text) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_staff_capability_mint(text, text, text, timestamp without time zone) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_staff_ban_apply(text, text, timestamp without time zone, text) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_staff_unban_apply(text, text, timestamp without time zone) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_ban_repair_target(text, text) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_user_staff_directory_count(text, text) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_staff_directory_page(text, text, integer) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_staff_exact_email_target(text, text) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_staff_report_labels(text, text[]) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_staff_email_recipient(text, text, text) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_staff_ban_target(text, text) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_staff_capability_mint(text, text, text, timestamp without time zone) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_ban_repair_target(text, text) TO grainline_staff_read_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_user_staff_ban_apply(text, text, timestamp without time zone, text) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_staff_unban_apply(text, text, timestamp without time zone) TO grainline_app_runtime;
