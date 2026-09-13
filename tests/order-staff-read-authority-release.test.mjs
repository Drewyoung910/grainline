import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_STAFF_READ_AUTHORITY_MIGRATION,
  ORDER_STAFF_READ_AUTHORITY_MIGRATION_SHA256,
} from "../scripts/order-participant-list-authority-catalog.mjs";
import {
  ORDER_STAFF_READ_AUTHORITY_PHASE,
  verifyOrderStaffReadAuthorityRelease,
} from "../scripts/verify-order-staff-read-authority-release.mjs";

test("Order staff read authority is one exact dormant successor", () => {
  const release = verifyOrderStaffReadAuthorityRelease();
  assert.equal(release.phase, ORDER_STAFF_READ_AUTHORITY_PHASE);
  assert.equal(release.migration, ORDER_STAFF_READ_AUTHORITY_MIGRATION);
  assert.equal(release.migrationSha256, ORDER_STAFF_READ_AUTHORITY_MIGRATION_SHA256);
  assert.equal(release.dormantFunctionCount, 2);
  assert.equal(release.runtimeExecuteGranted, false);
  assert.equal(release.rlsChanged, false);
  assert.equal(release.runtimeTablePrivilegesChanged, false);
  assert.equal(release.rowDataChanged, false);
  assert.equal(release.productionTouched, false);
});
