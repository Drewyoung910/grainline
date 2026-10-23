import assert from "node:assert/strict";
import test from "node:test";
import {
  collectReviewedPendingMigrationIssues,
} from "../scripts/assert-reviewed-pending-migrations.mjs";

const applied = (migration_name) => ({
  migration_name,
  checksum: "1".repeat(64),
  finished_at: new Date("2026-10-12T00:00:00Z"),
  rolled_back_at: null,
  applied_steps_count: "1",
});

const C715 = "20261023040000_repair_resend_failed_event_suppressions";
const C715_CHECKSUM =
  "7f438ca723b05cf2e91a581f48223c0a577fc58715e22ff7176de4206ad8a2c8";
const C1150 = "20261023050000_correct_support_request_email_reuse_privacy";
const C1150_CHECKSUM =
  "9db6f9bf2db0dc1d8b96199e4381a33cea51233521e0a59ba9328caa59d337a1";

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

test("accepts only the exact reviewed Prisma-resolved C-715 row", () => {
  const resolved = {
    ...applied(C715),
    checksum: C715_CHECKSUM,
    applied_steps_count: "0",
  };
  assert.deepEqual(collectReviewedPendingMigrationIssues({
    directoryNames: [C715],
    rows: [resolved],
    expectedPending: [],
  }), []);
  for (const row of [
    { ...resolved, checksum: "0".repeat(64) },
    { ...resolved, finished_at: null },
    { ...resolved, rolled_back_at: new Date("2026-10-12T00:01:00Z") },
    { ...resolved, applied_steps_count: "2" },
  ]) {
    assert.notDeepEqual(collectReviewedPendingMigrationIssues({
      directoryNames: [C715],
      rows: [row],
      expectedPending: [],
    }), []);
  }
});

test("accepts only the exact reviewed Prisma-resolved C-1150 row", () => {
  const resolved = {
    ...applied(C1150),
    checksum: C1150_CHECKSUM,
    applied_steps_count: "0",
  };
  assert.deepEqual(collectReviewedPendingMigrationIssues({
    directoryNames: [C1150],
    rows: [resolved],
    expectedPending: [],
  }), []);
  for (const row of [
    { ...resolved, migration_name: "20261023050000_unreviewed" },
    { ...resolved, checksum: "0".repeat(64) },
    { ...resolved, finished_at: null },
    { ...resolved, rolled_back_at: new Date("2026-10-23T12:01:00Z") },
    { ...resolved, applied_steps_count: "2" },
  ]) {
    assert.notDeepEqual(collectReviewedPendingMigrationIssues({
      directoryNames: [C1150],
      rows: [row],
      expectedPending: [],
    }), []);
  }
});
