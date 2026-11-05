import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

async function getAnalytics(range, { topListings = [], archivedIds = [] } = {}) {
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
        listingViewDaily: { aggregate: emptyAggregate, findMany: async () => [] },
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
      getFreshSellerMetrics: async () => ({ averageRating: 0, reviewCount: 0, onTimeShippingRate: 0, responseRate: 0, accountAgeDays: 0, totalSalesCents: 0, activeCaseCount: 0 }),
      meetsGuildMasterRequirements: () => ({ allMet: false }),
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
