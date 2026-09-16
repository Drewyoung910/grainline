import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendReviewedOrderAccountDeletionAuthority,
  ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION,
  ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION_SHA256,
  verifyOrderAccountDeletionAuthority,
} from "../scripts/verify-order-account-deletion-authority.mjs";
import {
  ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
} from "../scripts/verify-order-staff-read-charged-total-correction.mjs";

test("Order account-deletion authority is one exact additive successor", () => {
  const release = verifyOrderAccountDeletionAuthority();
  assert.equal(release.migration, ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION);
  assert.equal(release.sha256, ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION_SHA256);
  assert.equal(release.functionCount, 2);
  assert.equal(release.rlsChanged, false);
  assert.equal(release.runtimeTablePrivilegesChanged, false);
  assert.equal(release.rowDataChanged, false);
});

test("Order account-deletion authority verifier rejects byte drift", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grainline-order-deletion-release-"));
  const directory = path.join(
    root,
    "prisma/migrations",
    ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION,
  );
  mkdirSync(directory, { recursive: true });
  const source = readFileSync(
    `prisma/migrations/${ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION}/migration.sql`,
    "utf8",
  );
  writeFileSync(path.join(directory, "migration.sql"), `${source}\n`);
  assert.throws(
    () => verifyOrderAccountDeletionAuthority(root),
    /migration bytes drifted/u,
  );
});

test("historical verifiers accept only the exact account-deletion successor order", () => {
  const reviewedSuccessors = [ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION];
  assert.equal(
    appendReviewedOrderAccountDeletionAuthority({
      laterMigrations: [ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION],
      reviewedSuccessors,
      expectedPredecessor: ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
    }),
    true,
  );
  assert.deepEqual(reviewedSuccessors, [
    ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
    ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION,
  ]);
  assert.throws(
    () => appendReviewedOrderAccountDeletionAuthority({
      laterMigrations: [ORDER_ACCOUNT_DELETION_AUTHORITY_MIGRATION],
      reviewedSuccessors: ["unreviewed_predecessor"],
      expectedPredecessor: ORDER_STAFF_READ_CHARGED_TOTAL_CORRECTION,
    }),
    /requires its exact reviewed predecessor/u,
  );
});

test("CI isolates, restores, applies, and proves the account-deletion successor", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const verify = ci.indexOf("Verify compatible Order account-deletion authority");
  const isolate = ci.indexOf("Isolate Order account-deletion authority until its predecessors pass");
  const verifyPredecessor = ci.indexOf("Verify dormant Order staff charged-total correction");
  const restorePredecessor = ci.indexOf("Restore Order staff charged-total correction");
  const restore = ci.indexOf("Restore compatible Order account-deletion authority");
  const apply = ci.indexOf("Apply compatible Order participant authority");
  const prove = ci.lastIndexOf("tests/order-account-deletion-authority-postgres.test.mjs");
  assert.ok(verify >= 0 && verify < isolate);
  assert.ok(isolate < verifyPredecessor);
  assert.ok(verifyPredecessor < restorePredecessor);
  assert.ok(restorePredecessor < restore);
  assert.ok(restore < apply && apply < prove);
  assert.equal(
    pkg.scripts["audit:order-account-deletion-authority"],
    "node scripts/verify-order-account-deletion-authority.mjs",
  );
});
