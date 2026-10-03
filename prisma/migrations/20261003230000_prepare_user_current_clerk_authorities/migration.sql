CREATE OR REPLACE FUNCTION public.grainline_user_clerk_actor(
  p_clerk_id text
)
RETURNS TABLE (
  id text,
  name text,
  banned boolean,
  "deletedAt" timestamp(3)
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_clerk_actor$
BEGIN
  IF p_clerk_id IS NULL
     OR p_clerk_id !~ '^[A-Za-z0-9._:-]{1,255}$' THEN
    RAISE EXCEPTION 'Clerk actor identifier is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    account_user.id,
    account_user.name::text,
    account_user.banned,
    account_user."deletedAt"
  FROM public."User" AS account_user
  WHERE account_user."clerkId" = p_clerk_id;
END
$grainline_user_clerk_actor$;

CREATE OR REPLACE FUNCTION public.grainline_user_clerk_commission_context(
  p_clerk_id text
)
RETURNS TABLE (
  id text,
  name text,
  banned boolean,
  "deletedAt" timestamp(3),
  "sellerProfileId" text,
  "sellerDisplayName" text,
  "sellerAvatarImageUrl" text,
  "sellerChargesEnabled" boolean,
  "sellerVacationMode" boolean,
  "sellerLat" double precision,
  "sellerLng" double precision,
  "sellerRadiusMeters" integer
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_clerk_commission_context$
BEGIN
  IF p_clerk_id IS NULL
     OR p_clerk_id !~ '^[A-Za-z0-9._:-]{1,255}$' THEN
    RAISE EXCEPTION 'Clerk commission identifier is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    account_user.id,
    account_user.name::text,
    account_user.banned,
    account_user."deletedAt",
    seller_profile.id,
    seller_profile."displayName"::text,
    seller_profile."avatarImageUrl"::text,
    seller_profile."chargesEnabled",
    seller_profile."vacationMode",
    seller_profile.lat,
    seller_profile.lng,
    seller_profile."radiusMeters"
  FROM public."User" AS account_user
  LEFT JOIN public."SellerProfile" AS seller_profile
    ON seller_profile."userId" = account_user.id
  WHERE account_user."clerkId" = p_clerk_id;
END
$grainline_user_clerk_commission_context$;

REVOKE ALL ON FUNCTION
  public.grainline_user_clerk_actor(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_clerk_actor(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_clerk_commission_context(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_clerk_commission_context(text)
  TO grainline_app_runtime;
