-- Export the authenticated actor's complete followed-shop history without
-- exposing SellerProfile table authority. The operation deliberately retains
-- inactive shops because an account export describes recorded user data, not
-- the currently public marketplace.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_follow_export()
RETURNS TABLE (
  "sellerProfileId" text,
  "createdAt" timestamp with time zone,
  "displayName" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_follow_export$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner follow-export context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT relationship."sellerProfileId"::text,
         relationship."createdAt" AT TIME ZONE 'UTC',
         seller."displayName"::text
    FROM public."Follow" AS relationship
    JOIN public."User" AS actor
      ON actor.id = relationship."followerId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = relationship."sellerProfileId"
   WHERE relationship."followerId" = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   ORDER BY relationship."createdAt" DESC;
END
$grainline_seller_owner_follow_export$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_follow_export()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_follow_export()
  TO grainline_app_runtime;

COMMIT;
