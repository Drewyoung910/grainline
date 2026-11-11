import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

async function getAnalytics(range, {
  topListings = [],
  archivedIds = [],
  viewGroups = [],
  metrics = {
    sellerProfileId: "seller-1",
    calculatedAt: new Date("2026-01-01T00:00:00Z"),
    averageRating: 0,
    reviewCount: 0,
    onTimeShippingRate: 0,
    responseRate: 0,
    accountAgeDays: 0,
    totalSalesCents: 0,
    activeCaseCount: 0,
  },
  guildCriteria = { allMet: false },
} = {}) {
  const emptyAggregate = async () => ({ _sum: {} });
  const route = loadWithStubs("src/app/api/seller/analytics/route.ts", {
    "@prisma/client": { Prisma },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk-1" }) },
    "@/lib/db": {
      prisma: {
        $queryRaw: async () => [],
        listing: {
          count: async () => 0,
          findMany: async () => archivedIds.map((id) => ({ id })),
        },
        listingViewDaily: {
          aggregate: emptyAggregate,
          groupBy: async () => viewGroups,
          findMany: async () => {
            throw new Error("the chart must not load one row per listing per day");
          },
        },
        sellerProfileViewDaily: { aggregate: emptyAggregate },
        sellerMetrics: { findUnique: async () => null },
      },
    },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "user-1" }) },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }) },
    "@/lib/privateResponse": { privateJson: (body, init) => ({ status: init?.status ?? 200, body }) },
    "@/lib/sellerProfileOwnerAccess": {
      sellerOwnerCore: async () => ({ sellerProfileId: "seller-1", createdAt: new Date("2020-01-01T00:00:00Z"), chargesEnabled: true }),
    },
    "@/lib/sellerOwnerPrivateAccess": {
      sellerOwnerPrivateState: async () => ({ onboardingComplete: true, profileViews: 0 }),
    },
    "@/lib/orderSellerAnalyticsAuthority": {
      readSellerOrderAnalyticsSummary: async () => ({ sellerProfileId: "seller-1", totalRevenueCents: 0, totalOrders: 0 }),
      readSellerOrderAnalyticsBuckets: async () => [],
      readSellerOrderTopListings: async () => topListings,
    },
    "@/lib/metrics": {
      floorMetric: (value, decimals = 1) => {
        const factor = 10 ** decimals;
        return Math.floor(value * factor + 1e-9) / factor;
      },
      getFreshSellerMetrics: async () => metrics,
      meetsGuildMasterRequirements: () => guildCriteria,
    },
    "@/lib/money": { formatCurrencyCents: (cents) => String(cents) },
  });
  const response = await route.GET(new Request(`https://example.test/?range=${range}`));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

test("the last 365 days chart never shows the same month label twice", async () => {
  const { chartData } = await getAnalytics("last365");
  assert.equal(chartData.length, 13);
  const labels = chartData.map((bucket) => bucket.label);
  assert.equal(new Set(labels).size, labels.length, labels.join(", "));
  assert.match(labels[0], /^[A-Z][a-z]{2} '\d{2}$/);
  assert.match(labels[12], /^[A-Z][a-z]{2}$/);
});

test("a calendar-year chart keeps plain month labels", async () => {
  const { chartData } = await getAnalytics("year");
  for (const bucket of chartData) assert.match(bucket.label, /^[A-Z][a-z]{2}$/);
});

test("top listings say which ones are archived, because those pages 404 even for the owner", async () => {
  const row = (id) => ({ id, title: id, createdAt: new Date("2026-01-01T00:00:00Z"), totalRevenueCents: 0 });
  const { topListings } = await getAnalytics("last30", {
    topListings: [row("live"), row("gone")],
    archivedIds: ["gone"],
  });
  assert.deepEqual(topListings.map(({ id, archived }) => [id, archived]), [["live", false], ["gone", true]]);
});

test("the views chart sums views per day in the database, not one row per listing", async () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { chartData } = await getAnalytics("last30", {
    viewGroups: [{ date: today, _sum: { views: 7, clicks: 3 } }],
  });
  const totals = chartData.reduce((sum, bucket) => [sum[0] + bucket.views, sum[1] + bucket.clicks], [0, 0]);
  assert.deepEqual(totals, [7, 3]);
});

test("failing Guild metrics are floored so the copy never displays a passing threshold", async () => {
  const { guildMasterFailures } = await getAnalytics("last30", {
    metrics: {
      sellerProfileId: "seller-1",
      calculatedAt: new Date("2026-01-01T00:00:00Z"),
      averageRating: 4.499,
      reviewCount: 25,
      onTimeShippingRate: 0.9499,
      responseRate: 0.8999,
      accountAgeDays: 180,
      totalSalesCents: 100_000,
      activeCaseCount: 0,
    },
    guildCriteria: {
      ratingMet: false,
      reviewsMet: true,
      shippingMet: false,
      responseMet: false,
      ageMet: true,
      salesMet: true,
      casesMet: true,
      allMet: false,
    },
  });

  assert.deepEqual(guildMasterFailures, [
    "Average rating < 4.5 (currently 4.4)",
    "On-time shipping < 95% (currently 94.9%)",
    "Response rate < 90% (currently 89.9%)",
  ]);
});
