BEGIN;

-- Serve the small SellerProfile subset shared by owner-only analytics,
-- broadcast, and upload gates. The owner identity comes only from
-- transaction-local server context.
CREATE OR REPLACE FUNCTION public.grainline_seller_owner_core()
RETURNS TABLE (
  "sellerProfileId" text,
  "displayName" text,
  "createdAtEpochMillis" bigint,
  "chargesEnabled" boolean,
  "vacationMode" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_core$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner core context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."displayName"::text,
         pg_catalog.floor(
           EXTRACT(
             EPOCH FROM (seller."createdAt" AT TIME ZONE 'UTC')
           ) * 1000
         )::bigint,
         seller."chargesEnabled",
         seller."vacationMode"
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
   WHERE account_user.id = request_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL;
END
$grainline_seller_owner_core$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_core()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_core()
  TO grainline_app_runtime;

COMMIT;
