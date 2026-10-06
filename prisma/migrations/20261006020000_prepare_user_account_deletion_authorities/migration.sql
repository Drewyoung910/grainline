CREATE OR REPLACE FUNCTION public.grainline_user_provider_deleted_defer(
  p_clerk_id text
)
RETURNS TABLE (id text, email text, name text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_provider_deleted_defer$
DECLARE
  changed_at timestamp(3);
BEGIN
  IF p_clerk_id IS NULL
     OR p_clerk_id !~ '^[A-Za-z0-9._:-]{1,255}$' THEN
    RAISE EXCEPTION 'Provider-deleted account identifier is invalid'
      USING ERRCODE = '22023';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  RETURN QUERY
  UPDATE public."User" AS account_user
     SET banned = true,
         "bannedAt" = changed_at,
         "banReason" = 'Clerk account deleted before Grainline deletion blockers cleared; support review required',
         "bannedBy" = 'system',
         "updatedAt" = changed_at
   WHERE account_user."clerkId" = p_clerk_id
     AND account_user."deletedAt" IS NULL
  RETURNING account_user.id, account_user.email::text, account_user.name::text;
END
$grainline_user_provider_deleted_defer$;

CREATE OR REPLACE FUNCTION public.grainline_user_account_deletion_preflight(
  p_side_effect_id text
)
RETURNS TABLE (
  "userId" text,
  "clerkId" text,
  "deletedAt" timestamp(3),
  "sellerProfileId" text,
  "stripeAccountId" text,
  "stripeAccountVersion" text,
  "stripeControllerType" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_account_deletion_preflight$
DECLARE
  source_effect record;
BEGIN
  IF p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Account-deletion side effect identifier is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT effect.id, effect."userId", effect.kind, effect."dedupKey", effect.payload, effect.status
    INTO source_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id;
  IF NOT FOUND
     OR source_effect.kind IS DISTINCT FROM 'LOCAL_ANONYMIZE'
     OR source_effect."dedupKey" IS DISTINCT FROM 'account-delete:local:' || source_effect."userId"
     OR source_effect.payload IS DISTINCT FROM '{}'::jsonb
     OR source_effect.status IS NULL
     OR source_effect.status NOT IN ('PENDING', 'PROCESSING', 'FAILED') THEN
    RAISE EXCEPTION 'Account-deletion source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT account_user.id,
         account_user."clerkId"::text,
         account_user."deletedAt",
         seller.id,
         seller."stripeAccountId"::text,
         seller."stripeAccountVersion"::text,
         seller."stripeControllerType"::text
    FROM public."User" AS account_user
    LEFT JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
   WHERE account_user.id = source_effect."userId";
END
$grainline_user_account_deletion_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_user_account_deletion_snapshot(
  p_side_effect_id text
)
RETURNS TABLE (
  "userId" text,
  "clerkId" text,
  email text,
  name text,
  "deletedAt" timestamp(3),
  "shippingName" text,
  "shippingLine1" text,
  "shippingLine2" text,
  "shippingCity" text,
  "shippingState" text,
  "shippingPostalCode" text,
  "shippingPhone" text,
  "sellerProfileId" text,
  "sellerDisplayName" text,
  "sellerCity" text,
  "sellerState" text,
  "sellerShipFromName" text,
  "sellerShipFromLine1" text,
  "sellerShipFromLine2" text,
  "sellerShipFromCity" text,
  "sellerShipFromState" text,
  "sellerShipFromPostal" text,
  "sellerShipFromPhone" text,
  "sellerTagline" text,
  "sellerBannerImageUrl" text,
  "sellerAvatarImageUrl" text,
  "sellerWorkshopImageUrl" text,
  "sellerInstagramUrl" text,
  "sellerFacebookUrl" text,
  "sellerPinterestUrl" text,
  "sellerTiktokUrl" text,
  "sellerWebsiteUrl" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_account_deletion_snapshot$
DECLARE
  discovered_user_id text;
  locked_user_id text;
  locked_effect record;
BEGIN
  IF p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Account-deletion side effect identifier is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT effect."userId"
    INTO discovered_user_id
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account-deletion source does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT account_user.id
    INTO locked_user_id
    FROM public."User" AS account_user
   WHERE account_user.id = discovered_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account-deletion User is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT effect.id, effect."userId", effect.kind, effect."dedupKey", effect.payload, effect.status
    INTO locked_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_effect."userId" IS DISTINCT FROM locked_user_id
     OR locked_effect.kind IS DISTINCT FROM 'LOCAL_ANONYMIZE'
     OR locked_effect."dedupKey" IS DISTINCT FROM 'account-delete:local:' || locked_user_id
     OR locked_effect.payload IS DISTINCT FROM '{}'::jsonb
     OR locked_effect.status IS NULL
     OR locked_effect.status NOT IN ('PENDING', 'PROCESSING', 'FAILED') THEN
    RAISE EXCEPTION 'Account-deletion source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT account_user.id,
         account_user."clerkId"::text,
         account_user.email::text,
         account_user.name::text,
         account_user."deletedAt",
         account_user."shippingName"::text,
         account_user."shippingLine1"::text,
         account_user."shippingLine2"::text,
         account_user."shippingCity"::text,
         account_user."shippingState"::text,
         account_user."shippingPostalCode"::text,
         account_user."shippingPhone"::text,
         seller.id,
         seller."displayName"::text,
         seller.city::text,
         seller.state::text,
         seller."shipFromName"::text,
         seller."shipFromLine1"::text,
         seller."shipFromLine2"::text,
         seller."shipFromCity"::text,
         seller."shipFromState"::text,
         seller."shipFromPostal"::text,
         seller."shipFromPhone"::text,
         seller.tagline::text,
         seller."bannerImageUrl"::text,
         seller."avatarImageUrl"::text,
         seller."workshopImageUrl"::text,
         seller."instagramUrl"::text,
         seller."facebookUrl"::text,
         seller."pinterestUrl"::text,
         seller."tiktokUrl"::text,
         seller."websiteUrl"::text
    FROM public."User" AS account_user
    LEFT JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
   WHERE account_user.id = locked_user_id;
END
$grainline_user_account_deletion_snapshot$;

CREATE OR REPLACE FUNCTION public.grainline_user_account_deletion_finalize(
  p_side_effect_id text
)
RETURNS TABLE (
  "userId" text,
  "clerkId" text,
  email text,
  "deletedAt" timestamp(3)
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_account_deletion_finalize$
DECLARE
  discovered_user_id text;
  locked_user record;
  locked_effect record;
  changed_at timestamp(3);
BEGIN
  IF p_side_effect_id IS NULL
     OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Account-deletion side effect identifier is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT effect."userId"
    INTO discovered_user_id
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account-deletion source does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT account_user.id, account_user."deletedAt"
    INTO locked_user
    FROM public."User" AS account_user
   WHERE account_user.id = discovered_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account-deletion User is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT effect.id, effect."userId", effect.kind, effect."dedupKey", effect.payload, effect.status
    INTO locked_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_effect."userId" IS DISTINCT FROM locked_user.id
     OR locked_effect.kind IS DISTINCT FROM 'LOCAL_ANONYMIZE'
     OR locked_effect."dedupKey" IS DISTINCT FROM 'account-delete:local:' || locked_user.id
     OR locked_effect.payload IS DISTINCT FROM '{}'::jsonb
     OR locked_effect.status IS NULL
     OR locked_effect.status NOT IN ('PENDING', 'PROCESSING', 'FAILED') THEN
    RAISE EXCEPTION 'Account-deletion source is not authorized'
      USING ERRCODE = '42501';
  END IF;
  IF locked_user."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Account-deletion User is already deleted'
      USING ERRCODE = '55000';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  RETURN QUERY
  UPDATE public."User" AS account_user
     SET "clerkId" = 'deleted:' || account_user.id || ':' ||
           pg_catalog.floor(extract(epoch FROM changed_at) * 1000)::bigint::text,
         email = 'deleted+' || account_user.id || '@deleted.thegrainline.local',
         name = NULL,
         "imageUrl" = NULL,
         "shippingName" = NULL,
         "shippingLine1" = NULL,
         "shippingLine2" = NULL,
         "shippingCity" = NULL,
         "shippingState" = NULL,
         "shippingPostalCode" = NULL,
         "shippingPhone" = NULL,
         "notificationPreferences" = '{}'::jsonb,
         role = 'USER'::public."Role",
         banned = true,
         "bannedAt" = changed_at,
         "banReason" = 'Account deleted at user''s request',
         "bannedBy" = 'system',
         "deletedAt" = changed_at,
         "updatedAt" = changed_at
   WHERE account_user.id = locked_user.id
     AND account_user."deletedAt" IS NULL
  RETURNING account_user.id,
            account_user."clerkId"::text,
            account_user.email::text,
            account_user."deletedAt";
END
$grainline_user_account_deletion_finalize$;

REVOKE ALL ON FUNCTION public.grainline_user_provider_deleted_defer(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_provider_deleted_defer(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_account_deletion_preflight(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_account_deletion_preflight(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_account_deletion_snapshot(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_account_deletion_snapshot(text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_account_deletion_finalize(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_account_deletion_finalize(text)
  TO grainline_app_runtime;
