import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  sellerMetricsPreparationMigrationPath,
} from "./helpers/seller-metrics-preparation-migration-path.mjs";

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

  it("serializes refreshes inside the fixed SellerMetrics database operation", () => {
    const source = readFileSync(
      sellerMetricsPreparationMigrationPath(),
      "utf8",
    );

    assert.match(
      source,
      /pg_advisory_xact_lock\(\s*913344,\s*pg_catalog\.hashtext\(p_seller_profile_id\)\s*\)/u,
    );
    assert.match(source, /grainline_seller_metrics_refresh_prepared_impl/u);
    assert.match(source, /IF result_id IS NULL THEN[\s\S]*INSERT INTO public\."SellerMetrics"/u);
    assert.match(source, /ELSE[\s\S]*UPDATE public\."SellerMetrics" AS metrics/u);
  });

  it("routes cached and forced owner reads through the fixed database operation", () => {
    const metrics = readFileSync("src/lib/metrics.ts", "utf8");
    const dashboardVerification = readFileSync("src/app/dashboard/verification/page.tsx", "utf8");

    assert.match(metrics, /grainline_seller_metrics_owner_state/u);
    assert.match(metrics, /return readOwnerSellerMetrics\(actorUserId, periodMonths, false\)/u);
    assert.match(metrics, /return readOwnerSellerMetrics\(actorUserId, periodMonths, true\)/u);
    assert.match(metrics, /withDbUserContext\(actorUserId/u);
    assert.doesNotMatch(metrics, /\.sellerMetrics\.(?:findUnique|upsert|deleteMany)/u);

    assert.match(dashboardVerification, /masterMetrics = await getFreshSellerMetrics\(me\.id\);/);
    assert.match(dashboardVerification, /const metrics = await calculateSellerMetrics\(s\.userId\);/);
    assert.match(dashboardVerification, /masterCriteria\?\.allMet === true && !masterApplicationBlockReason/);
    assert.doesNotMatch(dashboardVerification, /!masterCriteria \|\| masterCriteria\.allMet/);
    assert.ok(
      dashboardVerification.indexOf("masterMetrics = await getFreshSellerMetrics(me.id);") <
        dashboardVerification.indexOf("const metrics = await calculateSellerMetrics(s.userId);"),
      "dashboard render should use the cached freshness helper while the application action still recalculates live metrics",
    );
  });
});
