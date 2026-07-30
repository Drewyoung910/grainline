-- Compatible Case recipient/staff read projections. These functions add no
-- policy, table grant, row mutation or RLS state change. Old direct reads and
-- new fixed projections can coexist until the later application conversion.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_case_get(
  p_actor_user_id text,
  p_case_id text
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
  "escalateUnlocksAt" timestamp(3) with time zone,
  "buyerMarkedResolved" boolean,
  "sellerMarkedResolved" boolean,
  "resolvedAt" timestamp(3) with time zone,
  "createdAt" timestamp(3) with time zone,
  "actsAsStaff" boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_case_get$
DECLARE
  actor_role public."Role";
  actor_banned boolean;
  actor_deleted_at timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_case_id IS NULL
     OR p_case_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Case get input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config(
       'app.user_id',
       p_actor_user_id,
       true
     ) <> p_actor_user_id THEN
    RAISE EXCEPTION 'Case get actor context was not set'
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
    case_row."escalateUnlocksAt" AT TIME ZONE 'UTC',
    case_row."buyerMarkedResolved",
    case_row."sellerMarkedResolved",
    case_row."resolvedAt" AT TIME ZONE 'UTC',
    case_row."createdAt" AT TIME ZONE 'UTC',
    CASE
      WHEN p_actor_user_id = case_row."buyerId"
        OR p_actor_user_id = case_row."sellerId"
        THEN false
      ELSE true
    END::boolean
    FROM public."Case" AS case_row
   WHERE case_row.id = p_case_id
     AND (
       p_actor_user_id IN (
         case_row."buyerId",
         case_row."sellerId"
       )
       OR actor_role IN (
         'EMPLOYEE'::public."Role",
         'ADMIN'::public."Role"
       )
     );
END
$grainline_case_get$;

CREATE OR REPLACE FUNCTION public.grainline_case_get_by_order(
  p_actor_user_id text,
  p_order_id text
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
  "escalateUnlocksAt" timestamp(3) with time zone,
  "buyerMarkedResolved" boolean,
  "sellerMarkedResolved" boolean,
  "resolvedAt" timestamp(3) with time zone,
  "createdAt" timestamp(3) with time zone,
  "actsAsStaff" boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_case_get_by_order$
DECLARE
  actor_role public."Role";
  actor_banned boolean;
  actor_deleted_at timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Case get-by-order input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config(
       'app.user_id',
       p_actor_user_id,
       true
     ) <> p_actor_user_id THEN
    RAISE EXCEPTION 'Case get-by-order actor context was not set'
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
    case_row."escalateUnlocksAt" AT TIME ZONE 'UTC',
    case_row."buyerMarkedResolved",
    case_row."sellerMarkedResolved",
    case_row."resolvedAt" AT TIME ZONE 'UTC',
    case_row."createdAt" AT TIME ZONE 'UTC',
    CASE
      WHEN p_actor_user_id = case_row."buyerId"
        OR p_actor_user_id = case_row."sellerId"
        THEN false
      ELSE true
    END::boolean
    FROM public."Case" AS case_row
   WHERE case_row."orderId" = p_order_id
     AND (
       p_actor_user_id IN (
         case_row."buyerId",
         case_row."sellerId"
       )
       OR actor_role IN (
         'EMPLOYEE'::public."Role",
         'ADMIN'::public."Role"
       )
     );
END
$grainline_case_get_by_order$;

CREATE OR REPLACE FUNCTION public.grainline_case_staff_active_count(
  p_actor_user_id text
)
RETURNS TABLE (
  "activeCount" bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_case_staff_active_count$
DECLARE
  actor_role public."Role";
  actor_banned boolean;
  actor_deleted_at timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'Case staff active-count input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config(
       'app.user_id',
       p_actor_user_id,
       true
     ) <> p_actor_user_id THEN
    RAISE EXCEPTION 'Case staff active-count actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  SELECT actor.role, actor.banned, actor."deletedAt"
    INTO actor_role, actor_banned, actor_deleted_at
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id;
  IF NOT FOUND
     OR actor_banned
     OR actor_deleted_at IS NOT NULL
     OR actor_role NOT IN (
       'EMPLOYEE'::public."Role",
       'ADMIN'::public."Role"
     ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pg_catalog.count(*)::bigint
    FROM public."Case" AS case_row
   WHERE case_row.status IN (
     'OPEN'::public."CaseStatus",
     'IN_DISCUSSION'::public."CaseStatus",
     'PENDING_CLOSE'::public."CaseStatus",
     'UNDER_REVIEW'::public."CaseStatus"
   );
END
$grainline_case_staff_active_count$;

REVOKE ALL ON FUNCTION
  public.grainline_case_get(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_case_get_by_order(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_case_staff_active_count(text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_case_get(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_get_by_order(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_active_count(text)
  TO grainline_app_runtime;

COMMIT;
