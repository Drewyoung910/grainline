-- Fixed account-deletion operations for SellerProfile private state.
-- Account deletion may run after the User has been banned or provider-deleted,
-- so these operations bind to the exact retained seller identity rather than
-- requiring an active account.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_account_deletion_pause(
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
AS $grainline_seller_account_deletion_pause$
DECLARE
  seller_profile_id text;
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_stripe_account_id IS NOT NULL
         AND p_stripe_account_id !~ '^acct_[A-Za-z0-9_]{1,249}$')
     OR ((p_side_effect_id IS NULL)::integer
         + (p_claim_generation IS NULL)::integer
         + (p_claim_token IS NULL)::integer) NOT IN (0, 3)
     OR (p_side_effect_id IS NOT NULL
         AND p_side_effect_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR (p_claim_generation IS NOT NULL AND p_claim_generation < 1) THEN
    RAISE EXCEPTION 'Seller account-deletion pause input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_side_effect_id IS NULL THEN
    IF p_stripe_account_id IS NOT NULL THEN
      RAISE EXCEPTION 'Seller account-deletion pause source is not authorized'
        USING ERRCODE = '42501';
    END IF;

    PERFORM 1
      FROM public."User" AS account_user
     WHERE account_user.id = p_user_id
       AND account_user.banned = true
       AND account_user."deletedAt" IS NULL
       AND account_user."banReason" =
         'Clerk account deleted before Grainline deletion blockers cleared; support review required'
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Seller account-deletion pause source is not authorized'
        USING ERRCODE = '42501';
    END IF;
  ELSE
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
      RAISE EXCEPTION 'Seller account-deletion pause source is not authorized'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT seller.id
    INTO seller_profile_id
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
   WHERE seller."userId" = p_user_id
     AND (p_stripe_account_id IS NULL
          OR seller_private."stripeAccountId" = p_stripe_account_id)
   FOR UPDATE OF seller, seller_private;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."SellerProfile"
     SET "chargesEnabled" = false,
         "vacationMode" = true,
         "updatedAt" = changed_at
   WHERE id = seller_profile_id
     AND "userId" = p_user_id;

  RETURN true;
END
$grainline_seller_account_deletion_pause$;

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
         "stripeAccountId" = NULL,
         "stripeAccountVersion" = NULL,
         "stripeControllerType" = NULL,
         "chargesEnabled" = false,
         "manualStripeReconciliationNeeded" = NOT p_stripe_reject_succeeded,
         "manualStripeReconciliationNote" = reconciliation_note,
         "shippingFlatRateCents" = NULL,
         "freeShippingOverCents" = NULL,
         "allowLocalPickup" = false,
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
         "guildMemberApprovedAt" = NULL,
         "guildMasterApprovedAt" = NULL,
         "guildMasterAppliedAt" = NULL,
         "guildMasterReviewNotes" = NULL,
         "consecutiveMetricFailures" = 0,
         "lastMetricCheckAt" = NULL,
         "metricWarningSentAt" = NULL,
         "listingsBelowThresholdSince" = NULL,
         "profileViews" = 0,
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

REVOKE ALL ON FUNCTION public.grainline_seller_account_deletion_pause(
  text, text, text, bigint, uuid
)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_account_deletion_anonymize(
  text, text, boolean, text, text, text, text, bigint, uuid
) FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_seller_account_deletion_pause(
  text, text, text, bigint, uuid
)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_account_deletion_anonymize(
  text, text, boolean, text, text, text, text, bigint, uuid
) TO grainline_app_runtime;

COMMIT;
