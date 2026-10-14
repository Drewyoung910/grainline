-- Fixed owner operations for SellerProfilePrivate application state.
-- The private companion is authoritative for reads. Mutations keep the
-- predecessor representation synchronized until older deployments drain.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_private_state(
  p_user_id text
)
RETURNS TABLE (id text, state jsonb)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_private_state$
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner private-state input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         pg_catalog.to_jsonb(seller_private)
           - 'sellerProfileId'
           - 'updatedAt'
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL;
END
$grainline_seller_owner_private_state$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_onboarding_step_update(
  p_user_id text,
  p_seller_profile_id text,
  p_expected_step integer,
  p_next_step integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_onboarding_step_update$
DECLARE
  public_step integer;
  private_step integer;
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_expected_step IS NOT NULL AND p_expected_step NOT BETWEEN 0 AND 5)
     OR p_next_step IS NULL OR p_next_step NOT BETWEEN 0 AND 5 THEN
    RAISE EXCEPTION 'Seller owner onboarding-step input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller."onboardingStep", seller_private."onboardingStep"
    INTO public_step, private_step
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller owner onboarding-step target is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF public_step IS DISTINCT FROM private_step THEN
    RAISE EXCEPTION 'Seller owner onboarding-step representations disagree'
      USING ERRCODE = '40001';
  END IF;
  IF p_expected_step IS NOT NULL AND private_step IS DISTINCT FROM p_expected_step THEN
    RETURN false;
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "onboardingStep" = p_next_step,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;
  UPDATE public."SellerProfile"
     SET "onboardingStep" = p_next_step,
         "updatedAt" = changed_at
   WHERE id = p_seller_profile_id
     AND "userId" = p_user_id;
  RETURN true;
