-- Add the bounded location-membership authority for public browse filters.
--
-- The caller supplies only a search center and radius. The operation applies
-- the existing public listing, seller, block, and location-privacy rules and
-- returns seller ids only. Raw coordinates and privacy controls remain inside
-- the database boundary. Predecessor table grants remain unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_browse_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_miles double precision
)
RETURNS TABLE (
  "sellerProfileId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_browse_nearby$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_lat IS NULL
     OR p_lat < -90
     OR p_lat > 90
     OR p_lng IS NULL
     OR p_lng < -180
     OR p_lng > 180
     OR p_radius_miles IS NULL
     OR p_radius_miles < 1
     OR p_radius_miles > 500 THEN
    RAISE EXCEPTION 'Seller public browse location input is invalid'
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
    RAISE EXCEPTION 'Seller public browse viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT seller.id,
           seller."userId",
           seller.lat,
           seller.lng,
           CASE
             WHEN COALESCE(seller."radiusMeters", 0) > 0
             THEN seller."radiusMeters"::double precision / 111320.0
             ELSE 0.05::double precision
           END AS cell_size
      FROM public."SellerProfile" AS seller
     WHERE seller."ownerAccountActive" = true
       AND seller."chargesEnabled" = true
       AND seller."stripeAccountSupported" = true
       AND seller."vacationMode" = false
       AND seller.lat IS NOT NULL
       AND seller.lng IS NOT NULL
       AND seller.lat BETWEEN -90 AND 90
       AND seller.lng BETWEEN -180 AND 180
       AND EXISTS (
         SELECT 1
           FROM public."Listing" AS listing
          WHERE listing."sellerId" = seller.id
            AND listing.status::text = 'ACTIVE'
            AND listing."isPrivate" = false
            AND listing."archivedAt" IS NULL
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
       )
  ),
  lower_bounds AS (
    SELECT eligible.*,
           (-90.0 + LEAST(
             CEIL(180.0 / eligible.cell_size) - 1,
             FLOOR((eligible.lat + 90.0) / eligible.cell_size)
           ) * eligible.cell_size) AS lat_lower,
           (-180.0 + LEAST(
             CEIL(360.0 / eligible.cell_size) - 1,
             FLOOR((eligible.lng + 180.0) / eligible.cell_size)
           ) * eligible.cell_size) AS lng_lower
      FROM eligible
  ),
  public_points AS (
    SELECT lower_bounds.id,
           (
             lower_bounds.lat_lower
             + LEAST(90.0, lower_bounds.lat_lower + lower_bounds.cell_size)
           ) / 2.0 AS public_lat,
           (
             lower_bounds.lng_lower
             + LEAST(180.0, lower_bounds.lng_lower + lower_bounds.cell_size)
           ) / 2.0 AS public_lng
      FROM lower_bounds
  )
  SELECT public_points.id AS "sellerProfileId"
    FROM public_points
   WHERE (
     6371.0 * 2.0 * ASIN(LEAST(1.0, SQRT(
       POWER(SIN(RADIANS((public_points.public_lat - p_lat) / 2.0)), 2)
       + COS(RADIANS(p_lat)) * COS(RADIANS(public_points.public_lat))
       * POWER(SIN(RADIANS((public_points.public_lng - p_lng) / 2.0)), 2)
     )))
   ) <= p_radius_miles * 1.60934
   ORDER BY public_points.id ASC;
END
$grainline_seller_public_browse_nearby$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_browse_nearby(
  double precision,
  double precision,
  double precision
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_browse_nearby(
  double precision,
  double precision,
  double precision
) TO grainline_app_runtime;

COMMIT;
