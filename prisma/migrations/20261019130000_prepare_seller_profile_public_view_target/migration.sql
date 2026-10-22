BEGIN;

-- Return only the owner identifier needed to suppress self-view telemetry.
-- Vacation mode intentionally does not hide an otherwise visible shop, matching
-- visibleSellerProfileWhere rather than the stricter sellable predicate.
CREATE OR REPLACE FUNCTION public.grainline_seller_public_view_target(
  p_seller_profile_id text
)
RETURNS TABLE (
  "ownerUserId" text
)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_view_target$
  SELECT seller."userId"::text
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
   LIMIT 1
$grainline_seller_public_view_target$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_view_target(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_view_target(text)
  TO grainline_app_runtime;

COMMIT;
