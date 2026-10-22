-- Resolve seller report links through the isolated staff connection after the
-- application has verified the Clerk session and the session-bound admin PIN.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_staff_report_targets(
  p_actor_id text,
  p_seller_profile_ids text[]
)
RETURNS TABLE (
  id text,
  "displayName" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_report_targets$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller report targets require the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_ids IS NULL
     OR pg_catalog.cardinality(p_seller_profile_ids) > 50
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_seller_profile_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR requested.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'Seller report target input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = p_actor_id
       AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller report target actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id::text,
         seller."displayName"::text
    FROM public."SellerProfile" AS seller
   WHERE seller.id = ANY(p_seller_profile_ids)
   ORDER BY seller.id ASC;
END
$grainline_seller_staff_report_targets$;

REVOKE ALL ON FUNCTION public.grainline_seller_staff_report_targets(text,text[])
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_report_targets(text,text[])
  TO grainline_staff_read_runtime;

COMMIT;
