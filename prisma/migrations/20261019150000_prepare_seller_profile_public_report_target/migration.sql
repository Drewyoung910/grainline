BEGIN;

-- Return only whether the submitted seller id belongs to the reported user
-- and is currently public. Vacation mode intentionally remains eligible,
-- matching visibleSellerProfileWhere rather than the sellable predicate.
CREATE OR REPLACE FUNCTION public.grainline_seller_public_report_target(
  p_seller_profile_id text,
  p_reported_user_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_report_target$
  SELECT EXISTS (
    SELECT 1
      FROM public."SellerProfile" AS seller
     WHERE seller.id = p_seller_profile_id
       AND seller."userId" = p_reported_user_id
       AND seller."ownerAccountActive" = true
       AND seller."chargesEnabled" = true
       AND seller."stripeAccountSupported" = true
  )
$grainline_seller_public_report_target$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_report_target(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_report_target(text, text)
  TO grainline_app_runtime;

COMMIT;
