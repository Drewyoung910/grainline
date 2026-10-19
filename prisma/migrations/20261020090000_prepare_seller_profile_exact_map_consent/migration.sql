-- Record explicit, versioned consent before any public SellerProfile authority
-- may publish an exact point. Existing public-map opt-ins remain approximate.
-- Consent lives in the policyless private companion so broad predecessor
-- SellerProfile grants cannot forge it. Any source-location/privacy change
-- revokes consent before a new owner save can explicitly re-establish it.

BEGIN;

ALTER TABLE public."SellerProfilePrivate"
  ADD COLUMN "publicMapExactConsentAt" timestamp(3) without time zone,
  ADD COLUMN "publicMapExactConsentVersion" integer;

ALTER TABLE public."SellerProfilePrivate"
  ADD CONSTRAINT "SellerProfilePrivate_publicMapExactConsent_check"
  CHECK (
    (
      "publicMapExactConsentAt" IS NULL
      AND "publicMapExactConsentVersion" IS NULL
    )
    OR (
      "publicMapExactConsentAt" IS NOT NULL
      AND "publicMapExactConsentVersion" = 1
    )
  ) NOT VALID;

ALTER TABLE public."SellerProfilePrivate"
  VALIDATE CONSTRAINT "SellerProfilePrivate_publicMapExactConsent_check";

CREATE OR REPLACE FUNCTION public.grainline_seller_exact_map_consent_revoke()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_exact_map_consent_revoke$
BEGIN
  UPDATE public."SellerProfilePrivate"
     SET "publicMapExactConsentAt" = NULL,
         "publicMapExactConsentVersion" = NULL,
         "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
   WHERE "sellerProfileId" = NEW.id
     AND (
       "publicMapExactConsentAt" IS NOT NULL
       OR "publicMapExactConsentVersion" IS NOT NULL
     );
  RETURN NULL;
END
$grainline_seller_exact_map_consent_revoke$;

