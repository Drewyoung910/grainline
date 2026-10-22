-- Replace the final owner-side direct SellerProfile read and writes with
-- actor-bound, purpose-specific authorities. No RLS or table grants change.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_export_profile()
RETURNS TABLE (
  id text,
  profile jsonb
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_export_profile$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner export context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         pg_catalog.jsonb_build_object(
           'id', seller.id,
           'displayName', seller."displayName",
           'bio', seller.bio,
           'city', seller.city,
           'state', seller.state,
           'lat', seller.lat,
           'lng', seller.lng,
           'radiusMeters', seller."radiusMeters",
           'publicMapOptIn', seller."publicMapOptIn",
           'chargesEnabled', seller."chargesEnabled",
           'shippingFlatRateCents', seller."shippingFlatRateCents",
           'freeShippingOverCents', seller."freeShippingOverCents",
           'allowLocalPickup', seller."allowLocalPickup",
           'tagline', seller.tagline,
           'bannerImageUrl', seller."bannerImageUrl",
           'avatarImageUrl', seller."avatarImageUrl",
           'workshopImageUrl', seller."workshopImageUrl",
           'storyTitle', seller."storyTitle",
           'storyBody', seller."storyBody",
           'instagramUrl', seller."instagramUrl",
           'facebookUrl', seller."facebookUrl",
           'pinterestUrl', seller."pinterestUrl",
           'tiktokUrl', seller."tiktokUrl",
           'websiteUrl', seller."websiteUrl",
           'yearsInBusiness', seller."yearsInBusiness",
           'acceptsCustomOrders', seller."acceptsCustomOrders",
           'acceptingNewOrders', seller."acceptingNewOrders",
           'customOrderTurnaroundDays', seller."customOrderTurnaroundDays",
           'offersGiftWrapping', seller."offersGiftWrapping",
           'giftWrappingPriceCents', seller."giftWrappingPriceCents",
           'returnPolicy', seller."returnPolicy",
           'customOrderPolicy', seller."customOrderPolicy",
           'shippingPolicy', seller."shippingPolicy",
           'featuredListingIds', seller."featuredListingIds",
           'galleryImageUrls', seller."galleryImageUrls",
           'galleryAltTexts', seller."galleryAltTexts",
           'isVerifiedMaker', seller."isVerifiedMaker",
           'verifiedAt', seller."verifiedAt",
           'guildLevel', seller."guildLevel",
           'vacationMode', seller."vacationMode",
           'vacationReturnDate', seller."vacationReturnDate",
           'vacationMessage', seller."vacationMessage",
           'isFoundingMaker', seller."isFoundingMaker",
           'foundingMakerNumber', seller."foundingMakerNumber",
           'foundingMakerAt', seller."foundingMakerAt",
           'createdAt', seller."createdAt",
           'updatedAt', seller."updatedAt"
         ) AS profile
    FROM public."User" AS actor
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = actor.id
   WHERE actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL;
END
$grainline_seller_owner_export_profile$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_onboarding_step_one_update(
  p_seller_profile_id text,
  p_display_name text,
  p_display_name_normalized text,
  p_bio text,
  p_tagline text,
  p_avatar_image_url text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_onboarding_step_one_update$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  updated_id text;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner onboarding context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR ((p_display_name IS NULL) <> (p_display_name_normalized IS NULL))
     OR (p_display_name IS NOT NULL AND pg_catalog.char_length(p_display_name) NOT BETWEEN 1 AND 100)
     OR (p_display_name_normalized IS NOT NULL AND pg_catalog.char_length(p_display_name_normalized) NOT BETWEEN 1 AND 100)
     OR (p_bio IS NOT NULL AND pg_catalog.char_length(p_bio) > 500)
     OR (p_tagline IS NOT NULL AND pg_catalog.char_length(p_tagline) > 140)
     OR (p_avatar_image_url IS NOT NULL AND pg_catalog.char_length(p_avatar_image_url) > 2048) THEN
    RAISE EXCEPTION 'Seller owner onboarding step-one input is invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public."SellerProfile" AS seller
     SET "displayName" = CASE
           WHEN p_display_name IS NULL THEN seller."displayName"
           ELSE p_display_name
         END,
         "displayNameNormalized" = CASE
           WHEN p_display_name_normalized IS NULL
           THEN seller."displayNameNormalized"
           ELSE p_display_name_normalized
         END,
         bio = p_bio,
         tagline = p_tagline,
         "avatarImageUrl" = p_avatar_image_url,
         "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
    FROM public."User" AS actor
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = request_user_id
     AND actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
  RETURNING seller.id INTO updated_id;

  IF updated_id IS NULL THEN
    RAISE EXCEPTION 'Seller owner onboarding step-one target is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.grainline_seller_owner_onboarding_step_update(
    request_user_id,
    p_seller_profile_id,
    NULL,
    2
  ) THEN
    RAISE EXCEPTION 'Seller owner onboarding step one changed'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END
$grainline_seller_owner_onboarding_step_one_update$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_onboarding_step_two_update(
  p_seller_profile_id text,
  p_years_in_business integer,
  p_city text,
  p_state text,
  p_return_policy text,
  p_shipping_policy text,
  p_accepts_custom_orders boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_onboarding_step_two_update$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  updated_id text;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner onboarding context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_years_in_business IS NOT NULL AND p_years_in_business NOT BETWEEN 0 AND 100)
     OR (p_city IS NOT NULL AND pg_catalog.char_length(p_city) > 100)
     OR (p_state IS NOT NULL AND pg_catalog.char_length(p_state) > 50)
     OR (p_return_policy IS NOT NULL AND pg_catalog.char_length(p_return_policy) > 2000)
     OR (p_shipping_policy IS NOT NULL AND pg_catalog.char_length(p_shipping_policy) > 2000)
     OR p_accepts_custom_orders IS NULL THEN
    RAISE EXCEPTION 'Seller owner onboarding step-two input is invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public."SellerProfile" AS seller
     SET "yearsInBusiness" = p_years_in_business,
         city = p_city,
         state = p_state,
         "returnPolicy" = p_return_policy,
         "shippingPolicy" = p_shipping_policy,
         "acceptsCustomOrders" = p_accepts_custom_orders,
         "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
    FROM public."User" AS actor
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = request_user_id
     AND actor.id = request_user_id
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
  RETURNING seller.id INTO updated_id;

  IF updated_id IS NULL THEN
    RAISE EXCEPTION 'Seller owner onboarding step-two target is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.grainline_seller_owner_onboarding_step_update(
    request_user_id,
    p_seller_profile_id,
    NULL,
    3
  ) THEN
    RAISE EXCEPTION 'Seller owner onboarding step two changed'
      USING ERRCODE = '40001';
  END IF;
  RETURN true;
END
$grainline_seller_owner_onboarding_step_two_update$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_export_profile()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_owner_onboarding_step_one_update(
  text, text, text, text, text, text
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_owner_onboarding_step_two_update(
  text, integer, text, text, text, text, boolean
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_export_profile()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_onboarding_step_one_update(
  text, text, text, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_onboarding_step_two_update(
  text, integer, text, text, text, text, boolean
) TO grainline_app_runtime;

COMMIT;