END
$grainline_seller_owner_onboarding_step_update$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_onboarding_complete(
  p_user_id text,
  p_seller_profile_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_onboarding_complete$
DECLARE
  public_step integer;
  private_step integer;
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner onboarding-complete input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller."onboardingStep", seller_private."onboardingStep"
    INTO public_step, private_step
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id
     AND seller."chargesEnabled" = true
     AND EXISTS (
       SELECT 1
         FROM public."Listing" AS listing
        WHERE listing."sellerId" = seller.id
     )
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF public_step IS DISTINCT FROM private_step THEN
    RAISE EXCEPTION 'Seller owner onboarding-complete representations disagree'
      USING ERRCODE = '40001';
  END IF;
  IF private_step < 5 THEN
    RETURN false;
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "onboardingComplete" = true,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;
  UPDATE public."SellerProfile"
     SET "onboardingComplete" = true,
         "updatedAt" = changed_at
   WHERE id = p_seller_profile_id
     AND "userId" = p_user_id;
  RETURN true;
END
$grainline_seller_owner_onboarding_complete$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_shop_settings_update(
  p_user_id text,
  p_seller_profile_id text,
  p_city text,
  p_state text,
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision,
  p_public_map_opt_in boolean,
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
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_public_map_opt_in IS NULL
     OR p_allow_local_pickup IS NULL
     OR p_use_calculated_shipping IS NULL
     OR p_preferred_carriers IS NULL
     OR pg_catalog.cardinality(p_preferred_carriers) > 16
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(p_preferred_carriers) AS carrier(value)
        WHERE value IS NULL OR pg_catalog.char_length(value) NOT BETWEEN 1 AND 32
     )
     OR (p_lat IS NOT NULL AND (p_lat::text IN ('NaN', 'Infinity', '-Infinity') OR p_lat NOT BETWEEN -90 AND 90))
     OR (p_lng IS NOT NULL AND (p_lng::text IN ('NaN', 'Infinity', '-Infinity') OR p_lng NOT BETWEEN -180 AND 180))
     OR (p_radius_meters IS NOT NULL AND (p_radius_meters::text IN ('NaN', 'Infinity', '-Infinity') OR p_radius_meters < 0))
     OR (p_public_map_opt_in AND (p_lat IS NULL OR p_lng IS NULL OR p_radius_meters IS DISTINCT FROM 0))
     OR (p_shipping_flat_rate_cents IS NOT NULL AND p_shipping_flat_rate_cents NOT BETWEEN 0 AND 500000)
     OR (p_free_shipping_over_cents IS NOT NULL AND p_free_shipping_over_cents NOT BETWEEN 0 AND 500000)
     OR p_ship_from_country IS NULL OR p_ship_from_country !~ '^[A-Z]{2}$'
     OR (p_default_pkg_length_cm IS NOT NULL AND (p_default_pkg_length_cm::text IN ('NaN', 'Infinity', '-Infinity') OR p_default_pkg_length_cm < 0))
     OR (p_default_pkg_width_cm IS NOT NULL AND (p_default_pkg_width_cm::text IN ('NaN', 'Infinity', '-Infinity') OR p_default_pkg_width_cm < 0))
     OR (p_default_pkg_height_cm IS NOT NULL AND (p_default_pkg_height_cm::text IN ('NaN', 'Infinity', '-Infinity') OR p_default_pkg_height_cm < 0))
     OR (p_default_pkg_weight_grams IS NOT NULL AND p_default_pkg_weight_grams < 0) THEN
    RAISE EXCEPTION 'Seller owner shop-settings input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM seller.id
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id
   FOR UPDATE OF seller, seller_private;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller owner shop-settings target is unavailable'
      USING ERRCODE = '42501';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "useCalculatedShipping" = p_use_calculated_shipping,
         "preferredCarriers" = p_preferred_carriers,
         "shipFromName" = p_ship_from_name,
         "shipFromLine1" = p_ship_from_line1,
         "shipFromLine2" = p_ship_from_line2,
         "shipFromCity" = p_ship_from_city,
         "shipFromState" = p_ship_from_state,
         "shipFromPostal" = p_ship_from_postal,
         "shipFromCountry" = p_ship_from_country,
         "shipFromPhone" = p_ship_from_phone,
         "defaultPkgLengthCm" = p_default_pkg_length_cm,
         "defaultPkgWidthCm" = p_default_pkg_width_cm,
         "defaultPkgHeightCm" = p_default_pkg_height_cm,
         "defaultPkgWeightGrams" = p_default_pkg_weight_grams,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;

  UPDATE public."SellerProfile"
     SET city = p_city,
         state = p_state,
         lat = p_lat,
         lng = p_lng,
         "radiusMeters" = p_radius_meters,
         "publicMapOptIn" = p_public_map_opt_in,
         "shippingFlatRateCents" = p_shipping_flat_rate_cents,
         "freeShippingOverCents" = p_free_shipping_over_cents,
         "allowLocalPickup" = p_allow_local_pickup,
         "useCalculatedShipping" = p_use_calculated_shipping,
         "preferredCarriers" = p_preferred_carriers,
         "shipFromName" = p_ship_from_name,
         "shipFromLine1" = p_ship_from_line1,
         "shipFromLine2" = p_ship_from_line2,
         "shipFromCity" = p_ship_from_city,
         "shipFromState" = p_ship_from_state,
         "shipFromPostal" = p_ship_from_postal,
         "shipFromCountry" = p_ship_from_country,
         "shipFromPhone" = p_ship_from_phone,
         "defaultPkgLengthCm" = p_default_pkg_length_cm,
         "defaultPkgWidthCm" = p_default_pkg_width_cm,
         "defaultPkgHeightCm" = p_default_pkg_height_cm,
         "defaultPkgWeightGrams" = p_default_pkg_weight_grams,
         "updatedAt" = changed_at
   WHERE id = p_seller_profile_id
     AND "userId" = p_user_id;

  RETURN p_seller_profile_id;
END
$grainline_seller_owner_shop_settings_update$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_private_state(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_owner_onboarding_step_update(text, text, integer, integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_owner_onboarding_complete(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_owner_shop_settings_update(
  text, text, text, text, double precision, double precision, double precision,
  boolean, integer, integer, boolean, boolean, text[], text, text, text, text,
  text, text, text, text, double precision, double precision, double precision,
  integer
) FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_private_state(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_onboarding_step_update(text, text, integer, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_onboarding_complete(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_shop_settings_update(
  text, text, text, text, double precision, double precision, double precision,
  boolean, integer, integer, boolean, boolean, text[], text, text, text, text,
  text, text, text, text, double precision, double precision, double precision,
  integer
) TO grainline_app_runtime;

COMMIT;
