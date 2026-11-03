import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("guild and listing-edit audit follow-ups", () => {
  it("keeps dashboard Guild eligibility aligned with the application API", () => {
    const dashboard = source("src/app/dashboard/verification/page.tsx");
    const applyRoute = source("src/app/api/verification/apply/route.ts");
    const eligibilityAuthority = source(
      "prisma/migrations/20260901040000_prepare_order_eligibility_authority/migration.sql",
    );

    assert.match(
      dashboard,
      /listingOwnerCounts\(sellerUserId\)[\s\S]*counts\.activePublicCount/,
    );
    assert.match(
      applyRoute,
      /listingOwnerCounts\(me\.id\)[\s\S]*counts\.activePublicCount/,
    );
    assert.doesNotMatch(dashboard, /prisma\.listing\.count\(/);
    assert.doesNotMatch(applyRoute, /prisma\.listing\.count\(/);
    assert.match(applyRoute, /safeRateLimit\(verificationApplyRatelimit, me\.id\)/);
    assert.match(applyRoute, /rateLimitResponse\(reset, "Too many verification applications\."\)/);
    assert.match(applyRoute, /getSellerVerificationOrderSales/);
    assert.match(dashboard, /getSellerVerificationOrderSales/);
    assert.match(eligibilityAuthority, /source_order\."sellerRefundId" IS NULL/);
    assert.match(eligibilityAuthority, /source_order\."paymentRefundBlocked" = false/);
    assert.doesNotMatch(applyRoute, /BLOCKING_REFUND_LEDGER_SQL|OrderPaymentEvent/);
    assert.match(dashboard, /normalizePublicHttpsUrl\(portfolioRaw\)/);
    assert.match(applyRoute, /normalizePublicHttpsUrl\(verParsed\.portfolioUrl\)/);
    assert.doesNotMatch(dashboard, /function normalizeHttpsUrl/);
    assert.doesNotMatch(applyRoute, /function normalizeHttpsUrl/);
  });

  it("keeps admin Guild portfolio links behind public-url validation", () => {
    const adminVerification = source("src/app/admin/verification/page.tsx");

    assert.match(adminVerification, /function PortfolioUrlReviewLink/);
    assert.match(adminVerification, /const safeUrl = normalizePublicHttpsUrl\(url\)/);
    assert.match(adminVerification, /href=\{safeUrl\}/);
    assert.match(adminVerification, /Not linked: URL is not a public HTTPS host\./);
    assert.doesNotMatch(adminVerification, /href=\{v\.portfolioUrl\}/);
  });

  it("keeps listing edit row and variant replacement in one transaction", () => {
    const editPage = source("src/app/dashboard/listings/[id]/edit/page.tsx");
    const listingAuthority = source(
      "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
    );

    assert.match(editPage, /let updatedListing: \{[\s\S]*title: string;[\s\S]*updatedAt: Date;[\s\S]*requiresReview: boolean;/);
    assert.match(editPage, /updatedListing = await withDbUserContext\(actor\.id, async \(tx\) => \{/);
    assert.match(editPage, /await updateListingOwnerContent\(tx,/);
    assert.doesNotMatch(editPage, /await tx\.listing\.update\(/);
    assert.match(listingAuthority, /PERFORM \* FROM public\.grainline_listing_children_replace_core\(/);
    assert.match(listingAuthority, /DELETE FROM public\."ListingVariantGroup"/);
    assert.match(listingAuthority, /INSERT INTO public\."ListingVariantGroup"/);
    assert.match(listingAuthority, /INSERT INTO public\."ListingVariantOption"/);
    assert.doesNotMatch(editPage, /await prisma\.listingVariantGroup\.deleteMany/);
    assert.doesNotMatch(editPage, /await prisma\.listingVariantGroup\.create/);
  });

  it("keeps Guild case metrics and reinstatement checks on active unresolved cases", () => {
    const metrics = source("src/lib/metrics.ts");
    const metricsState = source("src/lib/metricsState.ts");
    const metricsAuthority = source(
      "prisma/migrations/20261102030000_prepare_seller_metrics_authorities/migration.sql",
    );
    const revocationAuthority = source(
      sellerProfilePrivateMigrationPath("20261014200000_prepare_seller_profile_private_guild_member_revocation_authority"),
    );
    const staffTransitionAuthority = source(
      sellerProfilePrivateMigrationPath("20261014220000_prepare_seller_profile_private_guild_staff_transition_authority"),
    );
    const adminVerification = source("src/app/admin/verification/page.tsx");

    assert.match(metrics, /grainline_seller_metrics_owner_state/);
    assert.doesNotMatch(metrics, /\b(?:db|prisma)\.case\./);
    assert.match(metrics, /from "@\/lib\/metricsState"/);
    assert.match(metricsAuthority, /grainline_case_seller_active_count\(/);
    assert.match(metricsAuthority, /INTO source_active_case_count/);
    assert.match(metricsState, /export const METRICS_PERIOD_DAYS_PER_MONTH = 30/);
    assert.match(metricsAuthority, /database_now timestamp\(3\)[^;]*:=/);
    assert.match(metricsAuthority, /pg_catalog\.make_interval\(days => p_period_months \* 30\)/);
    assert.doesNotMatch(metricsState, /setMonth\(/);
    assert.match(revocationAuthority, /grainline_case_guild_unresolved_guard/);
    assert.doesNotMatch(revocationAuthority, /p_case_created_before/);
    assert.match(adminVerification, /operation: "REINSTATE_GUILD_MEMBER"/);
    assert.match(staffTransitionAuthority, /grainline_case_guild_unresolved_guard\(source_seller\.id\)/);
    assert.match(staffTransitionAuthority, /active_listing_count < 5/);
  });

  it("syncs Guild listing threshold through a database-derived fixed operation", () => {
    const helper = source("src/lib/guildListingThreshold.ts");
    const migration = source(
      sellerProfilePrivateMigrationPath("20261014170000_prepare_seller_profile_private_guild_listing_threshold_authority"),
    );
    const newListing = source("src/app/dashboard/listings/new/page.tsx");
    const dashboard = source("src/app/dashboard/page.tsx");
    const shopActions = source("src/app/seller/[id]/shop/actions.ts");
    const stockRoute = source("src/app/api/listings/[id]/stock/route.ts");
    const adminRemoveRoute = source("src/app/api/admin/listings/[id]/route.ts");
    const adminReviewRoute = source("src/app/api/admin/listings/[id]/review/route.ts");

    assert.match(helper, /grainline_seller_guild_listing_threshold_sync/);
    assert.doesNotMatch(helper, /UPDATE "SellerProfile"/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.grainline_seller_guild_listing_threshold_sync\(/);
    assert.match(migration, /JOIN public\."SellerProfilePrivate"/);
    assert.match(migration, /pg_catalog\.count\(\*\)[\s\S]*FROM public\."Listing"/);
    assert.match(migration, /listing\."isPrivate" = false/);
    assert.match(migration, /UPDATE public\."SellerProfilePrivate"/);
    assert.match(migration, /UPDATE public\."SellerProfile"/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_seller_guild_listing_threshold_sync\(text\)/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_seller_guild_listing_threshold_sync\(text\)/);
    assert.match(newListing, /finalListing\?\.status === "ACTIVE"/);
    assert.match(newListing, /syncGuildMemberListingThreshold\(seller\.id\)/);
    assert.match(dashboard, /syncGuildMemberListingThreshold\(listing\.sellerId\)/);
    assert.match(shopActions, /syncGuildMemberListingThreshold\(sellerId\)/);
    assert.match(shopActions, /syncGuildMemberListingThreshold\(listing\.sellerId\)/);
    assert.match(stockRoute, /syncGuildMemberListingThreshold\(listing\.sellerId\)/);
    assert.match(adminRemoveRoute, /syncGuildMemberListingThreshold\(listing\.sellerId\)/);
    assert.match(adminReviewRoute, /syncGuildThresholdAfterAdminReview\(id, listing\.sellerId, 'admin_listing_approve_guild_threshold'\)/);
    assert.match(adminReviewRoute, /syncGuildThresholdAfterAdminReview\(id, listing\.sellerId, 'admin_listing_reject_guild_threshold'\)/);
    assert.doesNotMatch(stockRoute, /activeCount < 5/);
  });
});
