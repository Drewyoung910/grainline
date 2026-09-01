import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_PARTICIPANT_CURSOR_AUTHORITY_PHASE,
  verifyOrderParticipantCursorAuthorityRelease,
} from "../scripts/verify-order-participant-cursor-authority-release.mjs";

test("Order participant cursor authority is one exact compatible successor", () => {
  const result = verifyOrderParticipantCursorAuthorityRelease();
  assert.equal(result.phase, ORDER_PARTICIPANT_CURSOR_AUTHORITY_PHASE);
  assert.equal(result.functionCount, 2);
  assert.equal(result.convertedOrderSourceCount, 2);
  assert.equal(result.directOrderSourceCount, 24);
  assert.equal(result.rlsChanged, false);
  assert.equal(result.runtimeTablePrivilegesChanged, false);
  assert.equal(result.rowDataChanged, false);
  assert.equal(result.productionTouched, false);
});
