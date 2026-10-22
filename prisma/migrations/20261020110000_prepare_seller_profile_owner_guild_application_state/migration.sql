-- Replace owner Guild-application reads with one actor-bound operation. The
-- function exposes only the seller/account identity and verification fields
-- needed to decide whether a new application may be submitted.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_guild_application_state(
  p_seller_profile_id text
)
RETURNS TABLE (
  "userId" text,
  "guildLevel" text,
  "verificationStatus" text,
  "verificationReviewedAt" timestamp(3) without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_guild_application_state$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner Guild application context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller."userId"::text,
         seller."guildLevel"::text,
         verification.status::text,
         verification."reviewedAt"
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    LEFT JOIN public."MakerVerification" AS verification
      ON verification."sellerProfileId" = seller.id
   WHERE account_user.id = request_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id;
END
$grainline_seller_owner_guild_application_state$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_guild_application_state(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_guild_application_state(text)
  TO grainline_app_runtime;

COMMIT;
