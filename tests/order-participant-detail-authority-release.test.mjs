import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION_SHA256,
} from "../scripts/order-participant-list-authority-catalog.mjs";
import {
  ORDER_PARTICIPANT_DETAIL_AUTHORITY_PHASE,
  verifyOrderParticipantDetailAuthorityRelease,
} from "../scripts/verify-order-participant-detail-authority-release.mjs";

test("Order participant detail authority is one exact compatible successor", () => {
  const release = verifyOrderParticipantDetailAuthorityRelease();
  assert.equal(release.phase, ORDER_PARTICIPANT_DETAIL_AUTHORITY_PHASE);
  assert.equal(release.migration, ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION);
  assert.equal(
    release.migrationSha256,
    ORDER_PARTICIPANT_DETAIL_AUTHORITY_MIGRATION_SHA256,
  );
  assert.equal(release.runtimeFunctionCount, 2);
  assert.equal(release.rlsChanged, false);
  assert.equal(release.runtimeTablePrivilegesChanged, false);
  assert.equal(release.rowDataChanged, false);
  assert.equal(release.productionTouched, false);
});
