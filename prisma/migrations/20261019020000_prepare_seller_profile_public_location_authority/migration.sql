-- Add resource-bound approximate location access for seller and listing pages.
--
-- Public seller pages, public listing details, owners, and the reserved buyer
-- keep their predecessor visibility. Staff-only previews deliberately receive
-- no location unless the same resource is otherwise visible; staff review does
-- not need pickup geography. Raw coordinates and privacy controls never leave
-- this operation.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_location(
  p_seller_profile_id text,
  p_listing_id text DEFAULT NULL
)
RETURNS TABLE (
  "publicLat" double precision,
  "publicLng" double precision,
  "displayRadiusMeters" integer,
  "structuredGeoEligible" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_location$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_listing_id IS NOT NULL
         AND p_listing_id !~ '^[A-Za-z0-9._:-]{1,191}$') THEN
    RAISE EXCEPTION 'Seller public location input is invalid'
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
    RAISE EXCEPTION 'Seller public location viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT seller.*,
           CASE
             WHEN COALESCE(seller."radiusMeters", 0) > 0
             THEN seller."radiusMeters"::double precision / 111320.0
             ELSE 0.05::double precision
           END AS cell_size
      FROM public."SellerProfile" AS seller
     WHERE seller.id = p_seller_profile_id
       AND seller."allowLocalPickup" = true
       AND seller.lat IS NOT NULL
       AND seller.lng IS NOT NULL
       AND seller.lat BETWEEN -90 AND 90
       AND seller.lng BETWEEN -180 AND 180
       AND (
         (
           p_listing_id IS NULL
           AND seller."ownerAccountActive" = true
           AND (
             request_user_id = seller."userId"
             OR (
               seller."chargesEnabled" = true
               AND seller."stripeAccountSupported" = true
             )
           )
         )
         OR (
           p_listing_id IS NOT NULL
           AND EXISTS (
             SELECT 1
               FROM public."Listing" AS listing
              WHERE listing.id = p_listing_id
                AND listing."sellerId" = seller.id
                AND listing."archivedAt" IS NULL
                AND (
                  request_user_id = seller."userId"
                  OR (
                    listing.status::text IN ('ACTIVE', 'SOLD_OUT')
                    AND listing."isPrivate" = false
                    AND seller."ownerAccountActive" = true
                    AND seller."chargesEnabled" = true
                    AND seller."stripeAccountSupported" = true
                    AND seller."vacationMode" = false
                  )
                  OR (
                    request_user_id IS NOT NULL
                    AND listing.status::text IN ('ACTIVE', 'SOLD')
                    AND listing."isPrivate" = true
                    AND listing."reservedForUserId" = request_user_id
                    AND seller."ownerAccountActive" = true
                    AND seller."chargesEnabled" = true
                    AND seller."stripeAccountSupported" = true
                    AND seller."vacationMode" = false
                  )
                )
           )
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
  )
  SELECT (
           lower_bounds.lat_lower
           + LEAST(90.0, lower_bounds.lat_lower + lower_bounds.cell_size)
         ) / 2.0 AS "publicLat",
         (
           lower_bounds.lng_lower
           + LEAST(180.0, lower_bounds.lng_lower + lower_bounds.cell_size)
         ) / 2.0 AS "publicLng",
         CASE
           WHEN COALESCE(lower_bounds."radiusMeters", 0) > 0
           THEN lower_bounds."radiusMeters"
           ELSE NULL
         END AS "displayRadiusMeters",
         (
           lower_bounds."publicMapOptIn" = true
           AND COALESCE(lower_bounds."radiusMeters", 0) = 0
         ) AS "structuredGeoEligible"
    FROM lower_bounds;
END
$grainline_seller_public_location$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_location(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_location(text, text)
  TO grainline_app_runtime;

COMMIT;
