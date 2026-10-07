CREATE OR REPLACE FUNCTION public.grainline_user_staff_admin_labels(
  p_actor_id text,
  p_user_ids text[]
)
RETURNS TABLE (
  id text,
  name text,
  email text,
  "deletedAt" timestamp(3),
  "createdAt" timestamp(3)
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_staff_admin_labels$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'User staff admin labels require the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_user_ids IS NULL
     OR pg_catalog.cardinality(p_user_ids) > 200
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_user_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR requested.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'User staff admin-label input is invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = p_actor_id
       AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'User staff actor is not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    account_user.id,
    account_user.name::text,
    account_user.email::text,
    account_user."deletedAt",
    account_user."createdAt"
  FROM (
    SELECT requested.id, pg_catalog.min(requested.ordinal) AS ordinal
      FROM pg_catalog.unnest(p_user_ids) WITH ORDINALITY AS requested(id, ordinal)
     GROUP BY requested.id
  ) AS requested
  JOIN public."User" AS account_user ON account_user.id = requested.id
  ORDER BY requested.ordinal;
END
$grainline_user_staff_admin_labels$;

REVOKE ALL ON FUNCTION public.grainline_user_staff_admin_labels(text, text[])
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_staff_admin_labels(text, text[])
  TO grainline_staff_read_runtime;
