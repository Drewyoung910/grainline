import assert from "node:assert/strict";
import test from "node:test";

import {
  appendReviewedOrderStaffReadChargedTotalCorrection,
  ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
  ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION_SHA256,
  verifyOrderStaffReadChargedTotalCorrection,
} from "../scripts/verify-order-staff-read-charged-total-correction.mjs";
import {
  CASE_CORRECTNESS_MIGRATION,
} from "../scripts/build-case-correctness-migration.mjs";

test("Order staff charged-total correction is byte-pinned and authority-neutral", () => {
  const release = verifyOrderStaffReadChargedTotalCorrection();
  assert.equal(release.migration, ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION);
  assert.equal(release.sha256, ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION_SHA256);
  assert.equal(release.correctedFunctionCount, 2);
  assert.equal(release.grantsChanged, false);
  assert.equal(release.rlsChanged, false);
  assert.equal(release.rowDataChanged, false);
});

test("historical verifiers accept only the exact byte-pinned successor order", () => {
  const reviewedSuccessors = [CASE_CORRECTNESS_MIGRATION];
  assert.equal(
    appendReviewedOrderStaffReadChargedTotalCorrection({
      laterMigrations: [ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION],
      reviewedSuccessors,
      expectedPredecessor: CASE_CORRECTNESS_MIGRATION,
    }),
    true,
  );
  assert.deepEqual(reviewedSuccessors, [
    CASE_CORRECTNESS_MIGRATION,
    ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
  ]);

  assert.throws(
    () => appendReviewedOrderStaffReadChargedTotalCorrection({
      laterMigrations: [ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION],
      reviewedSuccessors: ["unreviewed_predecessor"],
      expectedPredecessor: CASE_CORRECTNESS_MIGRATION,
    }),
    /requires its exact reviewed predecessor/u,
  );
});
