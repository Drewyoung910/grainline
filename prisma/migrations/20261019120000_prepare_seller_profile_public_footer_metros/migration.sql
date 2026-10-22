BEGIN;

-- Return only the city-link fields rendered by the global footer. Preserve the
-- predecessor's two distinct eligibility paths and its all-listing popularity
-- order without exposing the count or any SellerProfile row.
CREATE OR REPLACE FUNCTION public.grainline_seller_public_footer_metros()
RETURNS TABLE (
  slug text,
  name text,
  state text
)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_footer_metros$
  SELECT metro.slug::text,
         metro.name::text,
         metro.state::text
    FROM public."Metro" AS metro
   WHERE metro."isActive" = true
     AND (
       EXISTS (
         SELECT 1
           FROM public."Listing" AS listing
           JOIN public."SellerProfile" AS seller
             ON seller.id = listing."sellerId"
          WHERE listing."metroId" = metro.id
            AND listing.status::text = 'ACTIVE'
            AND listing."isPrivate" = false
            AND listing."archivedAt" IS NULL
            AND seller."ownerAccountActive" = true
            AND seller."chargesEnabled" = true
            AND seller."stripeAccountSupported" = true
            AND seller."vacationMode" = false
       )
       OR EXISTS (
         SELECT 1
           FROM public."SellerProfile" AS seller
          WHERE seller."metroId" = metro.id
            AND seller."ownerAccountActive" = true
            AND seller."chargesEnabled" = true
            AND seller."stripeAccountSupported" = true
            AND seller."vacationMode" = false
       )
     )
   ORDER BY (
     SELECT pg_catalog.count(*)
       FROM public."Listing" AS listing
      WHERE listing."metroId" = metro.id
   ) DESC,
   metro.name ASC,
   metro.slug ASC
   LIMIT 10
$grainline_seller_public_footer_metros$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_footer_metros()
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_footer_metros()
  TO grainline_app_runtime;

COMMIT;
