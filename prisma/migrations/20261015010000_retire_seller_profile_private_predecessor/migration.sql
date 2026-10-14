-- Retire the duplicated private operational columns from SellerProfile.
--
-- The exact converted application and all effective database callers now use
-- SellerProfilePrivate through fixed operations. This migration locks both
-- representations, proves full convergence, replaces every remaining dual
-- writer, preserves new-seller creation with an insert-only initializer, and
-- removes the predecessor columns atomically. It does not enable or force RLS.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE public."SellerProfile", public."SellerProfilePrivate"
  IN ACCESS EXCLUSIVE MODE;

DO $seller_profile_private_retirement_preflight$
DECLARE
  missing_private_count bigint;
  mismatch_count bigint;
BEGIN
  SELECT pg_catalog.count(*)
    INTO missing_private_count
    FROM public."SellerProfile" AS seller
    LEFT JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller_private."sellerProfileId" IS NULL;

  IF missing_private_count <> 0 THEN
    RAISE EXCEPTION
      'SellerProfile private predecessor retirement found % rows without private state',
      missing_private_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO mismatch_count
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller_private."stripeAccountId" IS DISTINCT FROM seller."stripeAccountId"
      OR seller_private."stripeAccountVersion" IS DISTINCT FROM seller."stripeAccountVersion"
      OR seller_private."stripeControllerType" IS DISTINCT FROM seller."stripeControllerType"
      OR seller_private."manualStripeReconciliationNeeded" IS DISTINCT FROM seller."manualStripeReconciliationNeeded"
      OR seller_private."manualStripeReconciliationNote" IS DISTINCT FROM seller."manualStripeReconciliationNote"
      OR seller_private."shipFromName" IS DISTINCT FROM seller."shipFromName"
      OR seller_private."shipFromLine1" IS DISTINCT FROM seller."shipFromLine1"
      OR seller_private."shipFromLine2" IS DISTINCT FROM seller."shipFromLine2"
      OR seller_private."shipFromCity" IS DISTINCT FROM seller."shipFromCity"
      OR seller_private."shipFromState" IS DISTINCT FROM seller."shipFromState"
      OR seller_private."shipFromPostal" IS DISTINCT FROM seller."shipFromPostal"
      OR seller_private."shipFromCountry" IS DISTINCT FROM seller."shipFromCountry"
      OR seller_private."shipFromPhone" IS DISTINCT FROM seller."shipFromPhone"
      OR seller_private."defaultPkgWeightGrams" IS DISTINCT FROM seller."defaultPkgWeightGrams"
      OR seller_private."defaultPkgLengthCm" IS DISTINCT FROM seller."defaultPkgLengthCm"
      OR seller_private."defaultPkgWidthCm" IS DISTINCT FROM seller."defaultPkgWidthCm"
      OR seller_private."defaultPkgHeightCm" IS DISTINCT FROM seller."defaultPkgHeightCm"
      OR seller_private."useCalculatedShipping" IS DISTINCT FROM seller."useCalculatedShipping"
      OR seller_private."preferredCarriers" IS DISTINCT FROM seller."preferredCarriers"
      OR seller_private."onboardingStep" IS DISTINCT FROM seller."onboardingStep"
      OR seller_private."onboardingComplete" IS DISTINCT FROM seller."onboardingComplete"
      OR seller_private."guildMemberApprovedAt" IS DISTINCT FROM seller."guildMemberApprovedAt"
      OR seller_private."guildMasterApprovedAt" IS DISTINCT FROM seller."guildMasterApprovedAt"
      OR seller_private."guildMasterAppliedAt" IS DISTINCT FROM seller."guildMasterAppliedAt"
      OR seller_private."guildMasterReviewNotes" IS DISTINCT FROM seller."guildMasterReviewNotes"
      OR seller_private."consecutiveMetricFailures" IS DISTINCT FROM seller."consecutiveMetricFailures"
      OR seller_private."lastMetricCheckAt" IS DISTINCT FROM seller."lastMetricCheckAt"
      OR seller_private."metricWarningSentAt" IS DISTINCT FROM seller."metricWarningSentAt"
      OR seller_private."listingsBelowThresholdSince" IS DISTINCT FROM seller."listingsBelowThresholdSince"
      OR seller_private."profileViews" IS DISTINCT FROM seller."profileViews"
      OR seller."stripeAccountSupported" IS DISTINCT FROM (
           seller_private."stripeAccountVersion" IS NULL
           OR seller_private."stripeAccountVersion" = 'v2'
         );

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION
      'SellerProfile private predecessor retirement found % divergent rows',
      mismatch_count;
  END IF;
END
$seller_profile_private_retirement_preflight$;

DROP TRIGGER "SellerProfile_supported_snapshot" ON public."SellerProfile";
DROP TRIGGER "SellerProfile_private_mirror" ON public."SellerProfile";
DROP FUNCTION public.grainline_seller_profile_supported_snapshot();
DROP FUNCTION public.grainline_seller_profile_private_mirror();

CREATE FUNCTION public.grainline_seller_profile_private_initialize()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_profile_private_initialize$
BEGIN
  INSERT INTO public."SellerProfilePrivate" (
    "sellerProfileId",
    "updatedAt"
  ) VALUES (
    NEW.id,
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  );
  RETURN NEW;
END
$grainline_seller_profile_private_initialize$;

CREATE TRIGGER "SellerProfile_private_initialize"
AFTER INSERT ON public."SellerProfile"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_seller_profile_private_initialize();

REVOKE ALL ON FUNCTION public.grainline_seller_profile_private_initialize()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

