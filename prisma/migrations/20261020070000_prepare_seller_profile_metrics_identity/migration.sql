BEGIN;

-- Seller metrics need only the immutable identity that ties a seller profile
-- to conversation response aggregates and the profile creation clock. Preserve
-- historical/inactive profiles: the predecessor lookup applied no account or
-- seller eligibility predicate.
CREATE OR REPLACE FUNCTION public.grainline_seller_service_metrics_identity(
  target_seller_profile_id text
)
RETURNS TABLE (
  "sellerUserId" text,
  "createdAtEpochMillis" bigint
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_service_metrics_identity$
BEGIN
  IF target_seller_profile_id IS NULL
     OR target_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller metrics identity target is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller."userId"::text,
         pg_catalog.floor(
           EXTRACT(
             EPOCH FROM (seller."createdAt" AT TIME ZONE 'UTC')
           ) * 1000
         )::bigint
    FROM public."SellerProfile" AS seller
   WHERE seller.id = target_seller_profile_id;
END
$grainline_seller_service_metrics_identity$;

REVOKE ALL ON FUNCTION public.grainline_seller_service_metrics_identity(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_service_metrics_identity(text)
  TO grainline_app_runtime;

COMMIT;
