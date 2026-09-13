import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ORDER_PUBLIC_AGGREGATE_AUTHORITY_PHASE,
  verifyOrderPublicAggregateAuthorityRelease,
} from "../scripts/verify-order-public-aggregate-authority-release.mjs";

describe("Order public aggregate-authority release verifier", () => {
  it("accepts the exact additive release and records its boundary", () => {
    const result = verifyOrderPublicAggregateAuthorityRelease();
    assert.equal(result.phase, ORDER_PUBLIC_AGGREGATE_AUTHORITY_PHASE);
    assert.equal(result.functionCount, 4);
    assert.equal(result.directOrderSourceCount, 31);
    assert.equal(result.directOrderItemSourceCount, 6);
    assert.equal(result.publicAggregateOnly, true);
    assert.equal(result.rowProjectionExposed, false);
    assert.equal(result.rlsChanged, false);
    assert.equal(result.runtimeTablePrivilegesChanged, false);
    assert.equal(result.productionTouched, false);
  });
});
