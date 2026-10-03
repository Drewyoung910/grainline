import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  USER_EMAIL_ADDRESS_INSPECTION_CONFIRMATION,
  assertUserEmailAddressInspectionGitState,
  normalizeUserEmailAddressCounts,
  parseUserEmailAddressInspectionConfig,
  verifyUserEmailAddressCatalog,
  writeUserEmailAddressInspectionEvidence,
} from "../scripts/user-email-address-production-inspect.mjs";

const COMMIT = "a".repeat(40);
const DIRECT_URL =
  "postgresql://neondb_owner:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const RUNNER_TEMP = "/private/tmp/user-email-address-inspection-test";

function configEnv() {
  return {
    DIRECT_URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: COMMIT,
    MIGRATION_DB_ROLE: "neondb_owner",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
      createHash("sha256").update(DIRECT_URL).digest("hex"),
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    RUNNER_TEMP,
    USER_EMAIL_ADDRESS_INSPECT_CONFIRM:
      USER_EMAIL_ADDRESS_INSPECTION_CONFIRMATION,
    USER_EMAIL_ADDRESS_INSPECT_EVIDENCE_PATH:
      `${RUNNER_TEMP}/user-email-address-production-inspection-${COMMIT}.json`,
    USER_EMAIL_ADDRESS_INSPECT_RELEASE_COMMIT: COMMIT,
  };
}

function acceptedCounts() {
  return {
    total_rows: "8",
    current_rows: "3",
    historical_rows: "5",
    users_with_rows: "3",
    duplicate_current_user_groups: "0",
    duplicate_current_row_excess: "0",
    current_rows_without_matching_active_user: "0",
    active_users_without_current_row: "2",
    active_suppression_key_collision_groups: "0",
  };
}

function acceptedCatalog() {
  return {
    identity: {
      current_user: "neondb_owner",
      session_user: "neondb_owner",
      database_name: "neondb",
      read_only: "on",
      isolation: "repeatable read",
      owner_bypass_rls: true,
      runtime_bypass_rls: false,
      runtime_superuser: false,
      runtime_inherit: false,
    },
    table: {
      table_name: "UserEmailAddress",
      owner_name: "neondb_owner",
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_select: true,
      runtime_insert: true,
      runtime_update: true,
      runtime_delete: true,
    },
    counts: acceptedCounts(),
    indexes: [{
      table_name: "UserEmailAddress",
      index_name: "UserEmailAddress_pkey",
      valid: true,
      ready: true,
      live: true,
      unique_index: true,
      predicate: null,
      expression: null,
    }],
    functions: [{
      function_name: "grainline_case_account_deletion_redact",
      identity_arguments: "text",
      owner_name: "neondb_owner",
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: true,
      leakproof: false,
      volatility: "v",
      parallel_safety: "u",
      function_config: ["search_path=pg_catalog"],
      source_md5: "a".repeat(32),
      contains_dynamic_execute: false,
      nonowner_acl: ["grainline_app_runtime:EXECUTE:false"],
    }],
    triggers: [],
  };
}

test("requires the exact manual main, owner target, digest, and evidence path", () => {
  const config = parseUserEmailAddressInspectionConfig(configEnv());
  assert.equal(config.mode, "production-read-only");
  assert.equal(config.releaseCommit, COMMIT);
  assert.equal(config.identity.username, "neondb_owner");
  for (const drift of [
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_SHA: "b".repeat(40) },
    { USER_EMAIL_ADDRESS_INSPECT_CONFIRM: "yes" },
    { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
    { DATABASE_URL: "present" },
    { GRANT_AUDIT_DATABASE_URL: "present" },
    { MIGRATION_DB_ROLE: "grainline_app_runtime" },
    { USER_EMAIL_ADDRESS_INSPECT_EVIDENCE_PATH: "/private/tmp/wrong.json" },
  ]) {
    assert.throws(() =>
      parseUserEmailAddressInspectionConfig({ ...configEnv(), ...drift }));
  }

  const poolerUrl = DIRECT_URL.replace(".westus3", "-pooler.westus3");
  assert.throws(() => parseUserEmailAddressInspectionConfig({
    ...configEnv(),
    DIRECT_URL: poolerUrl,
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
      createHash("sha256").update(poolerUrl).digest("hex"),
  }), /not the reviewed direct production owner target/u);
});

test("requires the exact clean dispatched checkout before database access", () => {
  assert.deepEqual(
    assertUserEmailAddressInspectionGitState(
      { head: COMMIT, status: "" },
      COMMIT,
    ),
    { head: COMMIT, clean: true },
  );
  assert.throws(
    () => assertUserEmailAddressInspectionGitState(
      { head: COMMIT, status: "?? unexpected.sql" },
      COMMIT,
    ),
    /exact clean dispatched commit/u,
  );
});

