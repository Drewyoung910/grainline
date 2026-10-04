-- Compatible public User member aggregate preparation.
--
-- This migration is additive. It does not enable RLS, revoke predecessor
-- table grants, mutate rows, or expose any User identity. The fixed aggregate
-- returns one public count using the canonical active-account definition.

CREATE FUNCTION public.grainline_user_public_active_member_count()
RETURNS bigint
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_public_active_member_count$
  SELECT pg_catalog.count(*)::bigint
    FROM public."User" AS source_user
   WHERE source_user.banned = false
     AND source_user."deletedAt" IS NULL
$grainline_user_public_active_member_count$;

REVOKE ALL ON FUNCTION public.grainline_user_public_active_member_count()
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grainline_user_public_active_member_count()
  TO grainline_app_runtime;
