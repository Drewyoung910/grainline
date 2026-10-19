BEGIN;

-- Return only the active owner's SellerProfile state rendered by the workshop
-- dashboard. Actor identity comes only from transaction-local server context.
CREATE OR REPLACE FUNCTION public.grainline_seller_owner_dashboard_state()
RETURNS TABLE (
  "sellerProfileId" text,
  "guildLevel" text,
  "vacationMode" boolean,
  "vacationReturnEpochMillis" bigint,
  "chargesEnabled" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_dashboard_state$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner dashboard context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."guildLevel"::text,
         seller."vacationMode",
         CASE
           WHEN seller."vacationReturnDate" IS NULL THEN NULL::bigint
           ELSE pg_catalog.floor(
             EXTRACT(
               EPOCH FROM (seller."vacationReturnDate" AT TIME ZONE 'UTC')
             ) * 1000
           )::bigint
         END,
         seller."chargesEnabled"
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
   WHERE account_user.id = request_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL;
END
$grainline_seller_owner_dashboard_state$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_dashboard_state()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_dashboard_state()
  TO grainline_app_runtime;

COMMIT;