CREATE OR REPLACE FUNCTION public.grainline_seller_profile_deauthorize_compat(
  p_seller_profile_id text,
  p_account_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_profile_deauthorize_compat$
DECLARE
  seller_was_public boolean := false;
  private_account_matches boolean := false;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id = ''
     OR pg_catalog.char_length(p_seller_profile_id) > 191
     OR p_account_id IS NULL
     OR p_account_id !~ '^acct_[A-Za-z0-9_]+$'
     OR pg_catalog.char_length(p_account_id) > 255 THEN
    RAISE EXCEPTION 'Seller provider deauthorization input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT
    seller_private."stripeAccountId" = p_account_id,
    seller_private."stripeAccountId" = p_account_id
      AND seller."chargesEnabled"
    INTO private_account_matches, seller_was_public
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND OR private_account_matches IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  UPDATE public."SellerProfilePrivate" AS seller_private
     SET "stripeAccountId" = NULL,
         "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
   WHERE seller_private."sellerProfileId" = p_seller_profile_id
     AND seller_private."stripeAccountId" = p_account_id;

  -- Public availability remains visible while provider identity is cleared
  -- only from the authoritative private row.
  UPDATE public."SellerProfile" AS seller
     SET "chargesEnabled" = false
   WHERE seller.id = p_seller_profile_id;

  RETURN seller_was_public;
END
$grainline_seller_profile_deauthorize_compat$;

CREATE OR REPLACE FUNCTION public.grainline_seller_profile_reconciliation_required_compat(
  p_seller_profile_id text,
  p_seller_user_id text,
  p_note text,
  p_updated_at timestamp without time zone
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_profile_reconciliation_required_compat$
DECLARE
  target_seller_profile_id text;
BEGIN
  IF (p_seller_profile_id IS NULL) = (p_seller_user_id IS NULL)
     OR COALESCE(p_seller_profile_id, p_seller_user_id) = ''
     OR pg_catalog.char_length(COALESCE(p_seller_profile_id, p_seller_user_id)) > 191
     OR p_note IS NULL
     OR pg_catalog.char_length(p_note) NOT BETWEEN 1 AND 1000
     OR p_updated_at IS NULL THEN
    RAISE EXCEPTION 'Seller reconciliation input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_seller_profile_id IS NOT NULL THEN
    SELECT seller.id
      INTO target_seller_profile_id
      FROM public."SellerProfile" AS seller
     WHERE seller.id = p_seller_profile_id
     FOR UPDATE;
  ELSE
    SELECT seller.id
      INTO target_seller_profile_id
      FROM public."SellerProfile" AS seller
     WHERE seller."userId" = p_seller_user_id
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public."SystemAuditLog" (
      id,
      "actorType",
      "actorId",
      action,
      "targetType",
      "targetId",
      reason,
      metadata,
      "createdAt"
    )
    VALUES (
      'seller-reconciliation-skip:' || pg_catalog.gen_random_uuid()::text,
      'system',
      NULL,
      'SELLER_RECONCILIATION_FLAG_SKIPPED',
      CASE
        WHEN p_seller_profile_id IS NOT NULL THEN 'SELLER_PROFILE'
        ELSE 'USER'
      END,
      COALESCE(p_seller_profile_id, p_seller_user_id),
      'seller_profile_missing',
      pg_catalog.jsonb_build_object(
        'missingRelation', 'SellerProfile',
        'reconciliationNote', p_note,
        'requestedAt', p_updated_at
      ),
      p_updated_at
    );
    RETURN;
  END IF;

  PERFORM seller_private."sellerProfileId"
    FROM public."SellerProfilePrivate" AS seller_private
   WHERE seller_private."sellerProfileId" = target_seller_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public."SystemAuditLog" (
      id,
      "actorType",
      "actorId",
      action,
      "targetType",
      "targetId",
      reason,
      metadata,
      "createdAt"
    )
    VALUES (
      'seller-reconciliation-skip:' || pg_catalog.gen_random_uuid()::text,
      'system',
      NULL,
      'SELLER_RECONCILIATION_FLAG_SKIPPED',
      'SELLER_PROFILE',
      target_seller_profile_id,
      'seller_profile_private_missing',
      pg_catalog.jsonb_build_object(
        'missingRelation', 'SellerProfilePrivate',
        'reconciliationNote', p_note,
        'requestedAt', p_updated_at
      ),
      p_updated_at
    );
    RETURN;
  END IF;

  -- Preserve the public row's modification clock while writing the private
  -- reconciliation state through its authoritative row.
  UPDATE public."SellerProfile" AS seller
     SET "updatedAt" = p_updated_at
   WHERE seller.id = target_seller_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller reconciliation predecessor update failed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  UPDATE public."SellerProfilePrivate" AS seller_private
     SET "manualStripeReconciliationNeeded" = true,
         "manualStripeReconciliationNote" = p_note,
         "updatedAt" = p_updated_at
   WHERE seller_private."sellerProfileId" = target_seller_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller reconciliation private update failed'
      USING ERRCODE = 'serialization_failure';
  END IF;
END
$grainline_seller_profile_reconciliation_required_compat$;

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

  SELECT seller_private."stripeAccountId"
    INTO private_account_id
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
     SET "chargesEnabled" = false,
         "stripeAccountSupported" = true,
         "updatedAt" = changed_at
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = p_user_id;

  RETURN p_seller_profile_id;
END
$grainline_seller_stripe_account_bind$;

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
  RETURNING seller.id INTO updated_id;

  IF updated_id IS NULL THEN
    RAISE EXCEPTION 'Seller Stripe charges-update target changed'
      USING ERRCODE = '40001';
  END IF;
  RETURN updated_id;
END
$grainline_seller_stripe_charges_update$;

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

  SELECT seller_private."onboardingStep"
    INTO private_step
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
  IF p_expected_step IS NOT NULL AND private_step IS DISTINCT FROM p_expected_step THEN
    RETURN false;
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "onboardingStep" = p_next_step,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;
  UPDATE public."SellerProfile"
     SET "updatedAt" = changed_at
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
  private_step integer;
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller owner onboarding-complete input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller_private."onboardingStep"
    INTO private_step
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
  IF private_step < 5 THEN
    RETURN false;
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "onboardingComplete" = true,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;
  UPDATE public."SellerProfile"
     SET "updatedAt" = changed_at
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
         "updatedAt" = changed_at
   WHERE id = p_seller_profile_id
     AND "userId" = p_user_id;

  RETURN p_seller_profile_id;
END
$grainline_seller_owner_shop_settings_update$;

CREATE OR REPLACE FUNCTION public.grainline_seller_account_deletion_anonymize(
  p_seller_profile_id text,
  p_user_id text,
  p_stripe_reject_succeeded boolean,
  p_stripe_account_id text,
  p_stripe_account_version text,
  p_stripe_controller_type text,
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_account_deletion_anonymize$
DECLARE
  current_stripe_account_id text;
  reconciliation_note text;
  changed_at timestamp(3);
BEGIN
  IF p_seller_profile_id IS NULL
       OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_user_id IS NULL
       OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_stripe_reject_succeeded IS NULL
     OR (p_stripe_account_id IS NOT NULL
         AND p_stripe_account_id !~ '^acct_[A-Za-z0-9_]{1,249}$')
     OR (p_stripe_account_version IS NOT NULL
         AND pg_catalog.char_length(p_stripe_account_version) > 20)
     OR (p_stripe_controller_type IS NOT NULL
         AND pg_catalog.char_length(p_stripe_controller_type) > 100)
     OR p_side_effect_id IS NULL
       OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Seller account-deletion anonymize input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
      FROM public."AccountDeletionSideEffect" AS effect
     WHERE effect.id = p_side_effect_id
       AND effect."userId" = p_user_id
       AND effect.kind = 'LOCAL_ANONYMIZE'
       AND effect."dedupKey" = 'account-delete:local:' || p_user_id
       AND effect.payload = '{}'::jsonb
       AND effect.status = 'PROCESSING'
       AND effect."claimGeneration" = p_claim_generation
       AND effect."claimToken" = p_claim_token
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller account-deletion anonymize source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller_private."stripeAccountId"
    INTO current_stripe_account_id
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller.id = p_seller_profile_id
     AND seller."userId" = p_user_id
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account deletion seller profile ownership changed'
      USING ERRCODE = '40001';
  END IF;
  IF current_stripe_account_id IS DISTINCT FROM p_stripe_account_id THEN
    RAISE EXCEPTION 'Account deletion seller provider identity changed'
      USING ERRCODE = '40001';
  END IF;

  reconciliation_note := CASE
    WHEN p_stripe_reject_succeeded THEN NULL
    ELSE pg_catalog.format(
      'Account deletion could not reject Stripe Connect account %s (%s; %s); manual Stripe dashboard reconciliation required.',
      COALESCE(p_stripe_account_id, 'unknown'),
      COALESCE(p_stripe_account_version, 'legacy/unknown'),
      COALESCE(p_stripe_controller_type, 'controller unknown')
    )
  END;
  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';

  UPDATE public."SellerProfilePrivate"
     SET "stripeAccountId" = NULL,
         "stripeAccountVersion" = NULL,
         "stripeControllerType" = NULL,
         "manualStripeReconciliationNeeded" = NOT p_stripe_reject_succeeded,
         "manualStripeReconciliationNote" = reconciliation_note,
         "shipFromName" = NULL,
         "shipFromLine1" = NULL,
         "shipFromLine2" = NULL,
         "shipFromCity" = NULL,
         "shipFromState" = NULL,
         "shipFromPostal" = NULL,
         "shipFromCountry" = 'US',
         "shipFromPhone" = NULL,
         "defaultPkgWeightGrams" = NULL,
         "defaultPkgLengthCm" = NULL,
         "defaultPkgWidthCm" = NULL,
         "defaultPkgHeightCm" = NULL,
         "useCalculatedShipping" = false,
         "preferredCarriers" = ARRAY[]::text[],
         "guildMemberApprovedAt" = NULL,
         "guildMasterApprovedAt" = NULL,
         "guildMasterAppliedAt" = NULL,
         "guildMasterReviewNotes" = NULL,
         "consecutiveMetricFailures" = 0,
         "lastMetricCheckAt" = NULL,
         "metricWarningSentAt" = NULL,
         "listingsBelowThresholdSince" = NULL,
         "profileViews" = 0,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;

  UPDATE public."SellerProfile"
     SET "displayName" = 'Deleted maker',
         "displayNameNormalized" = 'Deleted maker',
         bio = NULL,
         city = NULL,
         state = NULL,
         lat = NULL,
         lng = NULL,
         "radiusMeters" = NULL,
         "publicMapOptIn" = false,
         "chargesEnabled" = false,
         "stripeAccountSupported" = true,
         "shippingFlatRateCents" = NULL,
         "freeShippingOverCents" = NULL,
         "allowLocalPickup" = false,
         tagline = NULL,
         "bannerImageUrl" = NULL,
         "avatarImageUrl" = NULL,
         "workshopImageUrl" = NULL,
         "storyTitle" = NULL,
         "storyBody" = NULL,
         "instagramUrl" = NULL,
         "facebookUrl" = NULL,
         "pinterestUrl" = NULL,
         "tiktokUrl" = NULL,
         "websiteUrl" = NULL,
         "yearsInBusiness" = NULL,
         "acceptsCustomOrders" = false,
         "acceptingNewOrders" = false,
         "customOrderTurnaroundDays" = NULL,
         "offersGiftWrapping" = false,
         "giftWrappingPriceCents" = NULL,
         "returnPolicy" = NULL,
         "customOrderPolicy" = NULL,
         "shippingPolicy" = NULL,
         "featuredListingIds" = ARRAY[]::text[],
         "galleryImageUrls" = ARRAY[]::text[],
         "galleryAltTexts" = ARRAY[]::text[],
         "isVerifiedMaker" = false,
         "verifiedAt" = NULL,
         "guildLevel" = 'NONE',
         "featuredUntil" = NULL,
         "metroId" = NULL,
         "cityMetroId" = NULL,
         "vacationMode" = true,
         "vacationReturnDate" = NULL,
         "vacationMessage" = NULL,
         "updatedAt" = changed_at
   WHERE id = p_seller_profile_id
     AND "userId" = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account deletion seller profile ownership changed'
      USING ERRCODE = '40001';
  END IF;

  RETURN p_seller_profile_id;
END
$grainline_seller_account_deletion_anonymize$;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_listing_threshold_sync(
  p_seller_profile_id text
)
RETURNS timestamp(3) without time zone
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_listing_threshold_sync$
DECLARE
  current_private_threshold timestamp(3) without time zone;
  active_public_listing_count bigint;
  next_threshold timestamp(3) without time zone;
  changed_at timestamp(3) without time zone;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller Guild listing-threshold input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller_private."listingsBelowThresholdSince"
    INTO current_private_threshold
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT pg_catalog.count(*)
    INTO active_public_listing_count
    FROM public."Listing" AS listing
   WHERE listing."sellerId" = p_seller_profile_id
     AND listing.status = 'ACTIVE'
     AND listing."isPrivate" = false;

  next_threshold := CASE
    WHEN active_public_listing_count < 5
      THEN COALESCE(
        current_private_threshold,
        pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      )
    ELSE NULL
  END;
  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';

  UPDATE public."SellerProfilePrivate"
     SET "listingsBelowThresholdSince" = next_threshold,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;

  UPDATE public."SellerProfile"
     SET "updatedAt" = changed_at
   WHERE id = p_seller_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller Guild listing-threshold target changed'
      USING ERRCODE = '40001';
  END IF;

  RETURN next_threshold;
END
$grainline_seller_guild_listing_threshold_sync$;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_member_revoke(
  p_seller_profile_id text
)
RETURNS TABLE (
  applied boolean,
  "auditId" text,
  reason text,
  "sellerUserId" text,
  "guardKind" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_member_revoke$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_seller public."SellerProfile"%ROWTYPE;
  source_private public."SellerProfilePrivate"%ROWTYPE;
  unresolved_case_blocked boolean := false;
  active_listing_count bigint := 0;
  revocation_reason text;
  revocation_guard_kind text;
  revocation_audit_id text;
  verification_changed integer;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller Guild Member revocation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.*
    INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF source_seller."guildLevel" <> 'GUILD_MEMBER'::public."GuildLevel" THEN
    RETURN QUERY
    SELECT false, NULL::text, NULL::text,
           source_seller."userId", NULL::text;
    RETURN;
  END IF;

  SELECT seller_private.*
    INTO source_private
    FROM public."SellerProfilePrivate" AS seller_private
   WHERE seller_private."sellerProfileId" = source_seller.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller Guild private state is missing'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT case_guard.blocked
    INTO unresolved_case_blocked
    FROM public.grainline_case_guild_unresolved_guard(
      source_seller.id
    ) AS case_guard;
  unresolved_case_blocked := COALESCE(unresolved_case_blocked, false);

  IF unresolved_case_blocked THEN
    revocation_guard_kind := 'unresolved_case';
    revocation_reason :=
      'An unresolved dispute has been open for over 90 days.';
  ELSIF source_private."listingsBelowThresholdSince" IS NOT NULL
        AND source_private."listingsBelowThresholdSince"
          < source_now - INTERVAL '30 days' THEN
    SELECT pg_catalog.count(*)::bigint
      INTO active_listing_count
      FROM public."Listing" AS listing
     WHERE listing."sellerId" = source_seller.id
       AND listing.status = 'ACTIVE'::public."ListingStatus"
       AND listing."isPrivate" = false;

    IF active_listing_count < 5 THEN
      revocation_guard_kind := 'listing_threshold';
      revocation_reason :=
        'Your shop has had fewer than 5 active listings for over 30 consecutive days.';
    END IF;
  END IF;

  IF revocation_guard_kind IS NULL THEN
    RETURN QUERY
    SELECT false, NULL::text, NULL::text,
           source_seller."userId", NULL::text;
    RETURN;
  END IF;

  UPDATE public."MakerVerification"
     SET status = 'REJECTED'::public."VerificationStatus",
         "reviewedAt" = source_now,
         "reviewNotes" = revocation_reason,
         "updatedAt" = source_now
   WHERE "sellerProfileId" = source_seller.id
     AND status IN (
       'APPROVED'::public."VerificationStatus",
       'GUILD_MASTER_REJECTED'::public."VerificationStatus"
     );
  GET DIAGNOSTICS verification_changed = ROW_COUNT;

  IF verification_changed = 0 THEN
    RETURN QUERY
    SELECT false, NULL::text, NULL::text,
           source_seller."userId", revocation_guard_kind;
    RETURN;
  END IF;

  UPDATE public."SellerProfilePrivate"
     SET "consecutiveMetricFailures" = 0,
         "metricWarningSentAt" = NULL,
         "updatedAt" = source_now
   WHERE "sellerProfileId" = source_seller.id;
  UPDATE public."SellerProfile"
     SET "guildLevel" = 'NONE'::public."GuildLevel",
         "isVerifiedMaker" = false,
         "updatedAt" = source_now
   WHERE id = source_seller.id;

  revocation_audit_id :=
    'guild-member-revocation:' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId",
    reason, metadata, "createdAt"
  ) VALUES (
    revocation_audit_id,
    'cron',
    'guild-member-check',
    'AUTO_REVOKE_GUILD_MEMBER',
    'SELLER_PROFILE',
    source_seller.id,
    revocation_reason,
    pg_catalog.jsonb_build_object(
      'jobName', 'guild-member-check',
      'sellerUserId', source_seller."userId",
      'guardKind', revocation_guard_kind
    ),
    source_now
  );

  RETURN QUERY
  SELECT true, revocation_audit_id, revocation_reason,
         source_seller."userId", revocation_guard_kind;
END
$grainline_seller_guild_member_revoke$;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_metrics_apply(
  p_seller_profile_id text,
  p_calculated_at timestamp(3) without time zone
)
RETURNS TABLE (
  action text,
  "auditId" text,
  "warningSentAt" timestamp(3) without time zone,
  "sellerUserId" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_metrics_apply$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_seller public."SellerProfile"%ROWTYPE;
  source_private public."SellerProfilePrivate"%ROWTYPE;
  source_metrics public."SellerMetrics"%ROWTYPE;
  metrics_all_met boolean;
  transition_action text;
  transition_audit_id text;
  transition_warning_at timestamp(3) without time zone;
  verification_changed integer;
BEGIN
  IF p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_calculated_at IS NULL THEN
    RAISE EXCEPTION 'Seller Guild metrics-apply input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller.*
    INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT seller_private.*
    INTO source_private
    FROM public."SellerProfilePrivate" AS seller_private
   WHERE seller_private."sellerProfileId" = source_seller.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller Guild private state is missing'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT metrics.*
    INTO source_metrics
    FROM public."SellerMetrics" AS metrics
   WHERE metrics."sellerProfileId" = source_seller.id
     AND metrics."calculatedAt" = p_calculated_at
     AND metrics."periodMonths" = 3
     AND metrics."calculatedAt" >= source_now - INTERVAL '10 minutes'
     AND metrics."calculatedAt" <= source_now + INTERVAL '1 minute'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller Guild metrics snapshot is absent, stale or replaced'
      USING ERRCODE = '22023';
  END IF;

  IF source_metrics."averageRating" < 0
     OR source_metrics."averageRating" > 5
     OR source_metrics."averageRating" = 'NaN'::double precision
     OR source_metrics."reviewCount" < 0
     OR source_metrics."onTimeShippingRate" < 0
     OR source_metrics."onTimeShippingRate" > 1
     OR source_metrics."onTimeShippingRate" = 'NaN'::double precision
     OR source_metrics."responseRate" < 0
     OR source_metrics."responseRate" > 1
     OR source_metrics."responseRate" = 'NaN'::double precision
     OR source_metrics."totalSalesCents" < 0
     OR source_metrics."completedOrderCount" < 0
     OR source_metrics."activeCaseCount" < 0
     OR source_metrics."accountAgeDays" < 0 THEN
    RAISE EXCEPTION 'Seller Guild metrics snapshot is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF source_seller."guildLevel" = 'GUILD_MEMBER'::public."GuildLevel" THEN
    UPDATE public."SellerProfilePrivate"
       SET "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE "sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "updatedAt" = source_now
     WHERE id = source_seller.id;

    RETURN QUERY
    SELECT 'MEMBER_CHECKED'::text, NULL::text,
           source_private."metricWarningSentAt", source_seller."userId";
    RETURN;
  END IF;

  IF source_seller."guildLevel" <> 'GUILD_MASTER'::public."GuildLevel" THEN
    RETURN QUERY
    SELECT 'NOOP'::text, NULL::text,
           source_private."metricWarningSentAt", source_seller."userId";
    RETURN;
  END IF;

  metrics_all_met :=
    source_metrics."averageRating" >= 4.5
    AND source_metrics."reviewCount" >= 25
    AND source_metrics."onTimeShippingRate" >= 0.95
    AND source_metrics."responseRate" >= 0.90
    AND source_metrics."accountAgeDays" >= 180
    AND source_metrics."totalSalesCents" >= 100000
    AND source_metrics."activeCaseCount" <= 0;

  IF metrics_all_met THEN
    transition_action := CASE
      WHEN source_private."consecutiveMetricFailures" > 0
        OR source_private."metricWarningSentAt" IS NOT NULL
      THEN 'MASTER_RECOVERED'
      ELSE 'MASTER_OK'
    END;

    UPDATE public."SellerProfilePrivate"
       SET "consecutiveMetricFailures" = 0,
           "metricWarningSentAt" = NULL,
           "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE "sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "updatedAt" = source_now
     WHERE id = source_seller.id;

    RETURN QUERY
    SELECT transition_action, NULL::text, NULL::timestamp(3),
           source_seller."userId";
    RETURN;
  END IF;

  IF source_private."consecutiveMetricFailures" <= 0 THEN
    transition_warning_at := source_now;
    transition_audit_id :=
      'guild-metrics-warning:' || pg_catalog.gen_random_uuid()::text;

    UPDATE public."SellerProfilePrivate"
       SET "consecutiveMetricFailures" = 1,
           "metricWarningSentAt" = transition_warning_at,
           "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE "sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "updatedAt" = source_now
     WHERE id = source_seller.id;

    INSERT INTO public."SystemAuditLog" (
      id, "actorType", "actorId", action, "targetType", "targetId",
      reason, metadata, "createdAt"
    ) VALUES (
      transition_audit_id,
      'cron',
      'guild-metrics',
      'WARN_GUILD_MASTER_METRICS',
      'SELLER_PROFILE',
      source_seller.id,
      'Guild Master metrics fell below requirements.',
      pg_catalog.jsonb_build_object(
        'jobName', 'guild-metrics',
        'sellerUserId', source_seller."userId",
        'warningSentAt', transition_warning_at,
        'metricsCalculatedAt', source_metrics."calculatedAt"
      ),
      source_now
    );

    RETURN QUERY
    SELECT 'MASTER_WARNED'::text, transition_audit_id,
           transition_warning_at, source_seller."userId";
    RETURN;
  END IF;

  transition_warning_at := COALESCE(
    source_private."metricWarningSentAt",
    source_now
  );

  IF transition_warning_at > source_now - INTERVAL '30 days' THEN
    UPDATE public."SellerProfilePrivate"
       SET "metricWarningSentAt" = transition_warning_at,
           "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE "sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "updatedAt" = source_now
     WHERE id = source_seller.id;

    RETURN QUERY
    SELECT 'MASTER_CONTINUED'::text, NULL::text,
           transition_warning_at, source_seller."userId";
    RETURN;
  END IF;

  UPDATE public."MakerVerification"
     SET status = 'GUILD_MASTER_REJECTED'::public."VerificationStatus",
         "reviewedAt" = source_now,
         "reviewNotes" =
           'Metrics fell below requirements for two consecutive months.',
         "updatedAt" = source_now
   WHERE "sellerProfileId" = source_seller.id
     AND status = 'GUILD_MASTER_APPROVED'::public."VerificationStatus";
  GET DIAGNOSTICS verification_changed = ROW_COUNT;

  IF verification_changed = 0 THEN
    RETURN QUERY
    SELECT 'NOOP'::text, NULL::text,
           transition_warning_at, source_seller."userId";
    RETURN;
  END IF;

  UPDATE public."SellerProfilePrivate"
     SET "consecutiveMetricFailures" = 0,
         "metricWarningSentAt" = NULL,
         "lastMetricCheckAt" = source_now,
         "guildMasterApprovedAt" = NULL,
         "guildMasterAppliedAt" = NULL,
         "guildMasterReviewNotes" = NULL,
         "updatedAt" = source_now
   WHERE "sellerProfileId" = source_seller.id;
  UPDATE public."SellerProfile"
     SET "guildLevel" = 'GUILD_MEMBER'::public."GuildLevel",
         "isVerifiedMaker" = true,
         "updatedAt" = source_now
   WHERE id = source_seller.id;

  transition_audit_id :=
    'guild-metrics-revocation:' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId",
    reason, metadata, "createdAt"
  ) VALUES (
    transition_audit_id,
    'cron',
    'guild-metrics',
    'AUTO_REVOKE_GUILD_MASTER',
    'SELLER_PROFILE',
    source_seller.id,
    'Metrics fell below requirements for two consecutive months.',
    pg_catalog.jsonb_build_object(
      'jobName', 'guild-metrics',
      'sellerUserId', source_seller."userId",
      'warningSentAt', transition_warning_at,
      'metricsCalculatedAt', source_metrics."calculatedAt"
    ),
    source_now
  );

  RETURN QUERY
  SELECT 'MASTER_REVOKED'::text, transition_audit_id,
         transition_warning_at, source_seller."userId";
END
$grainline_seller_guild_metrics_apply$;

CREATE OR REPLACE FUNCTION public.grainline_seller_guild_staff_transition(
  p_actor_id text,
  p_operation text,
  p_verification_id text,
  p_seller_profile_id text,
  p_review_notes text,
  p_admin_override boolean
)
RETURNS TABLE (
  applied boolean,
  "auditId" text,
  "sellerProfileId" text,
  "sellerUserId" text,
  "sellerDisplayName" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_guild_staff_transition$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_actor_role text;
  source_seller public."SellerProfile"%ROWTYPE;
  source_private public."SellerProfilePrivate"%ROWTYPE;
  source_verification public."MakerVerification"%ROWTYPE;
  active_listing_count bigint;
  unresolved_case_blocked boolean;
  audit_action text;
  audit_reason text;
  audit_metadata jsonb := '{}'::jsonb;
  audit_id text;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller Guild transition requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_operation IS NULL
     OR p_operation NOT IN (
       'APPROVE_GUILD_MEMBER', 'REJECT_GUILD_MEMBER', 'REVOKE_GUILD_MEMBER',
       'APPROVE_GUILD_MASTER', 'REJECT_GUILD_MASTER', 'REVOKE_GUILD_MASTER',
       'REINSTATE_GUILD_MEMBER'
     )
     OR p_review_notes IS DISTINCT FROM pg_catalog.left(p_review_notes, 2000)
     OR p_admin_override IS NULL THEN
    RAISE EXCEPTION 'Seller Guild transition input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_operation IN (
       'APPROVE_GUILD_MEMBER', 'REJECT_GUILD_MEMBER',
       'APPROVE_GUILD_MASTER', 'REJECT_GUILD_MASTER'
     ) THEN
    IF p_verification_id IS NULL
       OR p_verification_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR p_seller_profile_id IS NOT NULL THEN
      RAISE EXCEPTION 'Seller Guild verification transition input is invalid'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_seller_profile_id IS NULL
       OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR p_verification_id IS NOT NULL THEN
      RAISE EXCEPTION 'Seller Guild profile transition input is invalid'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_admin_override AND p_operation <> 'APPROVE_GUILD_MEMBER' THEN
    RAISE EXCEPTION 'Seller Guild override is not valid for this transition'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.role::text
    INTO source_actor_role
    FROM public."User" AS actor
   WHERE actor.id = p_actor_id
     AND actor.role::text IN ('ADMIN', 'EMPLOYEE')
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND OR (
    p_operation = 'REINSTATE_GUILD_MEMBER' AND source_actor_role <> 'ADMIN'
  ) OR (
    p_admin_override AND source_actor_role <> 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Seller Guild transition actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_verification_id IS NOT NULL THEN
    SELECT verification.*
      INTO source_verification
      FROM public."MakerVerification" AS verification
     WHERE verification.id = p_verification_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text, NULL::text;
      RETURN;
    END IF;
    SELECT seller.*
      INTO source_seller
      FROM public."SellerProfile" AS seller
     WHERE seller.id = source_verification."sellerProfileId"
     FOR UPDATE;
  ELSE
    SELECT seller.*
      INTO source_seller
      FROM public."SellerProfile" AS seller
     WHERE seller.id = p_seller_profile_id
     FOR UPDATE;
    IF FOUND THEN
      SELECT verification.*
        INTO source_verification
        FROM public."MakerVerification" AS verification
       WHERE verification."sellerProfileId" = source_seller.id
       FOR UPDATE;
    END IF;
  END IF;
  IF source_seller.id IS NULL OR source_verification.id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT seller_private.*
    INTO source_private
    FROM public."SellerProfilePrivate" AS seller_private
   WHERE seller_private."sellerProfileId" = source_seller.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller Guild private state is missing'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_operation = 'APPROVE_GUILD_MEMBER' THEN
    IF source_verification.status <> 'PENDING'::public."VerificationStatus"
       OR NOT source_seller."ownerAccountActive" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    UPDATE public."MakerVerification"
       SET status = 'APPROVED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "reviewNotes" = CASE WHEN p_admin_override
             THEN 'Admin override: $250 sales requirement waived' ELSE NULL END,
           "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "guildMemberApprovedAt" = source_now, "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "isVerifiedMaker" = true,
         "verifiedAt" = source_now,
         "guildLevel" = 'GUILD_MEMBER'::public."GuildLevel",
         "updatedAt" = source_now
     WHERE id = source_seller.id;
    audit_metadata := pg_catalog.jsonb_build_object('verificationId', source_verification.id);
  ELSIF p_operation = 'REJECT_GUILD_MEMBER' THEN
    IF source_verification.status <> 'PENDING'::public."VerificationStatus" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    UPDATE public."MakerVerification"
       SET status = 'REJECTED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "reviewNotes" = p_review_notes, "updatedAt" = source_now
     WHERE id = source_verification.id;
    audit_reason := pg_catalog.left(p_review_notes, 500);
    audit_metadata := pg_catalog.jsonb_build_object('verificationId', source_verification.id);
  ELSIF p_operation = 'REVOKE_GUILD_MEMBER' THEN
    IF source_seller."guildLevel" <> 'GUILD_MEMBER'::public."GuildLevel"
       OR source_verification.status NOT IN (
         'APPROVED'::public."VerificationStatus",
         'GUILD_MASTER_REJECTED'::public."VerificationStatus"
       ) THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    audit_reason := 'Guild Member badge revoked by Grainline staff.';
    UPDATE public."MakerVerification"
       SET status = 'REJECTED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "reviewNotes" = audit_reason, "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "consecutiveMetricFailures" = 0, "metricWarningSentAt" = NULL,
           "listingsBelowThresholdSince" = NULL, "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "guildLevel" = 'NONE'::public."GuildLevel",
         "isVerifiedMaker" = false,
         "updatedAt" = source_now
     WHERE id = source_seller.id;
  ELSIF p_operation = 'APPROVE_GUILD_MASTER' THEN
    IF source_verification.status <> 'GUILD_MASTER_PENDING'::public."VerificationStatus"
       OR NOT source_seller."ownerAccountActive"
       OR source_seller."guildLevel" <> 'GUILD_MEMBER'::public."GuildLevel" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    UPDATE public."MakerVerification"
       SET status = 'GUILD_MASTER_APPROVED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "guildMasterApprovedAt" = source_now, "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "guildLevel" = 'GUILD_MASTER'::public."GuildLevel",
         "updatedAt" = source_now
     WHERE id = source_seller.id;
    audit_metadata := pg_catalog.jsonb_build_object('verificationId', source_verification.id);
  ELSIF p_operation = 'REJECT_GUILD_MASTER' THEN
    IF source_verification.status <> 'GUILD_MASTER_PENDING'::public."VerificationStatus" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    UPDATE public."MakerVerification"
       SET status = 'GUILD_MASTER_REJECTED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "guildMasterReviewNotes" = p_review_notes, "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "updatedAt" = source_now
     WHERE id = source_seller.id;
    audit_reason := pg_catalog.left(p_review_notes, 500);
    audit_metadata := pg_catalog.jsonb_build_object('verificationId', source_verification.id);
  ELSIF p_operation = 'REVOKE_GUILD_MASTER' THEN
    IF source_seller."guildLevel" <> 'GUILD_MASTER'::public."GuildLevel"
       OR source_verification.status <> 'GUILD_MASTER_APPROVED'::public."VerificationStatus" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    audit_reason := 'Guild Master badge revoked by Grainline staff.';
    UPDATE public."MakerVerification"
       SET status = 'GUILD_MASTER_REJECTED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "reviewNotes" = audit_reason, "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "guildMasterApprovedAt" = NULL, "guildMasterAppliedAt" = NULL,
           "guildMasterReviewNotes" = NULL, "consecutiveMetricFailures" = 0,
           "metricWarningSentAt" = NULL, "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "guildLevel" = 'GUILD_MEMBER'::public."GuildLevel",
         "updatedAt" = source_now
     WHERE id = source_seller.id;
  ELSE
    IF source_seller."guildLevel" <> 'NONE'::public."GuildLevel"
       OR NOT source_seller."ownerAccountActive"
       OR source_private."guildMemberApprovedAt" IS NULL
       OR source_verification.status <> 'REJECTED'::public."VerificationStatus" THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    SELECT guard.blocked INTO unresolved_case_blocked
      FROM public.grainline_case_guild_unresolved_guard(source_seller.id) AS guard;
    IF COALESCE(unresolved_case_blocked, false) THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    SELECT pg_catalog.count(*)::bigint INTO active_listing_count
      FROM public."Listing" AS listing
     WHERE listing."sellerId" = source_seller.id
       AND listing.status = 'ACTIVE'::public."ListingStatus"
       AND listing."isPrivate" = false;
    IF active_listing_count < 5 THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id,
                          source_seller."userId", source_seller."displayName"::text;
      RETURN;
    END IF;
    UPDATE public."MakerVerification"
       SET status = 'APPROVED'::public."VerificationStatus",
           "reviewedById" = p_actor_id, "reviewedAt" = source_now,
           "reviewNotes" = NULL, "updatedAt" = source_now
     WHERE id = source_verification.id;
    UPDATE public."SellerProfilePrivate" AS seller_private
       SET "consecutiveMetricFailures" = 0, "metricWarningSentAt" = NULL,
           "listingsBelowThresholdSince" = NULL, "lastMetricCheckAt" = source_now,
           "updatedAt" = source_now
     WHERE seller_private."sellerProfileId" = source_seller.id;
    UPDATE public."SellerProfile"
       SET "guildLevel" = 'GUILD_MEMBER'::public."GuildLevel",
         "isVerifiedMaker" = true,
         "updatedAt" = source_now
     WHERE id = source_seller.id;
  END IF;

  audit_action := p_operation;
  audit_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", reason, metadata,
    undone, "createdAt"
  ) VALUES (
    audit_id, p_actor_id, audit_action, 'SELLER_PROFILE', source_seller.id,
    audit_reason, audit_metadata, false, source_now
  );

  RETURN QUERY SELECT true, audit_id, source_seller.id,
                      source_seller."userId", source_seller."displayName"::text;
END
$grainline_seller_guild_staff_transition$;

CREATE OR REPLACE FUNCTION public.grainline_seller_profile_view_record(
  p_seller_profile_id text,
  p_viewed_on date
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_profile_view_record$
DECLARE
  private_views integer;
  changed_at timestamp(3);
BEGIN
  IF p_seller_profile_id IS NULL
       OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_viewed_on IS NULL
     OR p_viewed_on IS DISTINCT FROM
       (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Seller profile-view input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT seller_private."profileViews"
    INTO private_views
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller.id = p_seller_profile_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."ownerAccountActive" = true
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF private_views >= 2147483647 THEN
    RAISE EXCEPTION 'Seller profile-view counter is exhausted'
      USING ERRCODE = '22003';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "profileViews" = "profileViews" + 1,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;
  UPDATE public."SellerProfile"
     SET "updatedAt" = changed_at
   WHERE id = p_seller_profile_id;

  INSERT INTO public."SellerProfileViewDaily" (
    id, "sellerProfileId", date, views
  ) VALUES (
    'spv_' || pg_catalog.md5(p_seller_profile_id || ':' || p_viewed_on::text),
    p_seller_profile_id,
    p_viewed_on::timestamp,
    1
  )
  ON CONFLICT ("sellerProfileId", date) DO UPDATE
    SET views = public."SellerProfileViewDaily".views + 1;

  RETURN true;
END
$grainline_seller_profile_view_record$;

CREATE OR REPLACE FUNCTION public.grainline_seller_account_deletion_reconciliation_clear(
  p_user_id text,
  p_stripe_account_id text,
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_account_deletion_reconciliation_clear$
DECLARE
  seller_profile_id text;
  private_needed boolean;
  private_note text;
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_stripe_account_id IS NULL
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]{1,249}$'
     OR p_side_effect_id IS NULL
       OR p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Seller reconciliation-clear input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_side_effect_id
     AND effect."userId" = p_user_id
     AND effect.kind = 'STRIPE_REJECT'
     AND effect.status = 'PROCESSING'
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
     AND effect.payload->>'stripeAccountId' = p_stripe_account_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller reconciliation-clear source is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.id,
         seller_private."manualStripeReconciliationNeeded",
         seller_private."manualStripeReconciliationNote"
    INTO seller_profile_id, private_needed, private_note
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."userId" = p_user_id
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF NOT private_needed
     OR private_note IS NULL
     OR pg_catalog.substr(
       private_note,
       1,
       pg_catalog.length(
         'Account deletion could not reject Stripe Connect account ' || p_stripe_account_id
       )
     ) <> 'Account deletion could not reject Stripe Connect account ' || p_stripe_account_id THEN
    RETURN false;
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "manualStripeReconciliationNeeded" = false,
         "manualStripeReconciliationNote" = NULL,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = seller_profile_id;
  UPDATE public."SellerProfile"
     SET "updatedAt" = changed_at
   WHERE id = seller_profile_id
     AND "userId" = p_user_id;

  RETURN true;
END
$grainline_seller_account_deletion_reconciliation_clear$;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_guild_master_application_record(
  p_user_id text,
  p_seller_profile_id text,
  p_applied_at timestamp without time zone
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_guild_master_application_record$
DECLARE
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL
       OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_applied_at IS NULL
     OR p_applied_at < (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes'
     OR p_applied_at > (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'Seller Guild Master application input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."User" AS account_user
    JOIN public."SellerProfile" AS seller
      ON seller."userId" = account_user.id
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
     AND seller.id = p_seller_profile_id
     AND seller."guildLevel" = 'GUILD_MEMBER'
   FOR UPDATE OF seller, seller_private;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfilePrivate"
     SET "guildMasterAppliedAt" = p_applied_at,
         "guildMasterReviewNotes" = NULL,
         "updatedAt" = changed_at
   WHERE "sellerProfileId" = p_seller_profile_id;
  UPDATE public."SellerProfile"
     SET "updatedAt" = changed_at
   WHERE id = p_seller_profile_id
     AND "userId" = p_user_id;

  RETURN true;
END
$grainline_seller_owner_guild_master_application_record$;

ALTER TABLE public."SellerProfile"
  DROP CONSTRAINT "SellerProfile_stripeAccountSupported_check",
  DROP COLUMN "stripeAccountId",
  DROP COLUMN "stripeAccountVersion",
  DROP COLUMN "stripeControllerType",
  DROP COLUMN "manualStripeReconciliationNeeded",
  DROP COLUMN "manualStripeReconciliationNote",
  DROP COLUMN "shipFromName",
  DROP COLUMN "shipFromLine1",
  DROP COLUMN "shipFromLine2",
  DROP COLUMN "shipFromCity",
  DROP COLUMN "shipFromState",
  DROP COLUMN "shipFromPostal",
  DROP COLUMN "shipFromCountry",
  DROP COLUMN "shipFromPhone",
  DROP COLUMN "defaultPkgWeightGrams",
  DROP COLUMN "defaultPkgLengthCm",
  DROP COLUMN "defaultPkgWidthCm",
  DROP COLUMN "defaultPkgHeightCm",
  DROP COLUMN "useCalculatedShipping",
  DROP COLUMN "preferredCarriers",
  DROP COLUMN "onboardingStep",
  DROP COLUMN "onboardingComplete",
  DROP COLUMN "guildMemberApprovedAt",
  DROP COLUMN "guildMasterApprovedAt",
  DROP COLUMN "guildMasterAppliedAt",
  DROP COLUMN "guildMasterReviewNotes",
  DROP COLUMN "consecutiveMetricFailures",
  DROP COLUMN "lastMetricCheckAt",
  DROP COLUMN "metricWarningSentAt",
  DROP COLUMN "listingsBelowThresholdSince",
  DROP COLUMN "profileViews";

-- Reassert helper and trigger-function isolation after replacement.
REVOKE ALL ON FUNCTION public.grainline_seller_profile_deauthorize_compat(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_seller_profile_reconciliation_required_compat(
    text, text, text, timestamp without time zone
  )
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

COMMIT;
