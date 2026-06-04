import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("guild and listing-edit audit follow-ups", () => {
  it("keeps dashboard Guild eligibility aligned with the application API", () => {
    const dashboard = source("src/app/dashboard/verification/page.tsx");
    const applyRoute = source("src/app/api/verification/apply/route.ts");

    assert.match(dashboard, /status: "ACTIVE", isPrivate: false/);
    assert.match(applyRoute, /status: "ACTIVE", isPrivate: false/);
    assert.match(applyRoute, /safeRateLimit\(verificationApplyRatelimit, me\.id\)/);
    assert.match(applyRoute, /rateLimitResponse\(reset, "Too many verification applications\."\)/);
    assert.match(applyRoute, /o\."sellerRefundId" IS NULL/);
    assert.match(applyRoute, /import \{ BLOCKING_REFUND_LEDGER_SQL \} from "@\/lib\/refundLedgerSql"/);
    assert.match(applyRoute, /\$\{BLOCKING_REFUND_LEDGER_SQL\}/);
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

    assert.match(editPage, /let updatedListing: \{ title: string; updatedAt: Date \}/);
    assert.match(editPage, /updatedListing = await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(editPage, /await tx\.listing\.update\(/);
    assert.match(editPage, /await tx\.listingVariantGroup\.deleteMany/);
    assert.match(editPage, /await tx\.listingVariantGroup\.create/);
    assert.doesNotMatch(editPage, /await prisma\.listingVariantGroup\.deleteMany/);
    assert.doesNotMatch(editPage, /await prisma\.listingVariantGroup\.create/);
  });

  it("keeps Guild case metrics and reinstatement checks on active unresolved cases", () => {
    const metrics = source("src/lib/metrics.ts");
    const metricsState = source("src/lib/metricsState.ts");
    const revocationState = source("src/lib/guildMemberRevocationState.ts");
    const adminVerification = source("src/app/admin/verification/page.tsx");

    assert.match(metrics, /status: \{ notIn: \["RESOLVED", "CLOSED"\] \}/);
    assert.doesNotMatch(metrics, /status: \{ notIn: \["RESOLVED", "CLOSED"\] \},\s*createdAt: \{ gte: periodStart \}/);
    assert.match(metrics, /from "@\/lib\/metricsState"/);
    assert.match(metricsState, /export const METRICS_PERIOD_DAYS_PER_MONTH = 30/);
    assert.match(metrics, /metricsPeriodStart\(new Date\(\), periodMonths\)/);
    assert.doesNotMatch(metricsState, /setMonth\(/);
    assert.match(revocationState, /CaseStatus\.UNDER_REVIEW/);
    assert.match(adminVerification, /guildMemberRevocationCaseWhere/);
    assert.match(adminVerification, /caseCreatedBefore: ninetyDaysAgo/);
    assert.match(adminVerification, /activeListings < 5/);
  });

  it("syncs Guild listing threshold from a single SQL statement", () => {
    const helper = source("src/lib/guildListingThreshold.ts");
    const dashboard = source("src/app/dashboard/page.tsx");
    const shopActions = source("src/app/seller/[id]/shop/actions.ts");
    const stockRoute = source("src/app/api/listings/[id]/stock/route.ts");
    const adminRemoveRoute = source("src/app/api/admin/listings/[id]/route.ts");
    const adminReviewRoute = source("src/app/api/admin/listings/[id]/review/route.ts");

    assert.match(helper, /UPDATE "SellerProfile" sp/);
    assert.match(helper, /COUNT\(\*\)[\s\S]*FROM "Listing" l/);
    assert.match(helper, /l\."isPrivate" = false/);
    assert.match(helper, /COALESCE\(sp\."listingsBelowThresholdSince", NOW\(\)\)/);
    assert.match(dashboard, /syncGuildMemberListingThreshold\(listing\.sellerId\)/);
    assert.match(shopActions, /syncGuildMemberListingThreshold\(sellerId\)/);
    assert.match(shopActions, /syncGuildMemberListingThreshold\(listing\.sellerId\)/);
    assert.match(stockRoute, /syncGuildMemberListingThreshold\(listing\.seller\.id\)/);
    assert.match(adminRemoveRoute, /syncGuildMemberListingThreshold\(listing\.sellerId\)/);
    assert.match(adminReviewRoute, /syncGuildThresholdAfterAdminReview\(id, listing\.sellerId, 'admin_listing_approve_guild_threshold'\)/);
    assert.match(adminReviewRoute, /syncGuildThresholdAfterAdminReview\(id, listing\.sellerId, 'admin_listing_reject_guild_threshold'\)/);
    assert.doesNotMatch(stockRoute, /activeCount < 5/);
  });
});
