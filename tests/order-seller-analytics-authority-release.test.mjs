import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ORDER_SELLER_ANALYTICS_AUTHORITY_PHASE,
  verifyOrderSellerAnalyticsAuthorityRelease,
} from "../scripts/verify-order-seller-analytics-authority-release.mjs";

describe("Order seller analytics-authority release verifier", () => {
  it("accepts only the exact additive actor-bound release", () => {
    const result = verifyOrderSellerAnalyticsAuthorityRelease();
    assert.equal(result.phase, ORDER_SELLER_ANALYTICS_AUTHORITY_PHASE);
    assert.equal(result.functionCount, 5);
    assert.equal(result.directOrderSourceCount, 29);
    assert.equal(result.directOrderItemSourceCount, 5);
    assert.equal(result.actorBound, true);
    assert.equal(result.abandonedCartMinimumAgeHours, 24);
    assert.equal(result.recentSalesDeterministic, true);
    assert.equal(result.rlsChanged, false);
    assert.equal(result.runtimeTablePrivilegesChanged, false);
    assert.equal(result.productionTouched, false);
  });
});
