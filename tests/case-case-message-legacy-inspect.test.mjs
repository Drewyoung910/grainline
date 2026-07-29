import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CASE_LEGACY_COUNT_FIELDS,
  CASE_LEGACY_COUNTS_SQL,
  CASE_LEGACY_INSPECTION_CONFIRMATION,
  CASE_LEGACY_PREREQUISITE_CONFIRMATION,
  assertCaseLegacyInspectionGitState,
  assertCaseLegacyPosture,
  normalizeCaseLegacyResult,
  parseCaseLegacyInspectionConfig,
  writeCaseLegacyInspectionEvidence,
} from "../scripts/case-case-message-legacy-inspect.mjs";

const COMMIT = "c".repeat(40);
const DIRECT_URL =
  "postgresql://neondb_owner:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function baseEnv(runnerTemp) {
  return {
    CASE_LEGACY_INSPECT_CONFIRM: CASE_LEGACY_INSPECTION_CONFIRMATION,
    CASE_LEGACY_INSPECT_EVIDENCE_PATH: path.join(
      runnerTemp,
      `case-case-message-legacy-inspection-${COMMIT}.json`,
    ),
    CASE_LEGACY_INSPECT_RELEASE_COMMIT: COMMIT,
    CASE_LEGACY_PREREQUISITES_CONFIRMED:
      CASE_LEGACY_PREREQUISITE_CONFIRMATION,
    DIRECT_URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: COMMIT,
    MIGRATION_DB_ROLE: "neondb_owner",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
      createHash("sha256").update(DIRECT_URL).digest("hex"),
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    RUNNER_TEMP: runnerTemp,
  };
}

function aggregateRow() {
  return {
    ...Object.fromEntries(
      CASE_LEGACY_COUNT_FIELDS.map((field) => [field, "0"]),
    ),
    author_kind_counts: {
      BUYER: 0,
      SELLER: 0,
      STAFF: 0,
      NULL: 0,
    },
    case_resolution_counts: {
      REFUND_FULL: 0,
      REFUND_PARTIAL: 0,
      DISMISSED: 0,
      NULL: 0,
    },
    case_status_counts: {
      OPEN: 0,
      IN_DISCUSSION: 0,
      PENDING_CLOSE: 0,
      UNDER_REVIEW: 0,
      RESOLVED: 0,
      CLOSED: 0,
    },
  };
}

function acceptedPosture() {
  return {
    attachment_owner: "neondb_owner",
    attachment_policy_count: 0,
    attachment_rls_enabled: false,
    attachment_rls_forced: false,
    author_kind_prepared: true,
    case_owner: "neondb_owner",
    case_policy_count: 0,
    case_rls_enabled: false,
    case_rls_forced: false,
    current_user: "neondb_owner",
    database_name: "neondb",
    direct_upload_policy_count: 0,
    direct_upload_prepared: true,
    direct_upload_rls_enabled: false,
    direct_upload_rls_forced: false,
    history_index_present: true,
    message_owner: "neondb_owner",
    message_policy_count: 0,
    message_rls_enabled: false,
    message_rls_forced: false,
    object_key_prepared: true,
    owner_bypass_rls: true,
    reference_policy_count: 0,
    reference_rls_enabled: true,
    reference_rls_forced: true,
    runtime_attachment_crud: true,
    runtime_bypass_rls: false,
    runtime_case_crud: true,
    runtime_message_crud: true,
    runtime_superuser: false,
  };
}

