-- Preparation-only Bucket B recipient-access draft. Deliberately outside
-- prisma/migrations and barred from deployment until SavedSearch Phase B plus
-- runtime credential separation pass production postflight.
--
-- These functions are SECURITY INVOKER. They do not bypass Notification RLS;
-- each call sets the transaction-local recipient context, then the runtime
-- role's table grants and recipient policies constrain the query/update. The
-- application must pass only its server-resolved local User.id.

BEGIN;

ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Notification" NO FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grainline_notification_recipient_select
  ON public."Notification";
CREATE POLICY grainline_notification_recipient_select
  ON public."Notification"
  FOR SELECT
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(
      pg_catalog.current_setting('app.user_id', true),
      ''
    )
  );

DROP POLICY IF EXISTS grainline_notification_recipient_update
  ON public."Notification";
CREATE POLICY grainline_notification_recipient_update
  ON public."Notification"
  FOR UPDATE
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(
      pg_catalog.current_setting('app.user_id', true),
      ''
    )
  )
  WITH CHECK (
    "userId" = NULLIF(
      pg_catalog.current_setting('app.user_id', true),
      ''
    )
  );

CREATE OR REPLACE FUNCTION public.grainline_notification_unread_count(
  p_user_id text
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_notification_unread_count$
DECLARE
  unread_count bigint;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191 THEN
    RAISE EXCEPTION 'notification recipient is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'notification recipient context was not set' USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)
    INTO unread_count
    FROM public."Notification" AS notification
   WHERE notification."userId" = p_user_id
     AND notification.read = false;
  RETURN unread_count;
END;
$grainline_notification_unread_count$;

CREATE OR REPLACE FUNCTION public.grainline_notification_bell(
  p_user_id text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id text,
  type public."NotificationType",
  title text,
  body text,
  link text,
  read boolean,
  "createdAt" timestamp(3),
  "unreadCount" bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_notification_bell$
DECLARE
  bounded_limit integer;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191 THEN
    RAISE EXCEPTION 'notification recipient is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'notification recipient context was not set' USING ERRCODE = '55000';
  END IF;
  bounded_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));

  RETURN QUERY
  WITH unread AS MATERIALIZED (
    SELECT pg_catalog.count(*) AS count
      FROM public."Notification" AS notification
     WHERE notification."userId" = p_user_id
       AND notification.read = false
  ), recent AS MATERIALIZED (
    SELECT
      notification.id,
      notification.type,
      notification.title,
      notification.body,
      notification.link,
      notification.read,
      notification."createdAt"
      FROM public."Notification" AS notification
     WHERE notification."userId" = p_user_id
     ORDER BY notification."createdAt" DESC, notification.id DESC
     LIMIT bounded_limit
  )
  SELECT
    recent.id,
    recent.type,
    recent.title,
    recent.body,
    recent.link,
    recent.read,
    recent."createdAt",
    unread.count
    FROM unread
    LEFT JOIN recent ON true
   ORDER BY recent."createdAt" DESC NULLS LAST, recent.id DESC NULLS LAST;
END;
$grainline_notification_bell$;

