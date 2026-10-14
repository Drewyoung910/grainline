import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

const preparation = readFileSync(
  sellerProfilePrivateMigrationPath("20261013120000_prepare_seller_profile_private_boundary"),
  "utf8",
);
const retirement = readFileSync(
  sellerProfilePrivateMigrationPath("20261015010000_retire_seller_profile_private_predecessor"),
  "utf8",
);

test("SellerProfile private predecessor retirement applies and preserves the private authority", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;

      CREATE TABLE public."SellerProfile" (
        id text PRIMARY KEY,
        "userId" text NOT NULL UNIQUE,
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
        "displayName" text NOT NULL,
        "chargesEnabled" boolean NOT NULL DEFAULT false,
        "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE public."SystemAuditLog" (
        id text PRIMARY KEY,
        "actorType" text NOT NULL,
        "actorId" text,
        action text NOT NULL,
        "targetType" text NOT NULL,
        "targetId" text NOT NULL,
        reason text,
        metadata jsonb,
        "createdAt" timestamp(3) without time zone NOT NULL
      );
      INSERT INTO public."SellerProfile" (
        id, "userId", "stripeAccountId", "stripeAccountVersion",
        "stripeControllerType", "shipFromLine1", "shipFromCity",
        "shipFromState", "shipFromPostal", "preferredCarriers",
        "onboardingStep", "onboardingComplete", "profileViews",
        "displayName", "chargesEnabled"
      ) VALUES (
        'seller_existing', 'user_existing', 'acct_existing', 'v2',
        'express', '12 Studio Way', 'Chicago', 'IL', '60601',
        ARRAY['usps'], 4, true, 17, 'Existing Maker', true
      );
    `);
    await database.exec(preparation);
    await database.exec("SET check_function_bodies = off");
    await database.exec(retirement);

    const publicColumns = (await database.query(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'SellerProfile'
       ORDER BY column_name
    `)).rows.map((row) => row.column_name);
    assert.deepEqual(publicColumns, [
      "chargesEnabled",
      "displayName",
      "id",
      "stripeAccountSupported",
      "updatedAt",
      "userId",
    ]);

    assert.deepEqual((await database.query(`
      SELECT "stripeAccountId", "stripeAccountVersion", "stripeControllerType",
             "shipFromLine1", "preferredCarriers", "onboardingComplete", "profileViews"
        FROM public."SellerProfilePrivate"
       WHERE "sellerProfileId" = 'seller_existing'
    `)).rows, [{
      stripeAccountId: "acct_existing",
      stripeAccountVersion: "v2",
      stripeControllerType: "express",
      shipFromLine1: "12 Studio Way",
      preferredCarriers: ["usps"],
      onboardingComplete: true,
      profileViews: 17,
    }]);

    await database.exec(`
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "chargesEnabled", "updatedAt"
      ) VALUES (
        'seller_new', 'user_new', 'New Maker', false, CURRENT_TIMESTAMP
      )
    `);
    assert.deepEqual((await database.query(`
      SELECT "sellerProfileId", "stripeAccountId", "onboardingStep", "profileViews"
        FROM public."SellerProfilePrivate"
       WHERE "sellerProfileId" = 'seller_new'
    `)).rows, [{
      sellerProfileId: "seller_new",
      stripeAccountId: null,
      onboardingStep: 0,
      profileViews: 0,
    }]);

    assert.deepEqual((await database.query(`
      SELECT public.grainline_seller_profile_deauthorize_compat(
        'seller_existing', 'acct_existing'
      ) AS was_public
    `)).rows, [{ was_public: true }]);
    assert.deepEqual((await database.query(`
      SELECT seller."chargesEnabled", seller_private."stripeAccountId"
        FROM public."SellerProfile" AS seller
        JOIN public."SellerProfilePrivate" AS seller_private
          ON seller_private."sellerProfileId" = seller.id
       WHERE seller.id = 'seller_existing'
    `)).rows, [{ chargesEnabled: false, stripeAccountId: null }]);

    await database.query(`
      SELECT public.grainline_seller_profile_reconciliation_required_compat(
        NULL, 'user_new', 'manual review', TIMESTAMP '2026-10-14 12:00:00'
      )
    `);
    assert.deepEqual((await database.query(`
      SELECT "manualStripeReconciliationNeeded", "manualStripeReconciliationNote"
        FROM public."SellerProfilePrivate"
       WHERE "sellerProfileId" = 'seller_new'
    `)).rows, [{
      manualStripeReconciliationNeeded: true,
      manualStripeReconciliationNote: "manual review",
    }]);

    const catalog = (await database.query(`
      SELECT
        pg_catalog.to_regprocedure('public.grainline_seller_profile_private_mirror()') IS NULL
          AS mirror_retired,
        pg_catalog.to_regprocedure('public.grainline_seller_profile_supported_snapshot()') IS NULL
          AS snapshot_retired,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_seller_profile_private_initialize()',
          'EXECUTE'
        ) AS runtime_initializer_execute,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', 'public."SellerProfilePrivate"', 'SELECT'
        ) AS runtime_private_select,
        table_state.relrowsecurity AS rls_enabled,
        table_state.relforcerowsecurity AS rls_forced
      FROM pg_catalog.pg_class AS table_state
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = table_state.relnamespace
      WHERE namespace.nspname = 'public'
        AND table_state.relname = 'SellerProfilePrivate'
    `)).rows[0];
    assert.deepEqual(catalog, {
      mirror_retired: true,
      snapshot_retired: true,
      runtime_initializer_execute: false,
      runtime_private_select: false,
      rls_enabled: false,
      rls_forced: false,
    });
  } finally {
    await database.close();
  }
});
