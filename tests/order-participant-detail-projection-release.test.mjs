import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_PARTICIPANT_DETAIL_PROJECTION_PHASE,
  verifyOrderParticipantDetailProjectionRelease,
} from "../scripts/verify-order-participant-detail-projection-release.mjs";

test("Order participant detail projection is one exact compatible successor", () => {
  const result = verifyOrderParticipantDetailProjectionRelease();
  assert.equal(result.phase, ORDER_PARTICIPANT_DETAIL_PROJECTION_PHASE);
  assert.equal(result.functionCount, 2);
  assert.equal(result.convertedOrderSourceCount, 2);
  assert.equal(result.directOrderSourceCount, 22);
  assert.equal(result.rlsChanged, false);
  assert.equal(result.runtimeTablePrivilegesChanged, false);
  assert.equal(result.rowDataChanged, false);
  assert.equal(result.productionTouched, false);
});
