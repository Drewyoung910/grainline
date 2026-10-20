-- Atomically load or create the authenticated owner's SellerProfile. This
-- removes the application-side find-then-create race and lets the existing
-- insert triggers initialize the private companion and public owner snapshot.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_bootstrap(
  p_proposed_seller_profile_id text,
  p_display_name text,
  p_display_name_normalized text
)
RETURNS TABLE (
  id text,
  "userId" text,
  "displayName" text,
  "chargesEnabled" boolean,
  "vacationMode" boolean,
  "bannerImageUrl" text,
  "avatarImageUrl" text,
  "workshopImageUrl" text,
  "galleryImageUrls" text[]
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_bootstrap$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  bootstrap_at timestamp without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_proposed_seller_profile_id IS NULL
     OR p_proposed_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_display_name IS NULL
     OR pg_catalog.length(p_display_name) NOT BETWEEN 1 AND 100
     OR p_display_name_normalized IS NULL
     OR pg_catalog.length(p_display_name_normalized) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Seller owner bootstrap input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS account_user
     WHERE account_user.id = request_user_id
       AND account_user.banned = false
       AND account_user."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller owner bootstrap context is invalid'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public."SellerProfile" (
    id,
    "userId",
    "displayName",
    "displayNameNormalized",
    "createdAt",
    "updatedAt"
  ) VALUES (
    p_proposed_seller_profile_id,
    request_user_id,
    p_display_name,
    p_display_name_normalized,
    bootstrap_at,
    bootstrap_at
  )
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  SELECT seller.id::text,
         seller."userId"::text,
         seller."displayName"::text,
         seller."chargesEnabled",
         seller."vacationMode",
         seller."bannerImageUrl"::text,
         seller."avatarImageUrl"::text,
         seller."workshopImageUrl"::text,
         seller."galleryImageUrls"
    FROM public."SellerProfile" AS seller
   WHERE seller."userId" = request_user_id;
END
$grainline_seller_owner_bootstrap$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_bootstrap(text,text,text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_bootstrap(text,text,text)
  TO grainline_app_runtime;

COMMIT;