describe("Case and CaseMessage aggregate-only legacy inspection", () => {
  it("requires exact main, owner target, digest, and prerequisite", () => {
    const runnerTemp = mkdtempSync(
      path.join(tmpdir(), "grainline-case-inspect-test-"),
    );
    try {
      const config = parseCaseLegacyInspectionConfig(baseEnv(runnerTemp));
      assert.equal(config.releaseCommit, COMMIT);
      assert.equal(config.identity.username, "neondb_owner");
      for (const drift of [
        { GITHUB_REF: "refs/heads/feature" },
        { GITHUB_EVENT_NAME: "push" },
        { GITHUB_SHA: "d".repeat(40) },
        { CASE_LEGACY_INSPECT_CONFIRM: "yes" },
        { CASE_LEGACY_PREREQUISITES_CONFIRMED: "pending" },
        { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
        { DATABASE_URL: "present" },
        { DIRECT_UPLOAD_CLEANUP_DATABASE_URL: "present" },
        { GRANT_AUDIT_DATABASE_URL: "present" },
        { MIGRATION_DB_ROLE: "grainline_app_runtime" },
      ]) {
        assert.throws(() =>
          parseCaseLegacyInspectionConfig({
            ...baseEnv(runnerTemp),
            ...drift,
          }));
      }
    } finally {
      rmSync(runnerTemp, { force: true, recursive: true });
    }
  });

  it("requires the exact clean dispatched checkout", () => {
    assert.deepEqual(
      assertCaseLegacyInspectionGitState(
        { head: COMMIT, status: "" },
        COMMIT,
      ),
      { clean: true, head: COMMIT },
    );
    assert.throws(
      () =>
        assertCaseLegacyInspectionGitState(
          { head: COMMIT, status: "?? surprise.sql" },
          COMMIT,
        ),
      /exact clean dispatched commit/,
    );
  });

  it("normalizes only the exact aggregate and distribution schema", () => {
    const result = normalizeCaseLegacyResult(aggregateRow());
    assert.equal(
      Object.keys(result.counts).length,
      CASE_LEGACY_COUNT_FIELDS.length,
    );
    assert.equal(result.counts.caseCount, 0);
    assert.equal(result.counts.unrepairableAttachmentRowCount, 0);
    assert.deepEqual(result.distributions.caseStatus, {
      OPEN: 0,
      IN_DISCUSSION: 0,
      PENDING_CLOSE: 0,
      UNDER_REVIEW: 0,
      RESOLVED: 0,
      CLOSED: 0,
    });
    assert.throws(
      () =>
        normalizeCaseLegacyResult({
          ...aggregateRow(),
          raw_case_id: "private",
        }),
      /unexpected aggregate schema/,
    );
    assert.throws(
      () =>
        normalizeCaseLegacyResult({
          ...aggregateRow(),
          case_count: "-1",
        }),
      /invalid aggregate counts/,
    );
    assert.throws(
      () =>
        normalizeCaseLegacyResult({
          ...aggregateRow(),
          author_kind_counts: { BUYER: 0 },
        }),
      /unexpected author_kind_counts schema/,
    );
  });

  it("requires the exact compatible pre-RLS production posture", () => {
    assert.deepEqual(
      assertCaseLegacyPosture(acceptedPosture()),
      { accepted: true },
    );
    for (const drift of [
      { case_rls_enabled: true },
      { runtime_case_crud: false },
      { author_kind_prepared: false },
      { object_key_prepared: false },
      { direct_upload_rls_enabled: true },
      { reference_rls_forced: false },
      { case_policy_count: 1 },
      { current_user: "grainline_app_runtime" },
    ]) {
      assert.throws(() =>
        assertCaseLegacyPosture({
          ...acceptedPosture(),
          ...drift,
        }));
    }
  });

  it("uses one read-only aggregate query covering each legacy decision family", () => {
    const script = readFileSync(
      "scripts/case-case-message-legacy-inspect.mjs",
      "utf8",
    );
    assert.match(
      script,
      /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/,
    );
    assert.match(script, /transaction_read_only/);
    assert.match(script, /ROLLBACK/);
    assert.doesNotMatch(
      CASE_LEGACY_COUNTS_SQL,
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
    for (const field of CASE_LEGACY_COUNT_FIELDS) {
      assert.match(CASE_LEGACY_COUNTS_SQL, new RegExp(`\\b${field}\\b`));
    }
    for (const family of [
      "order_seller_summary",
      "message_ties",
      "attachment_reference_counts",
      "case_anomalies",
      "message_anomalies",
      "attachment_anomalies",
      "case_attachment_reference_anomalies",
      "case_attachment_claim_anomalies",
      "CaseMessageAuthorKind",
      "CASE_MESSAGE_ATTACHMENT",
    ]) {
      assert.match(CASE_LEGACY_COUNTS_SQL, new RegExp(family));
    }
  });

  it("keeps the workflow owner-only, manual-main, and aggregate-only", () => {
    const workflow = readFileSync(
      ".github/workflows/case-case-message-legacy-inspection.yml",
      "utf8",
    );
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /^\s*schedule:/m);
    assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /environment: Production/);
    assert.match(workflow, /persist-credentials: false/);
    assert.match(workflow, /PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.doesNotMatch(workflow, /\bDATABASE_URL:/);
    assert.doesNotMatch(
      workflow,
      /DIRECT_UPLOAD_CLEANUP_DATABASE_URL:/,
    );
  });

  it("writes only a fresh private evidence file", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "grainline-case-evidence-test-"),
    );
    const pathname = path.join(directory, "evidence.json");
    try {
      writeCaseLegacyInspectionEvidence(pathname, {
        inventory: normalizeCaseLegacyResult(aggregateRow()),
        operation: "case-case-message-legacy-inspection",
      });
      assert.equal(statSync(pathname).mode & 0o777, 0o600);
      const serialized = readFileSync(pathname, "utf8");
      assert.match(serialized, /case-case-message-legacy-inspection/);
      assert.doesNotMatch(serialized, /postgresql:\/\//);
      assert.doesNotMatch(serialized, /caseId|authorId|objectKey/);
      assert.throws(
        () =>
          writeCaseLegacyInspectionEvidence(pathname, {
            operation: "overwrite",
          }),
        /EEXIST/,
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
