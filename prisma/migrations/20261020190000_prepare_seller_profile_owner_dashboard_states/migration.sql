-- Replace Guild and Shop Settings owner reads with actor-bound projections.
-- No RLS or direct table grant changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_guild_dashboard_state(
  p_seller_profile_id text
)
RETURNS TABLE (
  "sellerProfileId" text,
  "userId" text,
  bio text,
  "avatarImageUrl" text,
  "returnPolicy" text,
  "customOrderPolicy" text,
  "shippingPolicy" text,
  "guildLevel" text,
  "verificationStatus" text,
  "verificationReviewedAt" timestamp without time zone,
  "verificationReviewNotes" text,
  "verificationCraftDescription" text,
  "verificationYearsExperience" integer,
  "verificationPortfolioUrl" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_guild_dashboard_state$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner Guild dashboard context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner Guild dashboard input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."userId",
         seller.bio::text,
         seller."avatarImageUrl"::text,
         seller."returnPolicy"::text,
         seller."customOrderPolicy"::text,
         seller."shippingPolicy"::text,
         seller."guildLevel"::text,
         verification.status::text,
         verification."reviewedAt",
         verification."reviewNotes"::text,
         verification."craftDescription"::text,
         verification."yearsExperience",
         verification."portfolioUrl"::text
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
    LEFT JOIN public."MakerVerification" AS verification
      ON verification."sellerProfileId" = seller.id
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id;
END
$grainline_seller_owner_guild_dashboard_state$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_shop_settings_state(
  p_seller_profile_id text
)
RETURNS TABLE (
  "sellerProfileId" text,
  "chargesEnabled" boolean,
  "vacationMode" boolean,
  "vacationReturnDate" timestamp without time zone,
  "vacationMessage" text,
  city text,
  state text,
  lat double precision,
  lng double precision,
  "radiusMeters" integer,
  "publicMapOptIn" boolean,
  "shippingFlatRateCents" integer,
  "freeShippingOverCents" integer,
  "allowLocalPickup" boolean
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_shop_settings_state$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner Shop Settings context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner Shop Settings input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."chargesEnabled",
         seller."vacationMode",
         seller."vacationReturnDate",
         seller."vacationMessage"::text,
         seller.city::text,
         seller.state::text,
         seller.lat,
         seller.lng,
         seller."radiusMeters",
         seller."publicMapOptIn",
         seller."shippingFlatRateCents",
         seller."freeShippingOverCents",
         seller."allowLocalPickup"
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id;
END
$grainline_seller_owner_shop_settings_state$;

REVOKE ALL ON FUNCTION
  public.grainline_seller_owner_guild_dashboard_state(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_owner_guild_dashboard_state(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_seller_owner_shop_settings_state(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_seller_owner_shop_settings_state(text)
  TO grainline_app_runtime;

COMMIT;
