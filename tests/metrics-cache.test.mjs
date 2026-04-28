import assert from "node:assert/strict";
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
});