test("normalizes only consistent nonnegative aggregate counts", () => {
  assert.deepEqual(normalizeUserEmailAddressCounts(acceptedCounts()), {
    totalRows: 8,
    currentRows: 3,
    historicalRows: 5,
    usersWithRows: 3,
    duplicateCurrentUserGroups: 0,
    duplicateCurrentRowExcess: 0,
    currentRowsWithoutMatchingActiveUser: 0,
    activeUsersWithoutCurrentRow: 2,
    activeSuppressionKeyCollisionGroups: 0,
  });
  assert.throws(
    () => normalizeUserEmailAddressCounts({
      ...acceptedCounts(),
      historical_rows: "4",
    }),
    /partition is inconsistent/u,
  );
  assert.throws(
    () => normalizeUserEmailAddressCounts({
      ...acceptedCounts(),
      duplicate_current_user_groups: "1",
    }),
    /duplicate-current aggregates disagree/u,
  );
});

test("accepts discovery state while surfacing migration blockers", () => {
  assert.deepEqual(verifyUserEmailAddressCatalog(acceptedCatalog()), {
    tableOwner: "neondb_owner",
    rlsEnabled: false,
    rlsForced: false,
    policyCount: 0,
    runtimeCrud: { select: true, insert: true, update: true, delete: true },
    counts: {
      totalRows: 8,
      currentRows: 3,
      historicalRows: 5,
      usersWithRows: 3,
      duplicateCurrentUserGroups: 0,
      duplicateCurrentRowExcess: 0,
      currentRowsWithoutMatchingActiveUser: 0,
      activeUsersWithoutCurrentRow: 2,
      activeSuppressionKeyCollisionGroups: 0,
    },
    duplicateCurrentRowsBlockIndex: false,
    currentHistoryDriftPresent: true,
    supportingIndexesPresent: false,
    preparedAuthorityFunctionCount: 0,
    dependentFunctionCount: 1,
    triggerCount: 0,
    aggregateRowDataOnly: true,
    productionChanged: false,
  });

  const duplicate = acceptedCatalog();
  duplicate.counts.duplicate_current_user_groups = "1";
  duplicate.counts.duplicate_current_row_excess = "2";
  const result = verifyUserEmailAddressCatalog(duplicate);
  assert.equal(result.duplicateCurrentRowsBlockIndex, true);
});

test("rejects an unreviewed database or incomplete catalog shape", () => {
  const wrongDatabase = acceptedCatalog();
  wrongDatabase.identity.database_name = "preview";
  assert.throws(
    () => verifyUserEmailAddressCatalog(wrongDatabase),
    /identity or transaction posture drifted/u,
  );

  const invalidIndex = acceptedCatalog();
  invalidIndex.indexes[0].valid = "true";
  assert.throws(
    () => verifyUserEmailAddressCatalog(invalidIndex),
    /index catalog is incomplete/u,
  );

  const bodyLeak = acceptedCatalog();
  bodyLeak.functions[0].source_md5 = "not-a-hash";
  assert.throws(
    () => verifyUserEmailAddressCatalog(bodyLeak),
    /function catalog is incomplete/u,
  );
});

test("writes only private sanitized evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grainline-user-email-inspect-"));
  const output = path.join(directory, "evidence.json");
  const evidence = {
    status: "passed",
    result: verifyUserEmailAddressCatalog(acceptedCatalog()),
  };
  writeUserEmailAddressInspectionEvidence(output, evidence);
  const stat = fs.lstatSync(output);
  assert.equal(stat.isFile(), true);
  assert.equal(stat.isSymbolicLink(), false);
  assert.equal(stat.mode & 0o077, 0);
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).status, "passed");
  assert.throws(
    () => writeUserEmailAddressInspectionEvidence(
      path.join(directory, "unsafe.json"),
      { email: "private@example.com" },
    ),
    /contains private data/u,
  );
});

test("workflow is exact-main, CI-bound, read-only, and preserves sanitized evidence", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/user-email-address-production-inspection.yml",
    "utf8",
  );
  const script = fs.readFileSync(
    "scripts/user-email-address-production-inspect.mjs",
    "utf8",
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /run\.event !== 'push'/u);
  assert.match(workflow, /run\.head_sha !== sha/u);
  assert.match(workflow, /run\.conclusion !== 'success'/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /group: production-database-inspections/u);
  assert.match(workflow, /include-hidden-files: false/u);
  assert.doesNotMatch(workflow, /DATABASE_URL:/u);
  assert.match(
    script,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/u,
  );
  assert.match(script, /await client\.query\("ROLLBACK"\)/u);
  assert.doesNotMatch(
    script,
    /client\.query\(\s*`?\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/iu,
  );
  assert.doesNotMatch(script, /procedure\.prosrc\s+AS/u);
});
