import assert from "node:assert/strict";
import test from "node:test";
import {
  collectReviewedPendingMigrationIssues,
} from "../scripts/assert-reviewed-pending-migrations.mjs";

const applied = (migration_name) => ({
  migration_name,
  finished_at: new Date("2026-10-12T00:00:00Z"),
  rolled_back_at: null,
  applied_steps_count: "1",
});

test("accepts only the exact reviewed pending migration set", () => {
  const directories = ["20261001000000_first", "20261002000000_second"];
  assert.deepEqual(collectReviewedPendingMigrationIssues({
    directoryNames: directories,
    rows: [applied(directories[0])],
    expectedPending: [directories[1]],
  }), []);
  assert.match(collectReviewedPendingMigrationIssues({
    directoryNames: directories,
    rows: [],
    expectedPending: [directories[1]],
  }).join("\n"), /pending migration set drifted/u);
});

test("rejects unresolved partial, rolled-back-only, and duplicate migration ledger rows", () => {
  const name = "20261001000000_first";
  for (const rows of [
    [{ ...applied(name), finished_at: null }],
    [{ ...applied(name), rolled_back_at: new Date("2026-10-12T00:01:00Z") }],
    [applied(name), applied(name)],
  ]) {
    assert.notDeepEqual(collectReviewedPendingMigrationIssues({
      directoryNames: [name],
      rows,
      expectedPending: [],
    }), []);
  }
});

test("accepts one successful retry after a separately recorded rollback", () => {
  const name = "20261001000000_first";
  assert.deepEqual(collectReviewedPendingMigrationIssues({
    directoryNames: [name],
    rows: [
      { ...applied(name), finished_at: null, rolled_back_at: new Date("2026-10-12T00:00:00Z"), applied_steps_count: "0" },
      applied(name),
    ],
    expectedPending: [],
  }), []);
});
