-- Preparation-only Bucket B service-authority draft. Deliberately outside
-- prisma/migrations and barred from Vercel deployment until SavedSearch Phase B
-- plus runtime credential separation pass production postflight.
--
-- Every function is intentionally narrow. The migration owner remains the
-- SECURITY DEFINER owner; grainline_app_runtime receives EXECUTE only and must
-- never receive direct Notification INSERT or DELETE privileges.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_notification_create(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
  p_title text,
  p_body text,
  p_link text,
  p_source_type text,
  p_source_id text,
  p_related_user_id text,
  p_dedup_key text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_create$
DECLARE
  recipient_preferences jsonb;
  notification_id text;
BEGIN
  IF p_notification_id IS NULL
     OR p_notification_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'notification id is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191 THEN
    RAISE EXCEPTION 'notification recipient is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR p_title = '' OR pg_catalog.char_length(p_title) > 200 THEN
    RAISE EXCEPTION 'notification title is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_body IS NULL OR pg_catalog.char_length(p_body) > 1000 THEN
    RAISE EXCEPTION 'notification body is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_link IS NOT NULL AND (
    p_link = ''
    OR pg_catalog.char_length(p_link) > 2048
    OR pg_catalog.left(p_link, 1) <> '/'
    OR pg_catalog.left(p_link, 2) = '//'
  ) THEN
    RAISE EXCEPTION 'notification link is invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_source_type IS NULL) <> (p_source_id IS NULL) THEN
    RAISE EXCEPTION 'notification source metadata must be paired' USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS NOT NULL AND (
    p_source_type NOT IN (
      'blog_comment',
      'followed_maker_new_blog',
      'followed_maker_new_listing',
      'seller_broadcast'
    )
    OR pg_catalog.char_length(p_source_type) > 80
    OR p_source_id = ''
    OR pg_catalog.char_length(p_source_id) > 191
  ) THEN
    RAISE EXCEPTION 'notification source metadata is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_related_user_id IS NOT NULL AND (
    p_related_user_id = '' OR pg_catalog.char_length(p_related_user_id) > 191
  ) THEN
    RAISE EXCEPTION 'notification related user is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_dedup_key IS NULL OR p_dedup_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'notification dedup key is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT recipient."notificationPreferences"
    INTO recipient_preferences
    FROM public."User" AS recipient
   WHERE recipient.id = p_user_id
     AND recipient.banned = false
     AND recipient."deletedAt" IS NULL
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF recipient_preferences -> (p_type::text) = 'false'::jsonb THEN
    RETURN NULL;
  END IF;

  IF p_related_user_id IS NOT NULL AND p_related_user_id <> p_user_id THEN
    PERFORM 1
      FROM public."User" AS related_user
     WHERE related_user.id = p_related_user_id
       AND related_user.banned = false
       AND related_user."deletedAt" IS NULL
     FOR KEY SHARE;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public."Notification" (
    id,
    "userId",
    "relatedUserId",
    "type",
    title,
    body,
    link,
    "sourceType",
    "sourceId",
    "dedupKey",
    read,
    "createdAt"
  ) VALUES (
    p_notification_id,
    p_user_id,
    p_related_user_id,
    p_type,
    p_title,
    p_body,
    p_link,
    p_source_type,
    p_source_id,
    p_dedup_key,
    false,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT ("userId", "type", "dedupKey") DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    SELECT notification.id
      INTO notification_id
      FROM public."Notification" AS notification
     WHERE notification."userId" = p_user_id
       AND notification."type" = p_type
       AND notification."dedupKey" = p_dedup_key;
  END IF;

  RETURN notification_id;
END;
$grainline_notification_create$;

CREATE OR REPLACE FUNCTION public.grainline_notification_delete_for_account(
  p_user_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_delete_for_account$
DECLARE
  request_user_id text := pg_catalog.current_setting('app.user_id', true);
  deleted_count integer;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191 THEN
    RAISE EXCEPTION 'account notification cleanup user is invalid' USING ERRCODE = '22023';
  END IF;
  IF request_user_id IS NULL OR request_user_id = '' OR request_user_id <> p_user_id THEN
    RAISE EXCEPTION 'account notification cleanup context mismatch' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public."User" AS account_user WHERE account_user.id = p_user_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account notification cleanup user is missing' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public."Notification" AS notification
   WHERE notification."userId" = p_user_id
      OR notification."relatedUserId" = p_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_notification_delete_for_account$;

CREATE OR REPLACE FUNCTION public.grainline_notification_delete_blog_comment(
  p_comment_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_delete_blog_comment$
DECLARE
  request_user_id text := pg_catalog.current_setting('app.user_id', true);
  deleted_count integer;
BEGIN
  IF p_comment_id IS NULL OR p_comment_id = '' OR pg_catalog.char_length(p_comment_id) > 191 THEN
    RAISE EXCEPTION 'blog comment notification cleanup source is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM 1
    FROM public."User" AS staff_user
   WHERE staff_user.id = request_user_id
     AND staff_user.role::text IN ('EMPLOYEE', 'ADMIN')
     AND staff_user.banned = false
     AND staff_user."deletedAt" IS NULL
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'blog comment notification cleanup requires staff context' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."Notification" AS notification
   WHERE notification."sourceType" = 'blog_comment'
     AND notification."sourceId" = p_comment_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_notification_delete_blog_comment$;

CREATE OR REPLACE FUNCTION public.grainline_notification_delete_seller_broadcast(
  p_broadcast_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_delete_seller_broadcast$
DECLARE
  request_user_id text := pg_catalog.current_setting('app.user_id', true);
  deleted_count integer;
BEGIN
  IF p_broadcast_id IS NULL OR p_broadcast_id = '' OR pg_catalog.char_length(p_broadcast_id) > 191 THEN
    RAISE EXCEPTION 'seller broadcast notification cleanup source is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM 1
    FROM public."User" AS staff_user
   WHERE staff_user.id = request_user_id
     AND staff_user.role::text IN ('EMPLOYEE', 'ADMIN')
     AND staff_user.banned = false
     AND staff_user."deletedAt" IS NULL
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'seller broadcast notification cleanup requires staff context' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."Notification" AS notification
   WHERE notification."sourceType" = 'seller_broadcast'
     AND notification."sourceId" = p_broadcast_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_notification_delete_seller_broadcast$;

CREATE OR REPLACE FUNCTION public.grainline_notification_prune_read_batch()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_prune_read_batch$
DECLARE
  deleted_count integer;
BEGIN
  WITH doomed AS (
    SELECT notification.id
      FROM public."Notification" AS notification
     WHERE notification.read = true
       AND notification."createdAt" < pg_catalog.clock_timestamp() - interval '90 days'
     ORDER BY notification."createdAt" ASC, notification.id ASC
     LIMIT 1000
     FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."Notification" AS notification
     USING doomed
     WHERE notification.id = doomed.id
     RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$grainline_notification_prune_read_batch$;

CREATE OR REPLACE FUNCTION public.grainline_notification_prune_unread_batch()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_prune_unread_batch$
DECLARE
  deleted_count integer;
BEGIN
  WITH doomed AS (
    SELECT notification.id
      FROM public."Notification" AS notification
     WHERE notification.read = false
       AND notification."createdAt" < pg_catalog.clock_timestamp() - interval '365 days'
     ORDER BY notification."createdAt" ASC, notification.id ASC
     LIMIT 1000
     FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."Notification" AS notification
     USING doomed
     WHERE notification.id = doomed.id
     RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$grainline_notification_prune_unread_batch$;

REVOKE ALL ON FUNCTION public.grainline_notification_create(
  text, text, public."NotificationType", text, text, text, text, text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_delete_for_account(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_delete_blog_comment(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_delete_seller_broadcast(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_prune_read_batch()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_prune_unread_batch()
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_notification_create(
  text, text, public."NotificationType", text, text, text, text, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_delete_for_account(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_delete_blog_comment(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_delete_seller_broadcast(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_prune_read_batch()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_prune_unread_batch()
  TO grainline_app_runtime;

-- Direct cross-user table writes remain forbidden. The later policy/grant
-- migration must preserve this posture after every broad provisioning rerun.
REVOKE INSERT, DELETE ON TABLE public."Notification" FROM grainline_app_runtime;

COMMIT;
