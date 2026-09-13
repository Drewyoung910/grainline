import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ORDER_ELIGIBILITY_AUTHORITY_PHASE,
  verifyOrderEligibilityAuthorityRelease,
} from "../scripts/verify-order-eligibility-authority-release.mjs";

describe("Order eligibility-authority release verifier", () => {
  it("accepts the exact additive release and records its boundary", () => {
    const result = verifyOrderEligibilityAuthorityRelease();
    assert.equal(result.phase, ORDER_ELIGIBILITY_AUTHORITY_PHASE);
    assert.equal(result.functionCount, 4);
    assert.equal(result.directOrderSourceCount, 35);
    assert.equal(result.reviewOrderLockPreserved, true);
    assert.equal(result.rowProjectionExposed, false);
    assert.equal(result.rlsChanged, false);
    assert.equal(result.runtimeTablePrivilegesChanged, false);
    assert.equal(result.productionTouched, false);
  });
});
