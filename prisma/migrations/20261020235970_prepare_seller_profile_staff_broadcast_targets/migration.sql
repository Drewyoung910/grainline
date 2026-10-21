-- Resolve the bounded admin broadcast page's historical seller labels through
-- the isolated staff session without granting SellerProfile table access.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_staff_broadcast_targets(
  p_actor_id text,
  p_broadcast_ids text[]
)
RETURNS TABLE (
  "broadcastId" text,
  "sellerProfileId" text,
  "sellerUserId" text,
  "sellerDisplayName" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_broadcast_targets$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller broadcast targets require the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_broadcast_ids IS NULL
     OR pg_catalog.cardinality(p_broadcast_ids) > 50
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_broadcast_ids) AS requested(id)
        WHERE requested.id IS NULL
           OR requested.id !~ '^[A-Za-z0-9._:-]{1,191}$'
     ) THEN
    RAISE EXCEPTION 'Seller broadcast target input is invalid'
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
    RAISE EXCEPTION 'Seller broadcast target actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT broadcast.id::text,
         seller.id::text,
         seller."userId"::text,
         seller."displayName"::text
    FROM public."SellerBroadcast" AS broadcast
    JOIN public."SellerProfile" AS seller
      ON seller.id = broadcast."sellerProfileId"
   WHERE broadcast.id = ANY(p_broadcast_ids)
   ORDER BY broadcast.id ASC;
END
$grainline_seller_staff_broadcast_targets$;

REVOKE ALL ON FUNCTION public.grainline_seller_staff_broadcast_targets(text,text[])
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_broadcast_targets(text,text[])
  TO grainline_staff_read_runtime;

COMMIT;
