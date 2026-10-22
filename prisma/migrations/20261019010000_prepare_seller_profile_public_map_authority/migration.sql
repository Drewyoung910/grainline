-- Add the first bounded public SellerProfile read authority.
--
-- This preparation is additive. The predecessor runtime table grants remain
-- in place until every caller has converted and the separate grant-closure
-- release is reviewed. Public coordinates leave this function only after
-- deterministic many-to-one quantization.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_map_points(
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  id text,
  "displayName" text,
  city text,
  state text,
  "publicLat" double precision,
  "publicLng" double precision
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_map_points$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Seller public map limit is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF request_user_id IS NOT NULL
     AND (
       request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1
           FROM public."User" AS request_user
          WHERE request_user.id = request_user_id
            AND request_user."deletedAt" IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Seller public map viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."displayName"::text,
         seller.city::text,
         seller.state::text,
         LEAST(
           89.975::double precision,
           GREATEST(
             (-89.975)::double precision,
             (pg_catalog.floor(seller.lat * 20.0) + 0.5) / 20.0
           )
         ) AS "publicLat",
         LEAST(
           179.975::double precision,
           GREATEST(
             (-179.975)::double precision,
             (pg_catalog.floor(seller.lng * 20.0) + 0.5) / 20.0
           )
         ) AS "publicLng"
    FROM public."SellerProfile" AS seller
   WHERE seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND seller."publicMapOptIn" = true
     AND seller.lat IS NOT NULL
     AND seller.lng IS NOT NULL
     AND seller.lat BETWEEN -90 AND 90
     AND seller.lng BETWEEN -180 AND 180
     AND COALESCE(seller."radiusMeters", 0) = 0
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
     )
   ORDER BY seller.id ASC
   LIMIT p_limit;
END
$grainline_seller_public_map_points$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_map_points(integer)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_map_points(integer)
  TO grainline_app_runtime;

COMMIT;
