// Final SellerProfile private-boundary fixture used by production-proof tests.
// The initializer mirrors the post-retirement insert contract: public seller
// creation always materializes one private companion with safe defaults.
export const SELLER_PROFILE_PRIVATE_FIXTURE_SQL = `
  CREATE TABLE public."SellerProfilePrivate" (
    "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id) ON DELETE CASCADE,
    "stripeAccountId" varchar(255) UNIQUE,
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
    "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE FUNCTION public.grainline_test_seller_profile_private_initialize()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    INSERT INTO public."SellerProfilePrivate" ("sellerProfileId", "updatedAt")
    VALUES (NEW.id, CURRENT_TIMESTAMP);
    RETURN NEW;
  END
  $$;
  CREATE TRIGGER "SellerProfile_private_initialize"
  AFTER INSERT ON public."SellerProfile"
  FOR EACH ROW EXECUTE FUNCTION public.grainline_test_seller_profile_private_initialize();
`;
