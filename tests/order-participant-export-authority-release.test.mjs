import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ORDER_PARTICIPANT_EXPORT_AUTHORITY_PHASE,
  verifyOrderParticipantExportAuthorityRelease,
} from "../scripts/verify-order-participant-export-authority-release.mjs";

describe("Order participant export-authority release verifier", () => {
  it("accepts the exact additive release and records its boundary", () => {
    const result = verifyOrderParticipantExportAuthorityRelease();
    assert.equal(result.phase, ORDER_PARTICIPANT_EXPORT_AUTHORITY_PHASE);
    assert.equal(result.functionCount, 2);
    assert.equal(result.pageLimit, 25);
    assert.equal(result.itemLimit, 100);
    assert.equal(result.rawShippingQuotesExposed, false);
    assert.equal(result.providerRefundIdsExposed, false);
    assert.equal(result.rlsChanged, false);
    assert.equal(result.runtimeTablePrivilegesChanged, false);
    assert.equal(result.productionTouched, false);
  });
});
