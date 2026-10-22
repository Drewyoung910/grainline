-- Add one bounded public metro seller-count authority.
--
-- Metro metadata and result pages need only a count. This operation owns the
-- major-metro vs city-metro selector, optional public-listing requirement,
-- active-seller rules, and reciprocal blocks from trusted user context.
-- Predecessor grants remain unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_metro_count(
  p_metro_id text,
  p_is_major boolean,
  p_require_public_listing boolean
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_metro_count$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  result_count bigint;
BEGIN
  IF p_metro_id IS NULL
     OR p_metro_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_is_major IS NULL
     OR p_require_public_listing IS NULL THEN
    RAISE EXCEPTION 'Seller public metro count input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF request_user_id IS NOT NULL
     AND (
       request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1
           FROM public."User" AS request_user
          WHERE request_user.id = request_user_id
            AND request_user.banned = false
            AND request_user."deletedAt" IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Seller public metro count viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.count(*)
    INTO result_count
    FROM public."SellerProfile" AS seller
   WHERE seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND (
       (p_is_major = true AND seller."metroId" = p_metro_id)
       OR (p_is_major = false AND seller."cityMetroId" = p_metro_id)
     )
     AND (
       p_require_public_listing = false
       OR EXISTS (
         SELECT 1
           FROM public."Listing" AS listing
          WHERE listing."sellerId" = seller.id
            AND listing.status::text = 'ACTIVE'
            AND listing."isPrivate" = false
            AND listing."archivedAt" IS NULL
       )
     )
     AND (
       request_user_id IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM public."Block" AS relationship
          WHERE (
            relationship."blockerId" = request_user_id
            AND relationship."blockedId" = seller."userId"
          )
             OR (
               relationship."blockerId" = seller."userId"
               AND relationship."blockedId" = request_user_id
             )
       )
     );

  RETURN result_count;
END
$grainline_seller_public_metro_count$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_metro_count(
  text,
  boolean,
  boolean
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_metro_count(
  text,
  boolean,
  boolean
) TO grainline_app_runtime;

COMMIT;
