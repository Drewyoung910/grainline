import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("seller operational route hardening", () => {
  it("keeps vacation mode confirmation cancellable from the toggle and buttons", () => {
    const form = source("src/app/dashboard/seller/VacationModeForm.tsx");

    assert.match(form, /setPendingEnable\(false\);\s*setShowWarning\(false\);/s);
    assert.match(form, /function cancelEnable\(\)[\s\S]*?setEnabled\(false\);/);
    assert.match(form, /if \(showWarning\) \{\s*if \(!checked\) cancelEnable\(\);\s*return;\s*\}/);
    assert.match(form, /checked=\{enabled \|\| pendingEnable\}/);
    assert.match(form, /type="button"[\s\S]*?onClick=\{confirmEnable\}/);
    assert.match(form, /type="button"[\s\S]*?onClick=\{cancelEnable\}/);
    assert.match(form, /type="button"[\s\S]*?onClick=\{handleSave\}/);
  });

  it("accepts date-input return dates without weakening vacation route validation", () => {
    const route = source("src/app/api/seller/vacation/route.ts");

    assert.match(route, /vacationReturnDate: z\.string\(\)\.max\(40\)\.optional\(\)\.nullable\(\)/);
    assert.doesNotMatch(route, /\.datetime\(\)/);
    assert.match(route, /function parseVacationReturnDate/);
    assert.match(route, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
    assert.match(route, /T12:00:00\.000Z/);
    assert.match(route, /return NextResponse\.json\(\{ error: "Invalid return date" \}, \{ status: 400 \}\)/);
    assert.match(route, /source: "seller_vacation_update"/);
    assert.match(route, /expireOpenCheckoutSessionsForSeller/);
    assert.match(route, /source: "seller_vacation"/);
  });

  it("renders vacation return dates consistently as date-only local dates", () => {
    const localDate = source("src/components/LocalDate.tsx");
    const sellerProfile = source("src/app/seller/[id]/page.tsx");
    const sellerShop = source("src/app/seller/[id]/shop/page.tsx");

    assert.match(localDate, /dateOnly = false/);
    assert.match(localDate, /toLocaleDateString\("en-US", \{ month: "long", day: "numeric", year: "numeric" \}\)/);
    assert.match(sellerProfile, /<LocalDate date=\{seller\.vacationReturnDate\} dateOnly \/>/);
    assert.match(sellerShop, /import LocalDate from "@\/components\/LocalDate"/);
    assert.match(sellerShop, /<LocalDate date=\{seller\.vacationReturnDate\} dateOnly \/>/);
    assert.doesNotMatch(sellerShop, /vacationReturnDate\)\.toLocaleDateString/);
  });

  it("captures seller broadcast notification side-effect failures without message payloads", () => {
    const route = source("src/app/api/seller/broadcast/route.ts");

    assert.match(route, /source: "seller_broadcast_notification"/);
    assert.match(route, /source: "seller_broadcast_after"/);
    assert.match(route, /broadcastId: broadcast\.id/);
    assert.match(route, /sellerProfileId: seller\.id/);
    assert.doesNotMatch(route, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
    assert.doesNotMatch(route, /extra:\s*\{[^}]*message/s);
  });

  it("keeps seller broadcast history pagination bounded", () => {
    const route = source("src/app/api/seller/broadcast/route.ts");

    assert.match(route, /parseBoundedPositiveIntParam\(url\.searchParams\.get\("page"\), 1, 1000\)/);
    assert.match(route, /where: \{ sellerProfileId: seller\.id \}/);
  });

  it("keeps seller broadcast writes gated to orderable sellers and first-party media", () => {
    const route = source("src/app/api/seller/broadcast/route.ts");
    const composer = source("src/components/BroadcastComposer.tsx");

    assert.match(route, /!seller\.chargesEnabled \|\| seller\.vacationMode/);
    assert.match(route, /isFirstPartyMediaUrl\(u\)/);
    assert.match(route, /isFirstPartyMediaUrlForUser\(imageUrl, userId/);
    assert.match(route, /safeRateLimit\(broadcastRatelimit, seller\.id\)/);
    assert.match(route, /dedupScope: broadcast\.id/);
    assert.match(route, /nextAvailableAt: nextAvailable\.toISOString\(\)/);
    assert.doesNotMatch(route, /nextAvailable\.toLocaleDateString/);
    assert.match(composer, /function broadcastErrorMessage/);
    assert.match(composer, /new Date\(data\.nextAvailableAt\)/);
    assert.match(composer, /next\.toLocaleDateString\("en-US"/);
  });

  it("keeps seller analytics scoped to the current seller profile", () => {
    const analytics = source("src/app/api/seller/analytics/route.ts");
    const recentSales = source("src/app/api/seller/analytics/recent-sales/route.ts");

    assert.match(analytics, /ensureUserByClerkId\(userId\)/);
    assert.match(analytics, /where: \{ userId: me\.id \}/);
    assert.match(analytics, /const sellerId = sellerProfile\.id/);
    assert.match(analytics, /accountAccessErrorResponse\(err\)/);

    assert.match(recentSales, /ensureUserByClerkId\(userId\)/);
    assert.match(recentSales, /where: \{ userId: me\.id \}/);
    assert.match(recentSales, /some: \{ listing: \{ sellerId: sellerProfile\.id \} \}/);
    assert.match(recentSales, /every: \{ listing: \{ sellerId: sellerProfile\.id \} \}/);
    assert.match(recentSales, /accountAccessErrorResponse\(err\)/);
  });

  it("keeps listing stock updates owner-scoped in the final mutation", () => {
    const route = source("src/app/api/listings/[id]/stock/route.ts");

    assert.match(route, /where: \{ id, seller: \{ userId: me\.id \} \}/);
    assert.match(route, /AND "sellerId" = \$\{listing\.seller\.id\}/);
    assert.match(route, /source: "stock_back_in_stock_fanout"/);
    assert.doesNotMatch(route, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("keeps seller listing status follow-up mutations owner-scoped", () => {
    const shopActions = source("src/app/seller/[id]/shop/actions.ts");
    const createListing = source("src/app/dashboard/listings/new/page.tsx");
    const customListing = source("src/app/dashboard/listings/custom/page.tsx");
    const editListing = source("src/app/dashboard/listings/[id]/edit/page.tsx");

    assert.match(shopActions, /WHERE id = \$\{listingId\}\s+AND "sellerId" = \$\{listing\.sellerId\}/);
    assert.match(createListing, /WHERE id = \$\{created\.id\}\s+AND "sellerId" = \$\{seller\.id\}/);
    assert.match(customListing, /WHERE id = \$\{created\.id\}\s+AND "sellerId" = \$\{seller\.id\}/);
    assert.match(editListing, /where: \{ id: listingId, sellerId: listing\.sellerId, status: ListingStatus\.ACTIVE, updatedAt: updatedListing\.updatedAt \}/);
  });

  it("rate-limits seller listing server actions before owner mutation work", () => {
    const shopActions = source("src/app/seller/[id]/shop/actions.ts");
    const dashboard = source("src/app/dashboard/page.tsx");

    assert.match(shopActions, /listingMutationRatelimit/);
    assert.match(shopActions, /safeRateLimit\(listingMutationRatelimit, userId\)/);
    assert.ok(
      shopActions.indexOf("safeRateLimit(listingMutationRatelimit, userId)") <
        shopActions.indexOf("prisma.user.findUnique"),
      "shop listing actions should rate-limit before ownership DB lookups",
    );

    assert.match(dashboard, /listingMutationRatelimit/);
    assert.ok(
      dashboard.indexOf("safeRateLimit(listingMutationRatelimit, userId)") <
        dashboard.indexOf("const me = await prisma.user.findUnique"),
      "dashboard listing status action should rate-limit before ownership DB lookup",
    );
    assert.ok(
      dashboard.lastIndexOf("safeRateLimit(listingMutationRatelimit, userId)") <
        dashboard.lastIndexOf("const me = await prisma.user.findUnique"),
      "dashboard listing archive action should rate-limit before ownership DB lookup",
    );
  });

  it("rate-limits seller profile, shop, onboarding, and notification server actions before DB write work", () => {
    const ratelimit = source("src/lib/ratelimit.ts");
    const profile = source("src/app/dashboard/profile/page.tsx");
    const sellerSettings = source("src/app/dashboard/seller/page.tsx");
    const onboarding = source("src/app/dashboard/onboarding/actions.ts");
    const notifications = source("src/app/dashboard/notifications/page.tsx");

    assert.match(ratelimit, /export const sellerProfileRatelimit = new Ratelimit/);
    assert.match(ratelimit, /prefix: "rl:seller-profile"/);

    assert.match(profile, /sellerProfileRatelimit/);
    assert.ok(
      profile.indexOf("safeRateLimit(sellerProfileRatelimit, userId)") <
        profile.indexOf("const { seller } = await ensureSeller()"),
      "profile update should rate-limit before seller lookup/write preparation",
    );
    assert.ok(
      profile.indexOf("safeRateLimit(sellerProfileRatelimit, userId)", profile.indexOf("async function addFaq")) <
        profile.indexOf("const { seller } = await ensureSeller()", profile.indexOf("async function addFaq")),
      "FAQ create should rate-limit before seller lookup",
    );
    assert.ok(
      profile.indexOf("safeRateLimit(sellerProfileRatelimit, userId)", profile.indexOf("async function deleteFaq")) <
        profile.indexOf("const { seller } = await ensureSeller()", profile.indexOf("async function deleteFaq")),
      "FAQ delete should rate-limit before seller lookup",
    );
    assert.ok(
      profile.indexOf("safeRateLimit(sellerProfileRatelimit, userId)", profile.indexOf("async function toggleFeaturedListing")) <
        profile.indexOf("const { seller } = await ensureSeller()", profile.indexOf("async function toggleFeaturedListing")),
      "featured-listing toggle should rate-limit before seller lookup",
    );

    assert.match(sellerSettings, /sellerProfileRatelimit/);
    assert.ok(
      sellerSettings.indexOf("safeRateLimit(sellerProfileRatelimit, userId)") <
        sellerSettings.indexOf("const { seller } = await ensureSeller()"),
      "shop settings update should rate-limit before seller lookup/write preparation",
    );

    assert.match(onboarding, /SELLER_PROFILE_RATE_LIMITED/);
    assert.match(onboarding, /Too many profile updates\. Try again shortly\./);
    assert.ok(
      onboarding.indexOf("safeRateLimit(sellerProfileRatelimit, userId)") <
        onboarding.indexOf("prisma.sellerProfile.findFirst"),
      "onboarding step actions should rate-limit before seller lookup",
    );

    assert.match(notifications, /markReadRatelimit/);
    assert.ok(
      notifications.indexOf("safeRateLimit(markReadRatelimit, userId)") <
        notifications.indexOf("prisma.user.findUnique"),
      "notification mark-all-read should rate-limit before current-user lookup",
    );
    assert.match(notifications, /select: \{ id: true, banned: true, deletedAt: true \}/);
    assert.match(notifications, /if \(me\.banned \|\| me\.deletedAt\) return/);
  });

  it("keeps made-to-order processing windows internally consistent", () => {
    const createPage = source("src/app/dashboard/listings/new/page.tsx");
    const editPage = source("src/app/dashboard/listings/[id]/edit/page.tsx");
    const guard =
      /listingType === "MADE_TO_ORDER"[\s\S]*?processingTimeMinDays !== null[\s\S]*?processingTimeMaxDays !== null[\s\S]*?processingTimeMinDays > processingTimeMaxDays[\s\S]*?Processing time minimum cannot exceed the maximum/;

    assert.match(createPage, guard);
    assert.match(editPage, guard);
  });
});