CREATE OR REPLACE FUNCTION public.grainline_notification_page(
  p_user_id text,
  p_requested_page integer,
  p_page_size integer
)
RETURNS TABLE (
  id text,
  type public."NotificationType",
  title text,
  body text,
  link text,
  read boolean,
  "createdAt" timestamp(3),
  page integer,
  total bigint,
  "totalPages" integer,
  "unreadCount" bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_notification_page$
DECLARE
  bounded_requested_page integer;
  bounded_page_size integer;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191 THEN
    RAISE EXCEPTION 'notification recipient is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'notification recipient context was not set' USING ERRCODE = '55000';
  END IF;
  bounded_requested_page := GREATEST(
    1,
    LEAST(COALESCE(p_requested_page, 1), 1000)
  );
  bounded_page_size := GREATEST(1, LEAST(COALESCE(p_page_size, 20), 100));

  RETURN QUERY
  WITH summary AS MATERIALIZED (
    SELECT
      pg_catalog.count(*) AS total,
      pg_catalog.count(*) FILTER (WHERE notification.read = false) AS unread_count
      FROM public."Notification" AS notification
     WHERE notification."userId" = p_user_id
  ), bounds AS MATERIALIZED (
    SELECT
      LEAST(
        bounded_requested_page,
        GREATEST(
          1,
          ((summary.total + bounded_page_size - 1) / bounded_page_size)::integer
        )
      ) AS page,
      summary.total,
      GREATEST(
        1,
        ((summary.total + bounded_page_size - 1) / bounded_page_size)::integer
      ) AS total_pages,
      summary.unread_count
      FROM summary
  ), page_rows AS MATERIALIZED (
    SELECT
      notification.id,
      notification.type,
      notification.title,
      notification.body,
      notification.link,
      notification.read,
      notification."createdAt"
      FROM public."Notification" AS notification
     WHERE notification."userId" = p_user_id
     ORDER BY notification."createdAt" DESC, notification.id DESC
     LIMIT bounded_page_size
     OFFSET ((SELECT bounds.page FROM bounds) - 1) * bounded_page_size
  )
  SELECT
    page_rows.id,
    page_rows.type,
    page_rows.title,
    page_rows.body,
    page_rows.link,
    page_rows.read,
    page_rows."createdAt",
    bounds.page,
    bounds.total,
    bounds.total_pages,
    bounds.unread_count
    FROM bounds
    LEFT JOIN page_rows ON true
   ORDER BY page_rows."createdAt" DESC NULLS LAST, page_rows.id DESC NULLS LAST;
END;
$grainline_notification_page$;

CREATE OR REPLACE FUNCTION public.grainline_notification_mark_one_read(
  p_user_id text,
  p_notification_id text
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_notification_mark_one_read$
DECLARE
  updated_count bigint;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191
     OR p_notification_id IS NULL OR p_notification_id = ''
     OR pg_catalog.char_length(p_notification_id) > 191 THEN
    RAISE EXCEPTION 'notification mark-read input is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'notification recipient context was not set' USING ERRCODE = '55000';
  END IF;

  UPDATE public."Notification" AS notification
     SET read = true
   WHERE notification.id = p_notification_id
     AND notification."userId" = p_user_id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$grainline_notification_mark_one_read$;

CREATE OR REPLACE FUNCTION public.grainline_notification_mark_many_read(
  p_user_id text,
  p_notification_ids text[] DEFAULT ARRAY[]::text[]
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_notification_mark_many_read$
DECLARE
  updated_count bigint;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191
     OR p_notification_ids IS NULL
     OR pg_catalog.cardinality(p_notification_ids) > 100
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_notification_ids) AS notification_id
        WHERE notification_id IS NULL
           OR notification_id = ''
           OR pg_catalog.char_length(notification_id) > 191
     ) THEN
    RAISE EXCEPTION 'notification mark-many input is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'notification recipient context was not set' USING ERRCODE = '55000';
  END IF;

  UPDATE public."Notification" AS notification
     SET read = true
   WHERE notification."userId" = p_user_id
     AND notification.read = false
     AND (
       pg_catalog.cardinality(p_notification_ids) = 0
       OR notification.id = ANY (p_notification_ids)
     );
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$grainline_notification_mark_many_read$;

CREATE OR REPLACE FUNCTION public.grainline_notification_mark_conversation_read(
  p_user_id text,
  p_conversation_id text
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_notification_mark_conversation_read$
DECLARE
  updated_count bigint;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191
     OR p_conversation_id IS NULL OR p_conversation_id = ''
     OR pg_catalog.char_length(p_conversation_id) > 191 THEN
    RAISE EXCEPTION 'notification conversation input is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'notification recipient context was not set' USING ERRCODE = '55000';
  END IF;

  UPDATE public."Notification" AS notification
     SET read = true
   WHERE notification."userId" = p_user_id
     AND notification.type = 'NEW_MESSAGE'::public."NotificationType"
     AND notification.read = false
     AND notification.link = '/messages/' || p_conversation_id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$grainline_notification_mark_conversation_read$;

CREATE OR REPLACE FUNCTION public.grainline_notification_export(
  p_user_id text
)
RETURNS TABLE (
  id text,
  type public."NotificationType",
  title text,
  body text,
  link text,
  "sourceType" text,
  "sourceId" text,
  read boolean,
  "createdAt" timestamp(3)
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_notification_export$
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191 THEN
    RAISE EXCEPTION 'notification recipient is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'notification recipient context was not set' USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  SELECT
    notification.id,
    notification.type,
    notification.title,
    notification.body,
    notification.link,
    notification."sourceType",
    notification."sourceId",
    notification.read,
    notification."createdAt"
    FROM public."Notification" AS notification
   WHERE notification."userId" = p_user_id
   ORDER BY notification."createdAt" DESC, notification.id DESC;
END;
$grainline_notification_export$;

CREATE OR REPLACE FUNCTION public.grainline_notification_recent_low_stock(
  p_user_id text,
  p_link text,
  p_since timestamp(3)
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_notification_recent_low_stock$
DECLARE
  notification_id text;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191
     OR p_link IS NULL OR p_link = '' OR pg_catalog.char_length(p_link) > 2048
     OR pg_catalog.left(p_link, 1) <> '/'
     OR pg_catalog.left(p_link, 2) = '//'
     OR pg_catalog.strpos(p_link, pg_catalog.chr(92)) > 0
     OR p_link ~ '[[:cntrl:]]'
     OR p_since IS NULL THEN
    RAISE EXCEPTION 'notification low-stock lookup input is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_user_id, true) <> p_user_id THEN
    RAISE EXCEPTION 'notification recipient context was not set' USING ERRCODE = '55000';
  END IF;

  SELECT notification.id
    INTO notification_id
    FROM public."Notification" AS notification
   WHERE notification."userId" = p_user_id
     AND notification.type = 'LOW_STOCK'::public."NotificationType"
     AND notification.link = p_link
     AND notification."createdAt" >= p_since
   ORDER BY notification."createdAt" DESC, notification.id DESC
   LIMIT 1;
  RETURN notification_id;
END;
$grainline_notification_recent_low_stock$;

REVOKE ALL ON TABLE public."Notification" FROM PUBLIC, grainline_app_runtime;
GRANT SELECT ON TABLE public."Notification" TO grainline_app_runtime;
GRANT UPDATE (read) ON TABLE public."Notification" TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_notification_unread_count(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_notification_bell(text, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_notification_page(text, integer, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_notification_mark_one_read(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_notification_mark_many_read(text, text[])
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_notification_mark_conversation_read(text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_notification_export(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_notification_recent_low_stock(text, text, timestamp)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_notification_unread_count(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_bell(text, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_page(text, integer, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_mark_one_read(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_mark_many_read(text, text[])
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_mark_conversation_read(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_export(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_recent_low_stock(text, text, timestamp)
  TO grainline_app_runtime;

COMMIT;
