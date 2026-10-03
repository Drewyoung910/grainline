import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  FAILED_USER_EMAIL_ADDRESS_INDEX_SHA256,
  USER_EMAIL_ADDRESS_PREPARATION_FAILED_RUN_ID,
  USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS,
  classifyUserEmailAddressPreparationRecoveryLedger,
  inspectUserEmailAddressPreparationRecovery,
  parseUserEmailAddressPreparationRecoveryConfig,
} from "../scripts/user-email-address-preparation-production-recovery.mjs";

const COMMIT = "a".repeat(40);
const DIRECT_URL =
  "postgresql://neondb_owner:owner-password@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const DIRECT_URL_SHA256 = createHash("sha256").update(DIRECT_URL).digest("hex");
const STARTED = new Date("2026-10-03T08:19:00.000Z");
const FINISHED = new Date("2026-10-03T08:20:00.000Z");
const ROLLED_BACK = new Date("2026-10-03T10:00:00.000Z");

function environment(overrides = {}) {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "Drewyoung910/grainline",
    GITHUB_RUN_ID: "37120000001",
    GITHUB_SHA: COMMIT,
    RUNNER_TEMP: "/tmp",
    DIRECT_URL,
    MIGRATION_DB_ROLE: "neondb_owner",
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    PRODUCTION_MIGRATION_CONFIRM:
      "run-reviewed-production-migrations-from-main",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256: DIRECT_URL_SHA256,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: COMMIT,
    USER_EMAIL_ADDRESS_FAILED_RUN_ID:
      USER_EMAIL_ADDRESS_PREPARATION_FAILED_RUN_ID,
    USER_EMAIL_ADDRESS_RECOVERY_CONFIRM:
      "recover-user-email-address-preparation-exact",
    USER_EMAIL_ADDRESS_RECOVERY_EVIDENCE_PATH: `/tmp/user-email-address-preparation-recovery-${COMMIT}-inspect.json`,
    USER_EMAIL_ADDRESS_RECOVERY_MAIN_CI_RUN_ID: "37120000000",
    ...overrides,
  };
}

function failedRow(rolledBackAt = null) {
  return {
    migration_name: USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS[0].name,
    checksum: FAILED_USER_EMAIL_ADDRESS_INDEX_SHA256,
    started_at: STARTED,
    finished_at: null,
    rolled_back_at: rolledBackAt,
    applied_steps_count: 0,
  };
}

