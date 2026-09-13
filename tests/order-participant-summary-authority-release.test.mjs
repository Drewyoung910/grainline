import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_PARTICIPANT_SUMMARY_AUTHORITY_PHASE,
  verifyOrderParticipantSummaryAuthorityRelease,
} from "../scripts/verify-order-participant-summary-authority-release.mjs";

test("Order participant summary authority is one exact compatible successor", () => {
  const result = verifyOrderParticipantSummaryAuthorityRelease();
  assert.equal(result.phase, ORDER_PARTICIPANT_SUMMARY_AUTHORITY_PHASE);
  assert.equal(result.functionCount, 3);
  assert.equal(result.runtimeFunctionCount, 2);
  assert.equal(result.privateFunctionCount, 1);
  assert.equal(result.summaryItemLimit, 5);
  assert.equal(result.convertedOrderSourceCount, 2);
  assert.equal(result.directOrderSourceCount, 26);
  assert.equal(result.rlsChanged, false);
  assert.equal(result.runtimeTablePrivilegesChanged, false);
  assert.equal(result.productionTouched, false);
});
