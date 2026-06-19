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
    assert.match(route, /VACATION_RETURN_DATE_RE = \/\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\$\//);
    assert.match(route, /VACATION_RETURN_DATE_RE\.exec\(trimmed\)/);
    assert.match(route, /Date\.UTC\(year, month - 1, day, 12, 0, 0, 0\)/);
    assert.match(route, /date\.getUTCFullYear\(\) !== year/);
    assert.doesNotMatch(route, /new Date\(trimmed\)/);
    assert.match(route, /return privateJson\(\{ error: "Invalid return date" \}, \{ status: HTTP_STATUS\.BAD_REQUEST \}\)/);
    assert.match(route, /function isPastVacationReturnDate/);
    assert.match(route, /Native date inputs carry no timezone/);
    assert.match(route, /todayNoonUtc\.getTime\(\) - 24 \* 60 \* 60 \* 1000/);
    assert.match(route, /vacationMode && vacationReturnDate && isPastVacationReturnDate\(vacationReturnDate\)/);
    assert.match(route, /return privateJson\(\{ error: "Return date cannot be in the past" \}, \{ status: HTTP_STATUS\.BAD_REQUEST \}\)/);
    assert.match(route, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/);
    assert.match(route, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(route, /logServerError\(err, \{[\s\S]*source: "seller_vacation_update"[\s\S]*route: "\/api\/seller\/vacation"/);
    assert.doesNotMatch(route, /console\.error\("POST \/api\/seller\/vacation error:", err\)/);
    assert.doesNotMatch(route, /status: (400|401|413|500)\b/);
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
    assert.match(route, /source: "seller_broadcast_email"/);
    assert.match(route, /source: "seller_broadcast_after"/);
    assert.match(route, /broadcastId: broadcast\.id/);
    assert.match(route, /sellerProfileId: seller\.id/);
    assert.doesNotMatch(route, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
    assert.doesNotMatch(route, /extra:\s*\{[^}]*message/s);
  });

  it("keeps seller broadcast history pagination bounded", () => {
    const route = source("src/app/api/seller/broadcast/route.ts");
    const getRoute = route.slice(route.indexOf("export async function GET"));

    assert.match(getRoute, /parseBoundedPositiveIntParam\(\s*url\.searchParams\.get\("page"\),\s*1,\s*1000,\s*\)/s);
    assert.match(getRoute, /safeRateLimit\(\s*sellerBroadcastReadRatelimit,\s*userId,\s*\)/s);
    assert.match(getRoute, /where: \{ sellerProfileId: seller\.id \}/);
    assert.match(getRoute, /orderBy: \[\{ sentAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.ok(
      getRoute.indexOf("sellerBroadcastReadRatelimit,\n    userId") <
        getRoute.indexOf("prisma.user.findUnique"),
      "broadcast history GET should rate-limit before Prisma reads",
    );
  });

  it("keeps seller broadcast writes gated to orderable sellers and first-party media", () => {
    const route = source("src/app/api/seller/broadcast/route.ts");
    const composer = source("src/components/BroadcastComposer.tsx");

    assert.match(route, /!seller\.chargesEnabled \|\| seller\.vacationMode/);
    assert.match(route, /isFirstPartyMediaUrl\(u\)/);
    assert.match(route, /isFirstPartyMediaUrlForUser\(imageUrl, userId/);
    assert.match(route, /safeRateLimit\(\s*broadcastAttemptRatelimit,\s*seller\.id,\s*\)/s);
    assert.match(route, /safeRateLimit\(\s*broadcastRatelimit,\s*seller\.id,\s*\)/s);
    assert.match(route, /dedupScope: broadcast\.id/);
    assert.match(route, /link: `\/account\/feed\?broadcast=\$\{broadcast\.id\}`/);
    assert.match(route, /isEmailNotificationEnabled\(\s*f\.follower\.notificationPreferences,\s*"EMAIL_SELLER_BROADCAST",\s*\)/s);
    assert.match(route, /renderSellerBroadcastEmail/);
    assert.match(route, /enqueueEmailOutbox\(\{/);
    assert.match(route, /preferenceKey: "EMAIL_SELLER_BROADCAST"/);
    assert.match(route, /dedupKey: `seller-broadcast:\$\{broadcast\.id\}:\$\{f\.followerId\}`/);
    assert.match(route, /nextAvailableAt: nextAvailable\.toISOString\(\)/);
    assert.doesNotMatch(route, /nextAvailable\.toLocaleDateString/);
    assert.match(composer, /function broadcastErrorMessage/);
    assert.match(composer, /new Date\(data\.nextAvailableAt\)/);
    assert.match(composer, /next\.toLocaleDateString\("en-US"/);

    const attemptLimiter = route.indexOf("broadcastAttemptRatelimit,\n    seller.id");
    const bodyRead = route.indexOf("readBoundedJson(req, BROADCAST_BODY_MAX_BYTES)");
    const schemaParse = route.indexOf("BroadcastSchema.parse");
    const firstPartyMedia = route.indexOf("isFirstPartyMediaUrlForUser(imageUrl, userId");
    const cooldownCheck = route.indexOf("prisma.sellerBroadcast.findFirst");
    const weeklyLimiter = route.indexOf("broadcastRatelimit,\n    seller.id");
    const createBroadcast = route.indexOf("prisma.sellerBroadcast.create");

    assert.ok(attemptLimiter !== -1, "broadcast attempt limiter should exist");
    assert.ok(weeklyLimiter !== -1, "weekly broadcast limiter should exist");
    assert.ok(
      attemptLimiter < bodyRead,
      "cheap attempt limiter should run before parsing request bodies",
    );
    assert.ok(
      schemaParse < weeklyLimiter,
      "weekly broadcast token should not be consumed before schema validation",
    );
    assert.ok(
      firstPartyMedia < weeklyLimiter,
      "weekly broadcast token should not be consumed before media ownership validation",
    );
    assert.ok(
      cooldownCheck < weeklyLimiter,
      "DB cooldown should run before weekly Redis token consumption",
    );
    assert.ok(
      weeklyLimiter < createBroadcast,
      "weekly broadcast limiter should run before creating the broadcast",
    );
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
    assert.match(recentSales, /sellerRefundId: null/);
    assert.match(recentSales, /paymentEvents: \{ none: blockingRefundLedgerWhere\(\) \}/);
    assert.match(recentSales, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(recentSales, /accountAccessErrorResponse\(err\)/);
  });

  it("labels seller analytics UTC bucket ranges explicitly", () => {
    const page = source("src/app/dashboard/analytics/page.tsx");

    assert.match(page, /label: "Today UTC"/);
    assert.match(page, /label: "Yesterday UTC"/);
    assert.match(page, /label: "This week UTC"/);
    assert.match(page, /label: "Last 7 UTC days"/);
    assert.doesNotMatch(page, /label: "Today"/);
    assert.doesNotMatch(page, /label: "Yesterday"/);

    const analytics = source("src/app/api/seller/analytics/route.ts");
    assert.match(analytics, /case "last30":[\s\S]*?setUTCDate\(s\.getUTCDate\(\) - 29\)/);
    assert.match(analytics, /case "last365":[\s\S]*?setUTCDate\(s\.getUTCDate\(\) - 364\)/);
    assert.match(analytics, /const dateEndFilter = range === "yesterday" \? \{ lt: endDate \} : \{ lte: endDate \}/);
    assert.match(analytics, /const analyticsDateRange = \{ gte: startDate, \.\.\.dateEndFilter \}/);
    assert.match(
      analytics,
      /const rangeEndSql = range === "yesterday" \? Prisma\.sql`< \$\{endDate\}` : Prisma\.sql`<= \$\{endDate\}`/,
    );
    assert.doesNotMatch(analytics, /date: \{ gte: startDate, lte: endDate \}/);
    assert.doesNotMatch(analytics, /createdAt: \{ gte: startDate, lte: endDate \}/);
    assert.doesNotMatch(analytics, /"createdAt" <= \$\{endDate\}/);
  });

  it("keeps seller analytics independent reads parallelized and avoids listing-id prefetches", () => {
    const analytics = source("src/app/api/seller/analytics/route.ts");
    const promiseAllIndex = analytics.indexOf("] = await Promise.all([");

    assert.ok(promiseAllIndex > -1, "seller analytics should await a broad Promise.all block");

    for (const promiseName of [
      "overviewRowsPromise",
      "activeListingCountPromise",
      "rangeViewAggPromise",
      "favoritesCountPromise",
      "stockNotificationSubsPromise",
      "cartAbandonmentPromise",
      "buyerRowsPromise",
      "processingRowsPromise",
      "dailyViewDataPromise",
      "chartOrderRowsPromise",
      "topListingRowsPromise",
      "ratingRowsPromise",
      "existingMetricsPromise",
    ]) {
      const declarationIndex = analytics.indexOf(`const ${promiseName}`);
      assert.ok(declarationIndex > -1, `${promiseName} should be declared`);
      assert.ok(
        declarationIndex < promiseAllIndex,
        `${promiseName} should start before the broad Promise.all await`,
      );
      assert.match(analytics.slice(promiseAllIndex), new RegExp(`${promiseName},`));
    }

    assert.doesNotMatch(
      analytics,
      /prisma\.listing\.findMany\(\{\s*where: \{ sellerId \},\s*select: \{ id: true \}/s,
    );
    assert.doesNotMatch(analytics, /listingIds = listings\.map/);
    assert.doesNotMatch(analytics, /listingId: \{ in: listingIds \}/);
    assert.match(analytics, /prisma\.favorite\.count\(\{\s*where: \{ listing: \{ sellerId \}/s);
    assert.match(analytics, /prisma\.stockNotification\.count\(\{\s*where: \{ listing: \{ sellerId \}/s);
    assert.match(analytics, /const cartAbandonmentPromise = prisma\.\$queryRaw<CountRow\[]>/);
    assert.match(analytics, /JOIN "Cart" c ON c\.id = ci\."cartId"/);
    assert.match(analytics, /NOT EXISTS \(\s*SELECT 1\s*FROM "OrderItem" oi/s);
    assert.match(analytics, /AND o\."buyerId" = c\."userId"/);
    assert.match(analytics, /AND o\."buyerId" IS NOT NULL/);
    assert.match(
      analytics,
      /\(SELECT COUNT\(\*\)::bigint FROM "Favorite" f WHERE f\."listingId" = l\.id\) AS favorite_count/,
    );
    assert.match(
      analytics,
      /\(SELECT COUNT\(\*\)::bigint FROM "StockNotification" sn WHERE sn\."listingId" = l\.id\) AS stock_notification_count/,
    );
    assert.match(analytics, /const existingMetricsPromise = prisma\.sellerMetrics\.findUnique\(\{[\s\S]*?averageRating: true[\s\S]*?accountAgeDays: true/s);
    assert.match(analytics, /import \{ isSellerMetricsFresh \} from "@\/lib\/metricsFreshness"/);
    assert.match(analytics, /const isStale = !existingMetrics \|\| !isSellerMetricsFresh\(existingMetrics\)/);
    assert.match(analytics, /const metrics: SellerMetricsResult = isStale[\s\S]*?: existingMetrics!/);
    assert.match(analytics, /AND r\."createdAt" >= \$\{startDate\}/);
    assert.match(analytics, /AND r\."createdAt" \$\{rangeEndSql\}/);
    assert.doesNotMatch(analytics, /24 \* 60 \* 60 \* 1000/);
    assert.doesNotMatch(analytics, /const topFavsRows/);
    assert.doesNotMatch(analytics, /const topStockRows/);
    assert.doesNotMatch(analytics, /await prisma\.sellerMetrics\.findUnique\(\{ where: \{ sellerProfileId: sellerId \} \}\)/);
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
    assert.match(editListing, /where: \{ id: listingId, sellerId: listing\.sellerId, status: ListingStatus\.PENDING_REVIEW, updatedAt: updatedListing\.updatedAt \}/);
    assert.match(editListing, /status: approvedPublicStatus/);
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
