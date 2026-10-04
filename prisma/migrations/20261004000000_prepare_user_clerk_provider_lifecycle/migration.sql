CREATE OR REPLACE FUNCTION public.grainline_user_clerk_lifecycle_state(
  p_clerk_id text
)
RETURNS TABLE (
  id text,
  email text,
  banned boolean,
  "deletedAt" timestamp(3)
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_clerk_lifecycle_state$
BEGIN
  IF p_clerk_id IS NULL
     OR p_clerk_id !~ '^[A-Za-z0-9._:-]{1,255}$' THEN
    RAISE EXCEPTION 'Clerk provider lifecycle identifier is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    account_user.id,
    CASE
      WHEN account_user.banned OR account_user."deletedAt" IS NOT NULL THEN NULL
      ELSE account_user.email::text
    END,
    account_user.banned,
    account_user."deletedAt"
  FROM public."User" AS account_user
  WHERE account_user."clerkId" = p_clerk_id;
END
$grainline_user_clerk_lifecycle_state$;

CREATE OR REPLACE FUNCTION public.grainline_user_clerk_welcome_reserve(
  p_clerk_id text,
  p_user_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_clerk_welcome_reserve$
DECLARE
  changed_at timestamp(3);
  updated_rows integer := 0;
BEGIN
  IF p_clerk_id IS NULL
     OR p_clerk_id !~ '^[A-Za-z0-9._:-]{1,255}$'
     OR p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Clerk welcome reservation identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."User" AS account_user
     SET "welcomeEmailSentAt" = changed_at,
         "updatedAt" = changed_at
   WHERE account_user."clerkId" = p_clerk_id
     AND account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND account_user."welcomeEmailSentAt" IS NULL;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows = 1;
END
$grainline_user_clerk_welcome_reserve$;

REVOKE ALL ON FUNCTION
  public.grainline_user_clerk_lifecycle_state(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_clerk_lifecycle_state(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_clerk_welcome_reserve(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_clerk_welcome_reserve(text, text)
  TO grainline_app_runtime;
