-- Compatible, bounded Case-message history projection. This function is the
-- only recipient read added here; Case-family RLS, table grants and direct
-- application reads remain unchanged so old and new deployments can coexist.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_case_message_page(
  p_actor_user_id text,
  p_case_id text,
  p_cursor_created_at timestamp(3),
  p_cursor_id text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  "authorId" text,
  "authorKind" text,
  body text,
  "createdAt" timestamp(3),
  attachments jsonb
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_message_page$
DECLARE
  actor_role public."Role";
  actor_banned boolean;
  actor_deleted_at timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_case_id IS NULL
     OR p_case_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL)
     OR (
       p_cursor_id IS NOT NULL
       AND p_cursor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 51 THEN
    RAISE EXCEPTION 'Case-message page input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config(
       'app.user_id',
       p_actor_user_id,
       true
     ) <> p_actor_user_id THEN
    RAISE EXCEPTION 'Case-message page actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  SELECT actor.role, actor.banned, actor."deletedAt"
    INTO actor_role, actor_banned, actor_deleted_at
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id;
  IF NOT FOUND
     OR actor_banned
     OR actor_deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH page AS MATERIALIZED (
    SELECT
      message.id,
      message."authorId",
      message."authorKind",
      message.body,
      message."createdAt",
      case_row."buyerId",
      case_row."sellerId"
      FROM public."CaseMessage" AS message
      JOIN public."Case" AS case_row
        ON case_row.id = message."caseId"
     WHERE message."caseId" = p_case_id
       AND (
         p_actor_user_id IN (
           case_row."buyerId",
           case_row."sellerId"
         )
         OR actor_role IN (
           'EMPLOYEE'::public."Role",
           'ADMIN'::public."Role"
         )
       )
       AND (
         p_cursor_created_at IS NULL
         OR message."createdAt" < p_cursor_created_at
         OR (
           message."createdAt" = p_cursor_created_at
           AND message.id < p_cursor_id
         )
       )
     ORDER BY message."createdAt" DESC, message.id DESC
     LIMIT p_limit
  )
  SELECT
    page.id,
    page."authorId",
    CASE
      WHEN page."authorKind" IS NOT NULL
        THEN page."authorKind"::text
      WHEN page."authorId" = page."buyerId"
        THEN 'BUYER'::text
      WHEN page."authorId" = page."sellerId"
        THEN 'SELLER'::text
      ELSE NULL::text
    END,
    page.body::text,
    page."createdAt",
    COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', attachment.id,
            'contentType', attachment."contentType",
            'byteSize', attachment."byteSize",
            'createdAt',
              attachment."createdAt" AT TIME ZONE 'UTC'
          )
          ORDER BY attachment."createdAt", attachment.id
        )
          FROM (
            SELECT
              candidate.id,
              candidate."contentType",
              candidate."byteSize",
              candidate."createdAt"
              FROM public."CaseMessageAttachment" AS candidate
             WHERE candidate."caseMessageId" = page.id
             ORDER BY candidate."createdAt", candidate.id
             LIMIT 4
          ) AS attachment
      ),
      '[]'::jsonb
    )
    FROM page
   ORDER BY page."createdAt" DESC, page.id DESC;
END
$grainline_case_message_page$;

REVOKE ALL ON FUNCTION
  public.grainline_case_message_page(
    text,
    text,
    timestamp,
    text,
    integer
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_message_page(
    text,
    text,
    timestamp,
    text,
    integer
  )
  TO grainline_app_runtime;

COMMIT;
