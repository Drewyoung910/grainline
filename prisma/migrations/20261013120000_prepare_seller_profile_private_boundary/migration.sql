-- Additive SellerProfile private-boundary preparation.
--
-- SellerProfile remains the authoritative predecessor representation during
-- the deployment-skew window. This migration copies private operational state
-- into a zero-direct-runtime companion and keeps it current from predecessor
-- writes. It does not remove a column, change an application caller, enable
-- RLS, or revoke existing SellerProfile authority.

BEGIN;

-- Fail closed instead of waiting indefinitely for the table lock or an
-- unexpectedly slow backfill on the Production writer.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public."SellerProfile"
  ADD COLUMN "stripeAccountSupported" boolean NOT NULL DEFAULT true;

UPDATE public."SellerProfile"
SET "stripeAccountSupported" = (
  "stripeAccountVersion" IS NULL OR "stripeAccountVersion" = 'v2'
);

ALTER TABLE public."SellerProfile"
  ADD CONSTRAINT "SellerProfile_stripeAccountSupported_check"
  CHECK (
    "stripeAccountSupported" = (
      "stripeAccountVersion" IS NULL OR "stripeAccountVersion" = 'v2'
    )
  );

CREATE TABLE public."SellerProfilePrivate" (
  "sellerProfileId" text NOT NULL,
  "stripeAccountId" varchar(255),
  "stripeAccountVersion" varchar(20),
  "stripeControllerType" varchar(100),
  "manualStripeReconciliationNeeded" boolean NOT NULL DEFAULT false,
  "manualStripeReconciliationNote" varchar(1000),
  "shipFromName" varchar(100),
  "shipFromLine1" varchar(200),
  "shipFromLine2" varchar(200),
  "shipFromCity" varchar(100),
  "shipFromState" varchar(50),
  "shipFromPostal" varchar(20),
  "shipFromCountry" varchar(2) DEFAULT 'US',
  "shipFromPhone" varchar(30),
  "defaultPkgWeightGrams" integer,
  "defaultPkgLengthCm" double precision,
  "defaultPkgWidthCm" double precision,
  "defaultPkgHeightCm" double precision,
  "useCalculatedShipping" boolean NOT NULL DEFAULT false,
  "preferredCarriers" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "onboardingStep" integer NOT NULL DEFAULT 0,
  "onboardingComplete" boolean NOT NULL DEFAULT false,
  "guildMemberApprovedAt" timestamp(3) without time zone,
  "guildMasterApprovedAt" timestamp(3) without time zone,
  "guildMasterAppliedAt" timestamp(3) without time zone,
  "guildMasterReviewNotes" varchar(2000),
  "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
  "lastMetricCheckAt" timestamp(3) without time zone,
  "metricWarningSentAt" timestamp(3) without time zone,
  "listingsBelowThresholdSince" timestamp(3) without time zone,
  "profileViews" integer NOT NULL DEFAULT 0,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  CONSTRAINT "SellerProfilePrivate_pkey" PRIMARY KEY ("sellerProfileId"),
  CONSTRAINT "SellerProfilePrivate_sellerProfileId_fkey"
    FOREIGN KEY ("sellerProfileId")
    REFERENCES public."SellerProfile"(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "SellerProfilePrivate_defaultPkgWeightGrams_check"
    CHECK ("defaultPkgWeightGrams" IS NULL OR "defaultPkgWeightGrams" >= 0),
  CONSTRAINT "SellerProfilePrivate_defaultPkgLengthCm_check"
    CHECK ("defaultPkgLengthCm" IS NULL OR "defaultPkgLengthCm" >= 0),
  CONSTRAINT "SellerProfilePrivate_defaultPkgWidthCm_check"
    CHECK ("defaultPkgWidthCm" IS NULL OR "defaultPkgWidthCm" >= 0),
  CONSTRAINT "SellerProfilePrivate_defaultPkgHeightCm_check"
    CHECK ("defaultPkgHeightCm" IS NULL OR "defaultPkgHeightCm" >= 0),
  CONSTRAINT "SellerProfilePrivate_consecutiveMetricFailures_check"
    CHECK ("consecutiveMetricFailures" >= 0),
  CONSTRAINT "SellerProfilePrivate_onboardingStep_check"
    CHECK ("onboardingStep" >= 0),
  CONSTRAINT "SellerProfilePrivate_profileViews_check"
    CHECK ("profileViews" >= 0)
);

CREATE UNIQUE INDEX "SellerProfilePrivate_stripeAccountId_key"
  ON public."SellerProfilePrivate"("stripeAccountId");

INSERT INTO public."SellerProfilePrivate" (
  "sellerProfileId",
  "stripeAccountId",
  "stripeAccountVersion",
  "stripeControllerType",
  "manualStripeReconciliationNeeded",
  "manualStripeReconciliationNote",
  "shipFromName",
  "shipFromLine1",
  "shipFromLine2",
  "shipFromCity",
  "shipFromState",
  "shipFromPostal",
  "shipFromCountry",
  "shipFromPhone",
  "defaultPkgWeightGrams",
  "defaultPkgLengthCm",
  "defaultPkgWidthCm",
  "defaultPkgHeightCm",
  "useCalculatedShipping",
  "preferredCarriers",
  "onboardingStep",
  "onboardingComplete",
  "guildMemberApprovedAt",
  "guildMasterApprovedAt",
  "guildMasterAppliedAt",
  "guildMasterReviewNotes",
  "consecutiveMetricFailures",
  "lastMetricCheckAt",
  "metricWarningSentAt",
  "listingsBelowThresholdSince",
  "profileViews",
  "updatedAt"
)
SELECT
  source.id,
  source."stripeAccountId",
  source."stripeAccountVersion",
  source."stripeControllerType",
  source."manualStripeReconciliationNeeded",
  source."manualStripeReconciliationNote",
  source."shipFromName",
  source."shipFromLine1",
  source."shipFromLine2",
  source."shipFromCity",
  source."shipFromState",
  source."shipFromPostal",
  source."shipFromCountry",
  source."shipFromPhone",
  source."defaultPkgWeightGrams",
  source."defaultPkgLengthCm",
  source."defaultPkgWidthCm",
  source."defaultPkgHeightCm",
  source."useCalculatedShipping",
  source."preferredCarriers",
  source."onboardingStep",
  source."onboardingComplete",
  source."guildMemberApprovedAt",
  source."guildMasterApprovedAt",
  source."guildMasterAppliedAt",
  source."guildMasterReviewNotes",
  source."consecutiveMetricFailures",
  source."lastMetricCheckAt",
  source."metricWarningSentAt",
  source."listingsBelowThresholdSince",
  source."profileViews",
  pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
FROM public."SellerProfile" AS source;

CREATE OR REPLACE FUNCTION public.grainline_seller_profile_supported_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW."stripeAccountSupported" := (
    NEW."stripeAccountVersion" IS NULL
    OR NEW."stripeAccountVersion" = 'v2'
  );
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.grainline_seller_profile_private_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  INSERT INTO public."SellerProfilePrivate" (
    "sellerProfileId",
    "stripeAccountId",
    "stripeAccountVersion",
    "stripeControllerType",
    "manualStripeReconciliationNeeded",
    "manualStripeReconciliationNote",
    "shipFromName",
    "shipFromLine1",
    "shipFromLine2",
    "shipFromCity",
    "shipFromState",
    "shipFromPostal",
    "shipFromCountry",
    "shipFromPhone",
    "defaultPkgWeightGrams",
    "defaultPkgLengthCm",
    "defaultPkgWidthCm",
    "defaultPkgHeightCm",
    "useCalculatedShipping",
    "preferredCarriers",
    "onboardingStep",
    "onboardingComplete",
    "guildMemberApprovedAt",
    "guildMasterApprovedAt",
    "guildMasterAppliedAt",
    "guildMasterReviewNotes",
    "consecutiveMetricFailures",
    "lastMetricCheckAt",
    "metricWarningSentAt",
    "listingsBelowThresholdSince",
    "profileViews",
    "updatedAt"
  ) VALUES (
    NEW.id,
    NEW."stripeAccountId",
    NEW."stripeAccountVersion",
    NEW."stripeControllerType",
    NEW."manualStripeReconciliationNeeded",
    NEW."manualStripeReconciliationNote",
    NEW."shipFromName",
    NEW."shipFromLine1",
    NEW."shipFromLine2",
    NEW."shipFromCity",
    NEW."shipFromState",
    NEW."shipFromPostal",
    NEW."shipFromCountry",
    NEW."shipFromPhone",
    NEW."defaultPkgWeightGrams",
    NEW."defaultPkgLengthCm",
    NEW."defaultPkgWidthCm",
    NEW."defaultPkgHeightCm",
    NEW."useCalculatedShipping",
    NEW."preferredCarriers",
    NEW."onboardingStep",
    NEW."onboardingComplete",
    NEW."guildMemberApprovedAt",
    NEW."guildMasterApprovedAt",
    NEW."guildMasterAppliedAt",
    NEW."guildMasterReviewNotes",
    NEW."consecutiveMetricFailures",
    NEW."lastMetricCheckAt",
    NEW."metricWarningSentAt",
    NEW."listingsBelowThresholdSince",
    NEW."profileViews",
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  )
  ON CONFLICT ("sellerProfileId") DO UPDATE SET
    "stripeAccountId" = EXCLUDED."stripeAccountId",
    "stripeAccountVersion" = EXCLUDED."stripeAccountVersion",
    "stripeControllerType" = EXCLUDED."stripeControllerType",
    "manualStripeReconciliationNeeded" = EXCLUDED."manualStripeReconciliationNeeded",
    "manualStripeReconciliationNote" = EXCLUDED."manualStripeReconciliationNote",
    "shipFromName" = EXCLUDED."shipFromName",
    "shipFromLine1" = EXCLUDED."shipFromLine1",
    "shipFromLine2" = EXCLUDED."shipFromLine2",
    "shipFromCity" = EXCLUDED."shipFromCity",
    "shipFromState" = EXCLUDED."shipFromState",
    "shipFromPostal" = EXCLUDED."shipFromPostal",
    "shipFromCountry" = EXCLUDED."shipFromCountry",
    "shipFromPhone" = EXCLUDED."shipFromPhone",
    "defaultPkgWeightGrams" = EXCLUDED."defaultPkgWeightGrams",
    "defaultPkgLengthCm" = EXCLUDED."defaultPkgLengthCm",
    "defaultPkgWidthCm" = EXCLUDED."defaultPkgWidthCm",
    "defaultPkgHeightCm" = EXCLUDED."defaultPkgHeightCm",
    "useCalculatedShipping" = EXCLUDED."useCalculatedShipping",
    "preferredCarriers" = EXCLUDED."preferredCarriers",
    "onboardingStep" = EXCLUDED."onboardingStep",
    "onboardingComplete" = EXCLUDED."onboardingComplete",
    "guildMemberApprovedAt" = EXCLUDED."guildMemberApprovedAt",
    "guildMasterApprovedAt" = EXCLUDED."guildMasterApprovedAt",
    "guildMasterAppliedAt" = EXCLUDED."guildMasterAppliedAt",
    "guildMasterReviewNotes" = EXCLUDED."guildMasterReviewNotes",
    "consecutiveMetricFailures" = EXCLUDED."consecutiveMetricFailures",
    "lastMetricCheckAt" = EXCLUDED."lastMetricCheckAt",
    "metricWarningSentAt" = EXCLUDED."metricWarningSentAt",
    "listingsBelowThresholdSince" = EXCLUDED."listingsBelowThresholdSince",
    "profileViews" = EXCLUDED."profileViews",
    "updatedAt" = EXCLUDED."updatedAt";

  RETURN NEW;
END
$function$;

CREATE TRIGGER "SellerProfile_supported_snapshot"
BEFORE INSERT OR UPDATE OF "stripeAccountVersion", "stripeAccountSupported"
ON public."SellerProfile"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_seller_profile_supported_snapshot();

CREATE TRIGGER "SellerProfile_private_mirror"
AFTER INSERT OR UPDATE OF
  "stripeAccountId",
  "stripeAccountVersion",
  "stripeControllerType",
  "manualStripeReconciliationNeeded",
  "manualStripeReconciliationNote",
  "shipFromName",
  "shipFromLine1",
  "shipFromLine2",
  "shipFromCity",
  "shipFromState",
  "shipFromPostal",
  "shipFromCountry",
  "shipFromPhone",
  "defaultPkgWeightGrams",
  "defaultPkgLengthCm",
  "defaultPkgWidthCm",
  "defaultPkgHeightCm",
  "useCalculatedShipping",
  "preferredCarriers",
  "onboardingStep",
  "onboardingComplete",
  "guildMemberApprovedAt",
  "guildMasterApprovedAt",
  "guildMasterAppliedAt",
  "guildMasterReviewNotes",
  "consecutiveMetricFailures",
  "lastMetricCheckAt",
  "metricWarningSentAt",
  "listingsBelowThresholdSince",
  "profileViews"
ON public."SellerProfile"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_seller_profile_private_mirror();

REVOKE ALL ON TABLE public."SellerProfilePrivate" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_seller_profile_supported_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_seller_profile_private_mirror() FROM PUBLIC;

DO $revoke_runtime$
BEGIN
  IF pg_catalog.to_regrole('grainline_app_runtime') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public."SellerProfilePrivate" FROM grainline_app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.grainline_seller_profile_supported_snapshot() FROM grainline_app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.grainline_seller_profile_private_mirror() FROM grainline_app_runtime';
  END IF;
END
$revoke_runtime$;

COMMIT;
