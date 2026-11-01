import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationPath =
  "prisma/migrations/20261101010000_prepare_seller_analytics_daily_authorities/migration.sql";

describe("seller analytics daily compatible preparation", () => {
  it("adds validated invariants and purpose-bound functions without activating RLS", () => {
    const migration = source(migrationPath);

    for (const constraint of [
      "ListingViewDaily_counts_non_negative_chk",
      "ListingViewDaily_date_midnight_utc_chk",
      "SellerProfileViewDaily_views_non_negative_chk",
      "SellerProfileViewDaily_date_midnight_utc_chk",
    ]) {
      assert.match(migration, new RegExp(`ADD CONSTRAINT "${constraint}"`));
      assert.match(migration, new RegExp(`VALIDATE CONSTRAINT "${constraint}"`));
    }
    for (const signature of [
      "grainline_listing_analytics_record",
      "grainline_seller_profile_view_record",
      "grainline_seller_engagement_analytics",
      "grainline_seller_analytics_retention_prune",
      "grainline_seller_profile_view_daily_account_deletion_clear",
    ]) {
      assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION(?:\\s+public\\.)?${signature}`));
    }
    assert.match(migration, /SECURITY DEFINER/g);
    assert.match(migration, /SET search_path = pg_catalog/g);
    assert.match(migration, /ListingViewDaily contains invalid predecessor rows/);
    assert.match(migration, /daily\.views >= 2147483647/);
    assert.match(migration, /daily\.clicks >= 2147483647/);
    assert.match(migration, /Listing analytics seller identity drifted/);
    assert.match(migration, /effect\."claimGeneration" = p_claim_generation/);
    assert.match(migration, /effect\."claimToken" = p_claim_token/);
    assert.match(migration, /Seller analytics daily RLS changed during compatible preparation/);
    assert.match(migration, /Seller analytics daily postflight inventory drifted/);
    assert.match(migration, /Seller analytics predecessor runtime CRUD drifted/);
    assert.match(migration, /NOT EXISTS \(\s*SELECT 1\s*FROM public\."ListingViewDaily"/s);
    assert.match(migration, /NOT EXISTS \(\s*SELECT 1\s*FROM public\."SellerProfileViewDaily"/s);
    assert.doesNotMatch(migration, /ALTER TABLE public\."(?:ListingViewDaily|SellerProfileViewDaily)"\s+(?:ENABLE|FORCE|DISABLE|NO FORCE) ROW LEVEL SECURITY/);
    assert.doesNotMatch(migration, /REVOKE [^;]* ON TABLE public\."(?:ListingViewDaily|SellerProfileViewDaily)"/s);
    assert.doesNotMatch(migration, /CREATE POLICY/);
  });

  it("keeps the hot telemetry writer atomic and derives seller identity in SQL", () => {
    const migration = source(migrationPath);
    const writer = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.grainline_listing_analytics_record"),
      migration.indexOf("-- Harden the retained profile recorder"),
    );

    assert.match(writer, /JOIN public\."SellerProfile" AS seller/);
    assert.match(writer, /listing\."sellerId"/);
    assert.match(writer, /listing\.status = 'ACTIVE'/);
    assert.match(writer, /listing\."isPrivate" = false/);
    assert.match(writer, /listing\."sellerPubliclyOrderable" = true/);
    assert.match(writer, /FOR UPDATE OF listing/);
    assert.match(writer, /request_user_id = source_owner_user_id/);
    assert.match(writer, /FOR UPDATE;/);
    assert.match(writer, /UPDATE public\."Listing"/);
    assert.match(writer, /INSERT INTO public\."ListingViewDaily"/);
    assert.match(writer, /Listing analytics daily counter is exhausted/);
  });

  it("moves every reviewed direct daily-table operation behind the fixed access module", () => {
    const access = source("src/lib/sellerAnalyticsDailyAccess.ts");
    const analytics = source("src/app/api/seller/analytics/route.ts");
    const cron = source("src/app/api/cron/guild-metrics/route.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const provisioning = source("scripts/provision-runtime-db-role.sql");

    assert.match(access, /grainline_listing_analytics_record/);
    assert.match(access, /grainline_seller_engagement_analytics/);
    assert.match(access, /grainline_seller_analytics_retention_prune/);
    assert.match(access, /grainline_seller_profile_view_daily_account_deletion_clear/);
    assert.match(access, /withDbUserContext\(actorUserId/);
    assert.match(analytics, /readSellerEngagementAnalytics\(me\.id/);
    assert.match(cron, /pruneSellerAnalyticsDaily\(\{/);
    assert.match(deletion, /clearSellerProfileViewDailyForAccountDeletion\(tx, \{/);
    for (const authority of [
      "grainline_listing_analytics_record",
      "grainline_seller_engagement_analytics",
      "grainline_seller_analytics_retention_prune",
      "grainline_seller_profile_view_daily_account_deletion_clear",
    ]) {
      assert.equal(
        provisioning.match(new RegExp(authority, "g"))?.length,
        2,
        `${authority} must remain granted across runtime-role provisioning replays`,
      );
    }

    const reviewedCallers = [
      source("src/app/api/listings/[id]/view/route.ts"),
      source("src/app/api/listings/[id]/click/route.ts"),
      analytics,
      cron,
      deletion,
    ].join("\n");
    assert.doesNotMatch(
      reviewedCallers,
      /\.(?:listingViewDaily|sellerProfileViewDaily)\.(?:aggregate|findMany|upsert|deleteMany)/,
    );
    assert.doesNotMatch(
      reviewedCallers,
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\."(?:ListingViewDaily|SellerProfileViewDaily)"/,
    );
  });
});
