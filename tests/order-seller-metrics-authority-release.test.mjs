import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ORDER_SELLER_METRICS_AUTHORITY_PHASE,
  verifyOrderSellerMetricsAuthorityRelease,
} from "../scripts/verify-order-seller-metrics-authority-release.mjs";

describe("Order seller metrics-authority release verifier", () => {
  it("accepts only the exact additive durable-key aggregate release", () => {
    const result = verifyOrderSellerMetricsAuthorityRelease();
    assert.equal(result.phase, ORDER_SELLER_METRICS_AUTHORITY_PHASE);
    assert.equal(result.functionCount, 1);
    assert.equal(result.directOrderSourceCount, 28);
    assert.equal(result.directOrderItemSourceCount, 4);
    assert.equal(result.durableSellerKeys, true);
    assert.equal(result.aggregateOnly, true);
    assert.equal(result.rlsChanged, false);
    assert.equal(result.runtimeTablePrivilegesChanged, false);
    assert.equal(result.productionTouched, false);
  });

  it("routes Guild order facts through the fixed function and validates results", () => {
    const metrics = readFileSync("src/lib/metrics.ts", "utf8");
    const authority = readFileSync("src/lib/orderSellerMetricsAuthority.ts", "utf8");
    const state = readFileSync("src/lib/orderSellerMetricsState.ts", "utf8");

    assert.match(metrics, /readOrderSellerMetricsFacts\(sellerProfileId, periodStart, db\)/u);
    assert.doesNotMatch(metrics, /FROM "Order"|JOIN "OrderItem"/u);
    assert.match(authority, /public\.grainline_order_seller_metrics_facts/u);
    assert.match(authority, /orderSellerMetricsFactsFromRows\(rows\)/u);
    assert.match(state, /rows\.length !== 1/u);
    assert.match(state, /onTimeCount > shippedCount/u);
  });
});