function appliedRow(migration) {
  return {
    migration_name: migration.name,
    checksum: migration.sha256,
    started_at: STARTED,
    finished_at: FINISHED,
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function ownerRole() {
  return {
    rolname: "neondb_owner",
    rolsuper: false,
    rolcreatedb: true,
    rolcreaterole: true,
    rolinherit: true,
    rolcanlogin: true,
    rolreplication: true,
    rolbypassrls: true,
    memberships: [
      "grainline_app_runtime",
      "grainline_direct_upload_cleanup_v2",
      "neon_superuser",
    ],
    membership_options: [
      {
        role: "grainline_app_runtime",
        adminOption: true,
        inheritOption: false,
        setOption: false,
      },
      {
        role: "grainline_direct_upload_cleanup_v2",
        adminOption: true,
        inheritOption: false,
        setOption: false,
      },
      {
        role: "neon_superuser",
        adminOption: false,
        inheritOption: true,
        setOption: true,
      },
    ],
  };
}

function baseState(incompleteMigrationCount) {
  return {
    identity: {
      database_name: "neondb",
      current_user_name: "neondb_owner",
      session_user_name: "neondb_owner",
    },
    ownerRole: ownerRole(),
    runtimeRole: {
      rolname: "grainline_app_runtime",
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolcanlogin: true,
      rolreplication: false,
      rolbypassrls: false,
      memberships: [],
      membership_options: [],
    },
    staffReadRole: null,
    savedSearch: {
      rls_enabled: true,
      rls_forced: true,
      owner_name: "neondb_owner",
      policy_count: 3,
    },
    incompleteMigrationCount,
  };
}

function catalog(prepared = false, activeSuppressionKeyCollisionGroups = 0) {
  return {
    result: {
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeCrud: { select: true, insert: true, update: true, delete: true },
      counts: {
        duplicateCurrentUserGroups: 0,
        duplicateCurrentRowExcess: 0,
        currentRowsWithoutMatchingActiveUser: 0,
        activeUsersWithoutCurrentRow: prepared ? 0 : 1,
        activeSuppressionKeyCollisionGroups,
      },
      supportingIndexesPresent: prepared,
      preparedAuthorityFunctionCount: prepared ? 4 : 0,
      currentHistoryDriftPresent: !prepared,
    },
  };
}

test("recovery configuration is exact-run, exact-commit, and exact-evidence bound", () => {
  const parsed = parseUserEmailAddressPreparationRecoveryConfig(environment(), [
    "--inspect",
  ]);
  assert.equal(
    parsed.failedRunId,
    USER_EMAIL_ADDRESS_PREPARATION_FAILED_RUN_ID,
  );
  assert.equal(parsed.releaseCommit, COMMIT);
  assert.equal(parsed.mode, "inspect");
  for (const drift of [
    { USER_EMAIL_ADDRESS_FAILED_RUN_ID: "37109191879" },
    { USER_EMAIL_ADDRESS_RECOVERY_CONFIRM: "yes" },
    { GITHUB_SHA: "b".repeat(40) },
    { DATABASE_URL: "forbidden" },
  ]) {
    assert.throws(() =>
      parseUserEmailAddressPreparationRecoveryConfig(environment(drift), [
        "--inspect",
      ]),
    );
  }
});

test("ledger classifier accepts only failed, resolved, or fully prepared states", () => {
  assert.equal(
    classifyUserEmailAddressPreparationRecoveryLedger([failedRow()]),
    "failed",
  );
  assert.equal(
    classifyUserEmailAddressPreparationRecoveryLedger([failedRow(ROLLED_BACK)]),
    "resolved",
  );
  assert.equal(
    classifyUserEmailAddressPreparationRecoveryLedger([
      failedRow(ROLLED_BACK),
      ...USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS.map(appliedRow),
    ]),
    "prepared",
  );
  assert.throws(
    () =>
      classifyUserEmailAddressPreparationRecoveryLedger([
        { ...failedRow(), applied_steps_count: 1 },
      ]),
    /zero-step/,
  );
  assert.throws(
    () =>
      classifyUserEmailAddressPreparationRecoveryLedger([
        failedRow(ROLLED_BACK),
        appliedRow(USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS[0]),
      ]),
    /corrected preparation/,
  );
});

test("read-only recovery inspection admits the one exact failure and no other drift", async () => {
  const config = {
    directUrl: DIRECT_URL,
    directUrlSha256: DIRECT_URL_SHA256,
    failedRunId: USER_EMAIL_ADDRESS_PREPARATION_FAILED_RUN_ID,
    mainCiRunId: "37120000000",
    mode: "inspect",
    recoveryRunId: "37120000001",
    releaseCommit: COMMIT,
  };
  const result = await inspectUserEmailAddressPreparationRecovery(config, {
    readGitState: () => ({ head: COMMIT, status: "" }),
    readLedgerState: async () => ({
      rows: [failedRow()],
      incomplete: [
        {
          migration_name: USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS[0].name,
          checksum: FAILED_USER_EMAIL_ADDRESS_INDEX_SHA256,
          applied_steps_count: 0,
        },
      ],
    }),
    readBaseState: async () => baseState(1),
    readCatalog: async () => catalog(false),
  });
  assert.equal(result.state, "failed");
  assert.equal(result.ledger.failedZeroStepRowPresent, true);
  assert.equal(result.productionChanged, false);
});

test("recovery admits nonunique active suppression-key collisions", async () => {
  const config = {
    directUrl: DIRECT_URL,
    directUrlSha256: DIRECT_URL_SHA256,
    failedRunId: USER_EMAIL_ADDRESS_PREPARATION_FAILED_RUN_ID,
    mainCiRunId: "37120000000",
    mode: "inspect",
    recoveryRunId: "37120000001",
    releaseCommit: COMMIT,
  };
  const result = await inspectUserEmailAddressPreparationRecovery(config, {
    readGitState: () => ({ head: COMMIT, status: "" }),
    readLedgerState: async () => ({
      rows: [failedRow()],
      incomplete: [
        {
          migration_name: USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS[0].name,
          checksum: FAILED_USER_EMAIL_ADDRESS_INDEX_SHA256,
          applied_steps_count: 0,
        },
      ],
    }),
    readBaseState: async () => baseState(1),
    readCatalog: async () => catalog(false, 1),
  });
  assert.equal(result.catalog.counts.activeSuppressionKeyCollisionGroups, 1);
  assert.equal(result.productionChanged, false);
});

test("resolved and prepared assertions are state-specific", async () => {
  const shared = {
    directUrl: DIRECT_URL,
    directUrlSha256: DIRECT_URL_SHA256,
    failedRunId: USER_EMAIL_ADDRESS_PREPARATION_FAILED_RUN_ID,
    mainCiRunId: "37120000000",
    recoveryRunId: "37120000001",
    releaseCommit: COMMIT,
  };
  const preparedRows = [
    failedRow(ROLLED_BACK),
    ...USER_EMAIL_ADDRESS_PREPARATION_MIGRATIONS.map(appliedRow),
  ];
  for (const [mode, rows, prepared] of [
    ["resolved", [failedRow(ROLLED_BACK)], false],
    ["prepared", preparedRows, true],
  ]) {
    const result = await inspectUserEmailAddressPreparationRecovery(
      { ...shared, mode },
      {
        readGitState: () => ({ head: COMMIT, status: "" }),
        readLedgerState: async () => ({ rows, incomplete: [] }),
        readBaseState: async () => baseState(0),
        readCatalog: async () => catalog(prepared),
      },
    );
    assert.equal(result.state, mode);
  }
});
