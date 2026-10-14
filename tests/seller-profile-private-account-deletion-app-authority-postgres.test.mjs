import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const migration = readFileSync(
  sellerProfilePrivateMigrationPath("20261014160000_prepare_seller_profile_private_account_deletion_app_authorities"),
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
      "deletedAt" timestamp,
      "banReason" text
    );
    CREATE TABLE public."AccountDeletionSideEffect" (
      id text PRIMARY KEY,
      "userId" text NOT NULL,
      kind text NOT NULL,
      "dedupKey" text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL,
      "claimGeneration" bigint NOT NULL,
      "claimToken" uuid
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "displayName" text NOT NULL,
      "displayNameNormalized" text NOT NULL,
      bio text, city text, state text, lat double precision, lng double precision,
      "radiusMeters" integer, "publicMapOptIn" boolean NOT NULL DEFAULT false,
      "stripeAccountId" text, "stripeAccountVersion" text,
      "stripeControllerType" text, "chargesEnabled" boolean NOT NULL DEFAULT false,
      "manualStripeReconciliationNeeded" boolean NOT NULL DEFAULT false,
      "manualStripeReconciliationNote" text,
      "shippingFlatRateCents" integer, "freeShippingOverCents" integer,
      "allowLocalPickup" boolean NOT NULL DEFAULT false,
      "shipFromName" text, "shipFromLine1" text, "shipFromLine2" text,
      "shipFromCity" text, "shipFromState" text, "shipFromPostal" text,
      "shipFromCountry" text DEFAULT 'US', "shipFromPhone" text,
      "defaultPkgWeightGrams" integer, "defaultPkgLengthCm" double precision,
      "defaultPkgWidthCm" double precision, "defaultPkgHeightCm" double precision,
      "useCalculatedShipping" boolean NOT NULL DEFAULT false,
      "preferredCarriers" text[] NOT NULL DEFAULT ARRAY[]::text[],
      tagline text, "bannerImageUrl" text, "avatarImageUrl" text,
      "workshopImageUrl" text, "storyTitle" text, "storyBody" text,
      "instagramUrl" text, "facebookUrl" text, "pinterestUrl" text,
      "tiktokUrl" text, "websiteUrl" text, "yearsInBusiness" integer,
      "acceptsCustomOrders" boolean NOT NULL DEFAULT false,
      "acceptingNewOrders" boolean NOT NULL DEFAULT true,
      "customOrderTurnaroundDays" integer,
      "offersGiftWrapping" boolean NOT NULL DEFAULT false,
      "giftWrappingPriceCents" integer, "returnPolicy" text,
      "customOrderPolicy" text, "shippingPolicy" text,
      "featuredListingIds" text[] NOT NULL DEFAULT ARRAY[]::text[],
      "galleryImageUrls" text[] NOT NULL DEFAULT ARRAY[]::text[],
      "galleryAltTexts" text[] NOT NULL DEFAULT ARRAY[]::text[],
      "isVerifiedMaker" boolean NOT NULL DEFAULT false, "verifiedAt" timestamp,
      "guildLevel" text NOT NULL DEFAULT 'NONE',
      "guildMemberApprovedAt" timestamp, "guildMasterApprovedAt" timestamp,
      "guildMasterAppliedAt" timestamp, "guildMasterReviewNotes" text,
      "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
      "lastMetricCheckAt" timestamp, "metricWarningSentAt" timestamp,
      "listingsBelowThresholdSince" timestamp, "profileViews" integer NOT NULL DEFAULT 0,
      "featuredUntil" timestamp, "metroId" text, "cityMetroId" text,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "vacationReturnDate" timestamp, "vacationMessage" text,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "stripeAccountId" text, "stripeAccountVersion" text,
      "stripeControllerType" text,
      "manualStripeReconciliationNeeded" boolean NOT NULL DEFAULT false,
      "manualStripeReconciliationNote" text,
      "shipFromName" text, "shipFromLine1" text, "shipFromLine2" text,
      "shipFromCity" text, "shipFromState" text, "shipFromPostal" text,
      "shipFromCountry" text DEFAULT 'US', "shipFromPhone" text,
      "defaultPkgWeightGrams" integer, "defaultPkgLengthCm" double precision,
      "defaultPkgWidthCm" double precision, "defaultPkgHeightCm" double precision,
      "useCalculatedShipping" boolean NOT NULL DEFAULT false,
      "preferredCarriers" text[] NOT NULL DEFAULT ARRAY[]::text[],
      "guildMemberApprovedAt" timestamp, "guildMasterApprovedAt" timestamp,
      "guildMasterAppliedAt" timestamp, "guildMasterReviewNotes" text,
      "consecutiveMetricFailures" integer NOT NULL DEFAULT 0,
      "lastMetricCheckAt" timestamp, "metricWarningSentAt" timestamp,
      "listingsBelowThresholdSince" timestamp,
      "profileViews" integer NOT NULL DEFAULT 0,
      "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO public."User" (id) VALUES ('owner');
    INSERT INTO public."User" (id, banned, "banReason") VALUES (
      'buyer_only', true,
      'Clerk account deleted before Grainline deletion blockers cleared; support review required'
    );
    INSERT INTO public."AccountDeletionSideEffect" (
      id, "userId", kind, "dedupKey", payload, status,
      "claimGeneration", "claimToken"
    ) VALUES (
      'effect', 'owner', 'LOCAL_ANONYMIZE', 'account-delete:local:owner',
      '{}'::jsonb, 'PROCESSING', 3,
      '11111111-1111-4111-8111-111111111111'::uuid
    );
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "stripeAccountId", "stripeAccountVersion", "stripeControllerType",
      "chargesEnabled", "shipFromLine1", "shipFromPhone",
      "preferredCarriers", "isVerifiedMaker", "guildLevel",
      "guildMasterReviewNotes", "consecutiveMetricFailures", "profileViews",
      "vacationMode", "galleryImageUrls", "galleryAltTexts"
    ) VALUES (
      'seller', 'owner', 'Maker', 'maker', 'acct_poisoned', 'legacy', 'legacy',
      true, 'Poisoned public address', '+15550000000', ARRAY['ups'], true,
      'MASTER', 'private staff note', 4, 99, false,
      ARRAY['https://example.invalid/image.jpg'], ARRAY['Private alt']
    );
    INSERT INTO public."SellerProfilePrivate" (
      "sellerProfileId", "stripeAccountId", "stripeAccountVersion",
      "stripeControllerType", "shipFromLine1", "shipFromPhone",
      "preferredCarriers", "guildMasterReviewNotes",
      "consecutiveMetricFailures", "profileViews"
    ) VALUES (
      'seller', 'acct_private', 'v2', 'express', '123 Private Lane',
      '+15125550123', ARRAY['usps'], 'private staff note', 4, 99
    );
    REVOKE ALL ON TABLE public."SellerProfilePrivate"
      FROM PUBLIC, grainline_app_runtime;
  `);
  await database.exec(migration);
  return database;
}

test("account-deletion pause binds to the private provider identity", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const mismatch = await database.query(`
      SELECT public.grainline_seller_account_deletion_pause(
        'owner', 'acct_poisoned', 'effect', 3,
        '11111111-1111-4111-8111-111111111111'::uuid
      ) AS paused
    `);
    assert.equal(mismatch.rows[0].paused, false);

    const paused = await database.query(`
      SELECT public.grainline_seller_account_deletion_pause(
        'owner', 'acct_private', 'effect', 3,
        '11111111-1111-4111-8111-111111111111'::uuid
      ) AS paused
    `);
    assert.equal(paused.rows[0].paused, true);
    const absent = await database.query(`
      SELECT public.grainline_seller_account_deletion_pause(
        'buyer_only', NULL, NULL, NULL, NULL
      ) AS paused
    `);
    assert.equal(absent.rows[0].paused, false);

    await database.exec("RESET ROLE");
    const seller = await database.query(`
      SELECT "chargesEnabled", "vacationMode" FROM public."SellerProfile"
    `);
    assert.deepEqual(seller.rows, [{ chargesEnabled: false, vacationMode: true }]);
  } finally {
    await database.close();
  }
});

test("account-deletion anonymize rejects a changed provider and clears both representations", async () => {
  const database = await createDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(`
        SELECT public.grainline_seller_account_deletion_anonymize(
          'seller', 'owner', false, 'acct_private', 'v2', 'express',
          'effect', 3, '22222222-2222-4222-8222-222222222222'::uuid
        )
      `),
      /source is not authorized/,
    );
    await assert.rejects(
      database.query(`
        SELECT public.grainline_seller_account_deletion_anonymize(
          'seller', 'owner', false, 'acct_poisoned', 'v2', 'express',
          'effect', 3, '11111111-1111-4111-8111-111111111111'::uuid
        )
      `),
      /provider identity changed/,
    );
    const anonymized = await database.query(`
      SELECT public.grainline_seller_account_deletion_anonymize(
        'seller', 'owner', false, 'acct_private', 'v2', 'express',
        'effect', 3, '11111111-1111-4111-8111-111111111111'::uuid
      ) AS id
    `);
    assert.equal(anonymized.rows[0].id, "seller");
    await assert.rejects(
      database.query(`SELECT * FROM public."SellerProfilePrivate"`),
      /permission denied for table SellerProfilePrivate/,
    );

    await database.exec("RESET ROLE");
    const representations = await database.query(`
      SELECT seller."displayName", seller."stripeAccountId" AS "publicAccount",
             seller_private."stripeAccountId" AS "privateAccount",
             seller."shipFromLine1" AS "publicLine1",
             seller_private."shipFromLine1" AS "privateLine1",
             seller."galleryImageUrls", seller."galleryAltTexts",
             seller."manualStripeReconciliationNeeded" AS "publicReconcile",
             seller_private."manualStripeReconciliationNeeded" AS "privateReconcile",
             seller_private."manualStripeReconciliationNote" AS "privateNote",
             seller."profileViews" AS "publicViews",
             seller_private."profileViews" AS "privateViews",
             seller."vacationMode"
        FROM public."SellerProfile" seller
        JOIN public."SellerProfilePrivate" seller_private
          ON seller_private."sellerProfileId" = seller.id
    `);
    assert.deepEqual(representations.rows, [{
      displayName: "Deleted maker",
      publicAccount: null,
      privateAccount: null,
      publicLine1: null,
      privateLine1: null,
      galleryImageUrls: [],
      galleryAltTexts: [],
      publicReconcile: true,
      privateReconcile: true,
      privateNote: "Account deletion could not reject Stripe Connect account acct_private (v2; express); manual Stripe dashboard reconciliation required.",
      publicViews: 0,
      privateViews: 0,
      vacationMode: true,
    }]);

    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(`
        SELECT public.grainline_seller_account_deletion_pause(
          'owner', NULL, NULL, NULL, NULL
        )
      `),
      /permission denied for function/,
    );
  } finally {
    await database.close();
  }
});
