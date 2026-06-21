import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { SELLER_METRICS_MAX_AGE_MS, isSellerMetricsFresh } = await import("../src/lib/metricsFreshness.ts");

describe("seller metrics cache freshness", () => {
  it("accepts metrics inside the configured freshness window", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");
    const calculatedAt = new Date(now.getTime() - SELLER_METRICS_MAX_AGE_MS + 1);

    assert.equal(isSellerMetricsFresh({ calculatedAt }, now), true);
  });

  it("rejects stale or invalid metric timestamps", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");
    const stale = new Date(now.getTime() - SELLER_METRICS_MAX_AGE_MS - 1);
    const farFuture = new Date(now.getTime() + 6 * 60 * 1000);

    assert.equal(isSellerMetricsFresh({ calculatedAt: stale }, now), false);
    assert.equal(isSellerMetricsFresh({ calculatedAt: farFuture }, now), false);
    assert.equal(isSellerMetricsFresh({ calculatedAt: new Date("not-a-date") }, now), false);
  });

  it("serializes stale seller metric refreshes with a seller-scoped transaction lock", () => {
    const source = readFileSync("src/lib/metrics.ts", "utf8");

    assert.match(source, /const SELLER_METRICS_LOCK_NAMESPACE = 913344/);
    assert.match(source, /return prisma\.\$transaction\(/);
    assert.match(source, /calculateSellerMetricsInTransaction\(sellerProfileId, periodMonths, tx\)/);
    assert.match(source, /SELECT pg_advisory_xact_lock\(\$\{SELLER_METRICS_LOCK_NAMESPACE\}, hashtext\(\$\{sellerProfileId\}\)\)/);
    assert.match(source, /await db\.sellerMetrics\.upsert/);
    assert.doesNotMatch(source, /await prisma\.sellerMetrics\.upsert/);
  });

  it("reuses fresh cached seller metrics before taking the advisory lock", () => {
    const metrics = readFileSync("src/lib/metrics.ts", "utf8");
    const dashboardVerification = readFileSync("src/app/dashboard/verification/page.tsx", "utf8");

    assert.match(metrics, /export const SELLER_METRICS_SELECT = \{[\s\S]*sellerProfileId: true[\s\S]*accountAgeDays: true/s);
    assert.match(metrics, /existingMetrics === undefined[\s\S]*prisma\.sellerMetrics\.findUnique\(\{[\s\S]*select: SELLER_METRICS_SELECT/s);
    assert.match(metrics, /metrics\.sellerProfileId === sellerProfileId[\s\S]*metrics\.periodMonths === periodMonths[\s\S]*isSellerMetricsFresh\(metrics\)[\s\S]*return cachedSellerMetricsToResult\(metrics\);/s);
    assert.match(metrics, /return refreshSellerMetricsAfterCacheMiss\(sellerProfileId, periodMonths\);/);
    assert.match(metrics, /async function refreshSellerMetricsAfterCacheMiss/);
    assert.match(metrics, /async function calculateSellerMetricsWithoutLock/);

    const refreshStart = metrics.indexOf("async function refreshSellerMetricsAfterCacheMiss");
    const refreshEnd = metrics.indexOf("async function lockSellerMetricsRefresh", refreshStart);
    const refreshBlock = metrics.slice(refreshStart, refreshEnd);
    assert.ok(
      refreshBlock.indexOf("await lockSellerMetricsRefresh(tx, sellerProfileId)") <
        refreshBlock.indexOf("await tx.sellerMetrics.findUnique"),
      "cache-miss refresh should wait on the seller lock before re-reading cached metrics",
    );
    assert.ok(
      refreshBlock.indexOf("await tx.sellerMetrics.findUnique") <
        refreshBlock.indexOf("return calculateSellerMetricsWithoutLock"),
      "cache-miss refresh should reuse another request's fresh row before recomputing aggregates",
    );

    assert.match(dashboardVerification, /masterMetrics = await getFreshSellerMetrics\(seller\.id\);/);
    assert.match(dashboardVerification, /const metrics = await calculateSellerMetrics\(s\.id\);/);
    assert.match(dashboardVerification, /masterCriteria\?\.allMet === true && !masterApplicationBlockReason/);
    assert.doesNotMatch(dashboardVerification, /!masterCriteria \|\| masterCriteria\.allMet/);
    assert.ok(
      dashboardVerification.indexOf("masterMetrics = await getFreshSellerMetrics(seller.id);") <
        dashboardVerification.indexOf("const metrics = await calculateSellerMetrics(s.id);"),
      "dashboard render should use the cached freshness helper while the application action still recalculates live metrics",
    );
  });
});
