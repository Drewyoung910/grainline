import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION,
  ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION_SHA256,
} from "../scripts/order-participant-list-authority-catalog.mjs";
import {
  ORDER_PARTICIPANT_LIST_AUTHORITY_PHASE,
  verifyOrderParticipantListAuthorityRelease,
} from "../scripts/verify-order-participant-list-authority-release.mjs";

test("Order participant list authority is one exact compatible successor", () => {
  const release = verifyOrderParticipantListAuthorityRelease();
  assert.equal(release.phase, ORDER_PARTICIPANT_LIST_AUTHORITY_PHASE);
  assert.equal(release.migration, ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION);
  assert.equal(
    release.migrationSha256,
    ORDER_PARTICIPANT_LIST_AUTHORITY_MIGRATION_SHA256,
  );
  assert.equal(release.runtimeFunctionCount, 4);
  assert.equal(release.rlsChanged, false);
  assert.equal(release.runtimeTablePrivilegesChanged, false);
  assert.equal(release.rowDataChanged, false);
  assert.equal(release.productionTouched, false);
});
