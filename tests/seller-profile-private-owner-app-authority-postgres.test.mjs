import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261014150000_prepare_seller_profile_private_owner_app_authorities/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountId" text,
      "stripeAccountVersion" text,
      "stripeControllerType" text,
      "manualStripeReconciliationNeeded" boolean NOT NULL DEFAULT false,
      "manualStripeReconciliationNote" text,
      "shipFromName" text,
      "shipFromLine1" text,
      "shipFromLine2" text,
      "shipFromCity" text,
      "shipFromState" text,
      "shipFromPostal" text,
      "shipFromCountry" text DEFAULT 'US',
      "shipFromPhone" text,
      "defaultPkgWeightGrams" integer,
      "defaultPkgLengthCm" double precision,
      "defaultPkgWidthCm" double precision,
      "defaultPkgHeightCm" double precision,
      "useCalculatedShipping" boolean NOT NULL DEFAULT false,
      "preferredCarriers" text[] NOT NULL DEFAULT ARRAY[]::text[],
      "onboardingStep" integer NOT NULL DEFAULT 0,
      "onboardingComplete" boolean NOT NULL DEFAULT false,
      city text,
      state text,
      lat double precision,
      lng double precision,
      "radiusMeters" double precision,
      "publicMapOptIn" boolean NOT NULL DEFAULT false,
      "shippingFlatRateCents" integer,
      "freeShippingOverCents" integer,
      "allowLocalPickup" boolean NOT NULL DEFAULT false,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "stripeAccountId" text,
      "stripeAccountVersion" text,
      "stripeControllerType" text,
      "manualStripeReconciliationNeeded" boolean NOT NULL DEFAULT false,
      "manualStripeReconciliationNote" text,
      "shipFromName" text,
      "shipFromLine1" text,
      "shipFromLine2" text,
      "shipFromCity" text,
      "shipFromState" text,
      "shipFromPostal" text,
      "shipFromCountry" text DEFAULT 'US',
      "shipFromPhone" text,
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
      "guildMasterReviewNotes" text,
      "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
      "lastMetricCheckAt" timestamp(3) without time zone,
      "metricWarningSentAt" timestamp(3) without time zone,
      "listingsBelowThresholdSince" timestamp(3) without time zone,
      "profileViews" integer NOT NULL DEFAULT 0,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id)
    );
    INSERT INTO public."User" (id) VALUES ('owner'), ('other');
    INSERT INTO public."SellerProfile" (
      id, "userId", "chargesEnabled", "stripeAccountId", "onboardingStep",
      "shipFromLine1", "defaultPkgWeightGrams"
    ) VALUES ('seller', 'owner', true, 'acct_poisoned', 1, 'Poisoned address', 9999);
    INSERT INTO public."SellerProfilePrivate" (
      "sellerProfileId", "stripeAccountId", "stripeAccountVersion",
      "shipFromLine1", "shipFromCountry", "defaultPkgWeightGrams",
      "onboardingStep"
    ) VALUES ('seller', 'acct_private', 'v2', '123 Private Lane', 'US', 450, 1);
    REVOKE ALL ON TABLE public."SellerProfilePrivate" FROM PUBLIC, grainline_app_runtime;
  `);
  await database.exec(migration);
  return database;
}

test("owner operations read private state and synchronize onboarding and settings", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const state = await database.query(`
      SELECT * FROM public.grainline_seller_owner_private_state('owner')
    `);
    assert.equal(state.rows[0].id, "seller");
    assert.equal(state.rows[0].state.stripeAccountId, "acct_private");
    assert.equal(state.rows[0].state.shipFromLine1, "123 Private Lane");
    assert.equal(state.rows[0].state.defaultPkgWeightGrams, 450);
    assert.deepEqual((await database.query(`
      SELECT * FROM public.grainline_seller_owner_private_state('other')
    `)).rows, []);

    const advanced = await database.query(`
      SELECT public.grainline_seller_owner_onboarding_step_update(
        'owner', 'seller', 1, 2
      ) AS updated
    `);
    assert.equal(advanced.rows[0].updated, true);
    const stale = await database.query(`
      SELECT public.grainline_seller_owner_onboarding_step_update(
        'owner', 'seller', 1, 3
      ) AS updated
    `);
    assert.equal(stale.rows[0].updated, false);
    await assert.rejects(
      database.query(`
        SELECT public.grainline_seller_owner_onboarding_step_update(
          'other', 'seller', 2, 3
        )
      `),
      /onboarding-step target is unavailable/,
    );

    const settings = await database.query(`
      SELECT public.grainline_seller_owner_shop_settings_update(
        'owner', 'seller', 'Austin', 'TX', 30.2, -97.7, 0, true,
        700, 5000, true, true, ARRAY['ups', 'usps']::text[],
        'Private Maker', '456 New Lane', NULL, 'Austin', 'TX', '78701',
        'US', '+15125550123', 20, 15, 10, 500
      ) AS id
    `);
    assert.equal(settings.rows[0].id, "seller");

    await database.exec("RESET ROLE");
    const representations = await database.query(`
      SELECT seller."onboardingStep" AS public_step,
             seller_private."onboardingStep" AS private_step,
             seller."shipFromLine1" AS public_line1,
             seller_private."shipFromLine1" AS private_line1,
             seller."defaultPkgWeightGrams" AS public_weight,
             seller_private."defaultPkgWeightGrams" AS private_weight
        FROM public."SellerProfile" seller
        JOIN public."SellerProfilePrivate" seller_private
          ON seller_private."sellerProfileId" = seller.id
    `);
    assert.deepEqual(representations.rows, [{
      public_step: 2,
      private_step: 2,
      public_line1: "456 New Lane",
      private_line1: "456 New Lane",
      public_weight: 500,
      private_weight: 500,
    }]);
  } finally {
    await database.close();
  }
});

test("onboarding completion rechecks prerequisites and private access stays fixed-operation only", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    let completed = await database.query(`
      SELECT public.grainline_seller_owner_onboarding_complete('owner', 'seller') AS completed
    `);
    assert.equal(completed.rows[0].completed, false);

    await database.exec("RESET ROLE");
    await database.exec(`
      UPDATE public."SellerProfile" SET "onboardingStep" = 5 WHERE id = 'seller';
      UPDATE public."SellerProfilePrivate" SET "onboardingStep" = 5 WHERE "sellerProfileId" = 'seller';
      INSERT INTO public."Listing" (id, "sellerId") VALUES ('listing', 'seller');
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    completed = await database.query(`
      SELECT public.grainline_seller_owner_onboarding_complete('owner', 'seller') AS completed
    `);
    assert.equal(completed.rows[0].completed, true);
    await assert.rejects(
      database.query(`SELECT * FROM public."SellerProfilePrivate"`),
      /permission denied for table SellerProfilePrivate/,
    );

    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(`SELECT * FROM public.grainline_seller_owner_private_state('owner')`),
      /permission denied for function/,
    );
  } finally {
    await database.close();
  }
});
