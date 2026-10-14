-- Fixed application operations for SellerProfile private Stripe state.
--
-- SellerProfilePrivate is authoritative for provider identity reads after the
-- converted application deploy. Writes remain dual-representation during the
-- deployment-skew window so older application instances and the existing
-- mirror trigger continue to observe the same account identity.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_stripe_owner_state(
  p_user_id text
)
RETURNS TABLE (
  id text,
  "stripeAccountId" text,
  "stripeAccountVersion" text,
  "chargesEnabled" boolean,
  "shipFromCountry" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_stripe_owner_state$
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller Stripe owner-state input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller_private."stripeAccountId"::text,
         seller_private."stripeAccountVersion"::text,
         seller."chargesEnabled",
         seller_private."shipFromCountry"::text
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL;
END
$grainline_seller_stripe_owner_state$;

CREATE OR REPLACE FUNCTION public.grainline_seller_stripe_account_bind(
  p_user_id text,
  p_seller_profile_id text,
  p_stripe_account_id text,
  p_stripe_account_version text,
  p_stripe_controller_type text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_stripe_account_bind$
DECLARE
  public_account_id text;
  private_account_id text;
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_stripe_account_id IS NULL
     OR pg_catalog.char_length(p_stripe_account_id) NOT BETWEEN 6 AND 255
     OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$'
     OR p_stripe_account_version IS DISTINCT FROM 'v2'
     OR p_stripe_controller_type IS NULL
     OR pg_catalog.char_length(p_stripe_controller_type) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Seller Stripe account-bind input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller."stripeAccountId", seller_private."stripeAccountId"
    INTO public_account_id, private_account_id
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
    RAISE EXCEPTION 'Seller Stripe account-bind target is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF public_account_id IS DISTINCT FROM private_account_id THEN
    RAISE EXCEPTION 'Seller Stripe account representations disagree'
      USING ERRCODE = '40001';
  END IF;
  IF private_account_id IS NOT NULL
     AND private_account_id IS DISTINCT FROM p_stripe_account_id THEN
    RAISE EXCEPTION 'Seller Stripe account is already bound'
      USING ERRCODE = '40001';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate" AS seller_private
     SET "stripeAccountId" = p_stripe_account_id,
         "stripeAccountVersion" = p_stripe_account_version,
         "stripeControllerType" = p_stripe_controller_type,
         "updatedAt" = changed_at
   WHERE seller_private."sellerProfileId" = p_seller_profile_id;

  UPDATE public."SellerProfile" AS seller
     SET "stripeAccountId" = p_stripe_account_id,
         "stripeAccountVersion" = p_stripe_account_version,
         "stripeControllerType" = p_stripe_controller_type,
         "chargesEnabled" = false,
         "updatedAt" = changed_at
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = p_user_id;

  RETURN p_seller_profile_id;
END
$grainline_seller_stripe_account_bind$;

CREATE OR REPLACE FUNCTION public.grainline_seller_stripe_reconciliation_page(
  p_cursor_id text,
  p_take integer
)
RETURNS TABLE (
  id text,
  "stripeAccountId" text,
  "stripeAccountVersion" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_stripe_reconciliation_page$
BEGIN
  IF (p_cursor_id IS NOT NULL AND p_cursor_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR p_take IS NULL OR p_take NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Seller Stripe reconciliation-page input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller_private."stripeAccountId"::text,
         seller_private."stripeAccountVersion"::text
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller_private."stripeAccountId" IS NOT NULL
     AND (p_cursor_id IS NULL OR seller.id > p_cursor_id)
   ORDER BY seller.id ASC
   LIMIT p_take;
END
$grainline_seller_stripe_reconciliation_page$;

CREATE OR REPLACE FUNCTION public.grainline_seller_stripe_mirror_state(
  p_stripe_account_id text
)
RETURNS TABLE (
  id text,
  "userId" text,
  "ownerAccountActive" boolean,
  "chargesEnabled" boolean,
  "stripeAccountId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_stripe_mirror_state$
BEGIN
  IF p_stripe_account_id IS NULL
     OR pg_catalog.char_length(p_stripe_account_id) NOT BETWEEN 6 AND 255
     OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'Seller Stripe mirror-state input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."userId",
         seller."ownerAccountActive",
         seller."chargesEnabled",
         seller_private."stripeAccountId"::text
    FROM public."SellerProfilePrivate" AS seller_private
    JOIN public."SellerProfile" AS seller
      ON seller.id = seller_private."sellerProfileId"
   WHERE seller_private."stripeAccountId" = p_stripe_account_id;
END
$grainline_seller_stripe_mirror_state$;

CREATE OR REPLACE FUNCTION public.grainline_seller_stripe_charges_update(
  p_seller_profile_id text,
  p_stripe_account_id text,
  p_charges_enabled boolean
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_stripe_charges_update$
DECLARE
  changed_at timestamp(3);
  updated_id text;
BEGIN
  IF p_seller_profile_id IS NULL OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_stripe_account_id IS NULL
     OR pg_catalog.char_length(p_stripe_account_id) NOT BETWEEN 6 AND 255
     OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$'
     OR p_charges_enabled IS NULL THEN
    RAISE EXCEPTION 'Seller Stripe charges-update input is invalid'
      USING ERRCODE = '22023';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfile" AS seller
     SET "chargesEnabled" = p_charges_enabled,
         "updatedAt" = changed_at
    FROM public."SellerProfilePrivate" AS seller_private
   WHERE seller.id = p_seller_profile_id
     AND seller_private."sellerProfileId" = seller.id
     AND seller_private."stripeAccountId" = p_stripe_account_id
     AND seller."stripeAccountId" = p_stripe_account_id
  RETURNING seller.id INTO updated_id;

  IF updated_id IS NULL THEN
    RAISE EXCEPTION 'Seller Stripe charges-update target changed'
      USING ERRCODE = '40001';
  END IF;
  RETURN updated_id;
END
$grainline_seller_stripe_charges_update$;

REVOKE ALL ON FUNCTION public.grainline_seller_stripe_owner_state(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_stripe_account_bind(text, text, text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_stripe_reconciliation_page(text, integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_stripe_mirror_state(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_stripe_charges_update(text, text, boolean)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_stripe_owner_state(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_stripe_account_bind(text, text, text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_stripe_reconciliation_page(text, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_stripe_mirror_state(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_stripe_charges_update(text, text, boolean)
  TO grainline_app_runtime;

COMMIT;
