-- Add the bounded seller header projection for the customer-photo landing page.
--
-- Anonymous callers can resolve the same publicly visible seller header as the
-- predecessor route. An active owner may still resolve their own disabled
-- profile for canonical handling, while public photo eligibility remains an
-- explicit result. Authenticated non-owners are subject to reciprocal blocks.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_customer_photo_header(
  p_seller_profile_id text
)
RETURNS TABLE (
  id text,
  "userId" text,
  "displayName" text,
  "publicPhotosEligible" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_customer_photo_header$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller customer-photo target is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF request_user_id IS NOT NULL
     AND (
       request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1
           FROM public."User" AS viewer
          WHERE viewer.id = request_user_id
            AND viewer.banned = false
            AND viewer."deletedAt" IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Seller customer-photo viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id::text,
         seller."userId"::text,
         seller."displayName"::text,
         (
           seller."chargesEnabled" = true
           AND seller."stripeAccountSupported" = true
           AND seller."vacationMode" = false
         ) AS "publicPhotosEligible"
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
     AND seller."ownerAccountActive" = true
     AND (
       request_user_id = seller."userId"
       OR (
         seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
       )
     )
     AND (
       request_user_id IS NULL
       OR request_user_id = seller."userId"
       OR NOT EXISTS (
         SELECT 1
           FROM public."Block" AS relationship
          WHERE (
            relationship."blockerId" = request_user_id
            AND relationship."blockedId" = seller."userId"
          ) OR (
            relationship."blockerId" = seller."userId"
            AND relationship."blockedId" = request_user_id
          )
       )
     )
   LIMIT 1;
END
$grainline_seller_public_customer_photo_header$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_customer_photo_header(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_customer_photo_header(text)
  TO grainline_app_runtime;

COMMIT;