REVOKE ALL ON FUNCTION public.grainline_seller_exact_map_consent_revoke()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER "SellerProfile_exact_map_consent_revoke"
AFTER UPDATE OF lat, lng, "radiusMeters", "publicMapOptIn"
ON public."SellerProfile"
FOR EACH ROW
WHEN (
  OLD.lat IS DISTINCT FROM NEW.lat
  OR OLD.lng IS DISTINCT FROM NEW.lng
  OR OLD."radiusMeters" IS DISTINCT FROM NEW."radiusMeters"
  OR OLD."publicMapOptIn" IS DISTINCT FROM NEW."publicMapOptIn"
)
EXECUTE FUNCTION public.grainline_seller_exact_map_consent_revoke();

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_shop_settings_update(
  p_user_id text,
  p_seller_profile_id text,
  p_city text,
  p_state text,
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision,
  p_public_map_opt_in boolean,
  p_public_map_exact_consent boolean,
  p_shipping_flat_rate_cents integer,
  p_free_shipping_over_cents integer,
  p_allow_local_pickup boolean,
  p_use_calculated_shipping boolean,
  p_preferred_carriers text[],
  p_ship_from_name text,
  p_ship_from_line1 text,
  p_ship_from_line2 text,
  p_ship_from_city text,
  p_ship_from_state text,
  p_ship_from_postal text,
  p_ship_from_country text,
  p_ship_from_phone text,
  p_default_pkg_length_cm double precision,
  p_default_pkg_width_cm double precision,
  p_default_pkg_height_cm double precision,
  p_default_pkg_weight_grams integer
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_shop_settings_update$
DECLARE
  updated_seller_profile_id text;
BEGIN
  IF p_public_map_exact_consent IS NULL
     OR (
       p_public_map_exact_consent
       AND (
         p_public_map_opt_in IS DISTINCT FROM true
         OR p_lat IS NULL
         OR p_lng IS NULL
         OR p_radius_meters IS DISTINCT FROM 0
       )
     ) THEN
    RAISE EXCEPTION 'Seller exact public-map consent input is invalid'
      USING ERRCODE = '22023';
  END IF;

  updated_seller_profile_id :=
    public.grainline_seller_owner_shop_settings_update(
      p_user_id,
      p_seller_profile_id,
      p_city,
      p_state,
      p_lat,
      p_lng,
      p_radius_meters,
      p_public_map_opt_in,
      p_shipping_flat_rate_cents,
      p_free_shipping_over_cents,
      p_allow_local_pickup,
      p_use_calculated_shipping,
      p_preferred_carriers,
      p_ship_from_name,
      p_ship_from_line1,
      p_ship_from_line2,
      p_ship_from_city,
      p_ship_from_state,
      p_ship_from_postal,
      p_ship_from_country,
      p_ship_from_phone,
      p_default_pkg_length_cm,
      p_default_pkg_width_cm,
      p_default_pkg_height_cm,
      p_default_pkg_weight_grams
    );

  IF updated_seller_profile_id IS DISTINCT FROM p_seller_profile_id THEN
    RAISE EXCEPTION 'Seller owner shop-settings consent target changed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public."SellerProfilePrivate"
     SET "publicMapExactConsentAt" = CASE
           WHEN p_public_map_exact_consent
           THEN pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
           ELSE NULL
         END,
         "publicMapExactConsentVersion" = CASE
           WHEN p_public_map_exact_consent THEN 1
           ELSE NULL
         END,
         "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
   WHERE "sellerProfileId" = p_seller_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller owner shop-settings consent target changed'
      USING ERRCODE = '40001';
  END IF;

  RETURN updated_seller_profile_id;
END
$grainline_seller_owner_shop_settings_update$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_shop_settings_update(
  text, text, text, text, double precision, double precision, double precision,
  boolean, boolean, integer, integer, boolean, boolean, text[], text, text, text,
  text, text, text, text, text, double precision, double precision,
  double precision, integer
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_shop_settings_update(
  text, text, text, text, double precision, double precision, double precision,
  boolean, boolean, integer, integer, boolean, boolean, text[], text, text, text,
  text, text, text, text, text, double precision, double precision,
  double precision, integer
) TO grainline_app_runtime;

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
         CASE
           WHEN seller_private."publicMapExactConsentAt" IS NOT NULL
                AND seller_private."publicMapExactConsentVersion" = 1
           THEN seller.lat
           ELSE LEAST(
             89.975::double precision,
             GREATEST(
               (-89.975)::double precision,
               (pg_catalog.floor(seller.lat * 20.0) + 0.5) / 20.0
             )
           )
         END AS "publicLat",
         CASE
           WHEN seller_private."publicMapExactConsentAt" IS NOT NULL
                AND seller_private."publicMapExactConsentVersion" = 1
           THEN seller.lng
           ELSE LEAST(
             179.975::double precision,
             GREATEST(
               (-179.975)::double precision,
               (pg_catalog.floor(seller.lng * 20.0) + 0.5) / 20.0
             )
           )
         END AS "publicLng"
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
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
           (
             seller."publicMapOptIn" = true
             AND COALESCE(seller."radiusMeters", 0) = 0
             AND seller_private."publicMapExactConsentAt" IS NOT NULL
             AND seller_private."publicMapExactConsentVersion" = 1
           ) AS exact_public,
           CASE
             WHEN COALESCE(seller."radiusMeters", 0) > 0
             THEN seller."radiusMeters"::double precision / 111320.0
             ELSE 0.05::double precision
           END AS cell_size
      FROM public."SellerProfile" AS seller
      JOIN public."SellerProfilePrivate" AS seller_private
        ON seller_private."sellerProfileId" = seller.id
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
  SELECT CASE
           WHEN lower_bounds.exact_public THEN lower_bounds.lat
           ELSE (
             lower_bounds.lat_lower
             + LEAST(90.0, lower_bounds.lat_lower + lower_bounds.cell_size)
           ) / 2.0
         END AS "publicLat",
         CASE
           WHEN lower_bounds.exact_public THEN lower_bounds.lng
           ELSE (
             lower_bounds.lng_lower
             + LEAST(180.0, lower_bounds.lng_lower + lower_bounds.cell_size)
           ) / 2.0
         END AS "publicLng",
         CASE
           WHEN COALESCE(lower_bounds."radiusMeters", 0) > 0
           THEN lower_bounds."radiusMeters"
           ELSE NULL
         END AS "displayRadiusMeters",
         lower_bounds.exact_public AS "structuredGeoEligible"
    FROM lower_bounds;
END
$grainline_seller_public_location$;

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
     OR p_lat < -90 OR p_lat > 90
     OR p_lng IS NULL
     OR p_lng < -180 OR p_lng > 180
     OR p_radius_miles IS NULL
     OR p_radius_miles < 1 OR p_radius_miles > 500 THEN
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
           (
             seller."publicMapOptIn" = true
             AND COALESCE(seller."radiusMeters", 0) = 0
             AND seller_private."publicMapExactConsentAt" IS NOT NULL
             AND seller_private."publicMapExactConsentVersion" = 1
           ) AS exact_public,
           CASE
             WHEN COALESCE(seller."radiusMeters", 0) > 0
             THEN seller."radiusMeters"::double precision / 111320.0
             ELSE 0.05::double precision
           END AS cell_size
      FROM public."SellerProfile" AS seller
      JOIN public."SellerProfilePrivate" AS seller_private
        ON seller_private."sellerProfileId" = seller.id
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
           CASE
             WHEN lower_bounds.exact_public THEN lower_bounds.lat
             ELSE (
               lower_bounds.lat_lower
               + LEAST(90.0, lower_bounds.lat_lower + lower_bounds.cell_size)
             ) / 2.0
           END AS public_lat,
           CASE
             WHEN lower_bounds.exact_public THEN lower_bounds.lng
             ELSE (
               lower_bounds.lng_lower
               + LEAST(180.0, lower_bounds.lng_lower + lower_bounds.cell_size)
             ) / 2.0
           END AS public_lng
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

REVOKE ALL ON FUNCTION public.grainline_seller_public_map_points(integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_public_location(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_public_browse_nearby(
  double precision, double precision, double precision
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_map_points(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_location(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_browse_nearby(
  double precision, double precision, double precision
) TO grainline_app_runtime;

COMMIT;
