-- Compatible bounded participant Case export projection. This adds no policy,
-- table grant, row mutation or RLS state change. The fixed export page and the
-- existing direct read can coexist until the application conversion.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_case_export_page(
  p_actor_user_id text,
  p_cursor_created_at timestamp(3),
  p_cursor_id text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  "orderId" text,
  "buyerId" text,
  "sellerId" text,
  reason text,
  description text,
  status text,
  resolution text,
  "refundAmountCents" integer,
  "sellerRespondBy" timestamp(3) with time zone,
  "resolvedAt" timestamp(3) with time zone,
  "createdAt" timestamp(3) with time zone,
  "updatedAt" timestamp(3) with time zone
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_case_export_page$
DECLARE
  actor_banned boolean;
  actor_deleted_at timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL)
     OR (
       p_cursor_id IS NOT NULL
       AND p_cursor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     )
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 25 THEN
    RAISE EXCEPTION 'Case account-export input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.set_config(
       'app.user_id',
       p_actor_user_id,
       true
     ) <> p_actor_user_id THEN
    RAISE EXCEPTION 'Case account-export actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  SELECT actor.banned, actor."deletedAt"
    INTO actor_banned, actor_deleted_at
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id;
  IF NOT FOUND
     OR actor_banned
     OR actor_deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    case_row.id::text,
    case_row."orderId"::text,
    case_row."buyerId"::text,
    case_row."sellerId"::text,
    case_row.reason::text,
    case_row.description::text,
    case_row.status::text,
    case_row.resolution::text,
    case_row."refundAmountCents",
    case_row."sellerRespondBy" AT TIME ZONE 'UTC',
    case_row."resolvedAt" AT TIME ZONE 'UTC',
    case_row."createdAt" AT TIME ZONE 'UTC',
    case_row."updatedAt" AT TIME ZONE 'UTC'
    FROM public."Case" AS case_row
   WHERE p_actor_user_id IN (
           case_row."buyerId",
           case_row."sellerId"
         )
     AND (
       p_cursor_created_at IS NULL
       OR case_row."createdAt" < p_cursor_created_at
       OR (
         case_row."createdAt" = p_cursor_created_at
         AND case_row.id < p_cursor_id
       )
     )
   ORDER BY case_row."createdAt" DESC, case_row.id DESC
   LIMIT p_limit;
END
$grainline_case_export_page$;

REVOKE ALL ON FUNCTION
  public.grainline_case_export_page(
    text,
    timestamp,
    text,
    integer
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_export_page(
    text,
    timestamp,
    text,
    integer
  )
  TO grainline_app_runtime;

COMMIT;
