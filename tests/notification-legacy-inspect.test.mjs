import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertNotificationLegacyInspectionGitState,
  normalizeNotificationLegacyCounts,
  parseNotificationLegacyInspectionConfig,
  writeNotificationLegacyInspectionEvidence,
} from "../scripts/notification-legacy-inspect.mjs";

const DIRECT_URL = "postgresql://neondb_owner:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const COMMIT = "a".repeat(40);
const PREREQUISITE = "saved-search-phase-b-and-runtime-separation-postflights-passed";
const RUNNER_TEMP = "/private/tmp/notification-legacy-inspection-test";

function configEnv() {
  return {
    DIRECT_URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: COMMIT,
    MIGRATION_DB_ROLE: "neondb_owner",
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
      createHash("sha256").update(DIRECT_URL).digest("hex"),
    NOTIFICATION_LEGACY_INSPECT_RELEASE_COMMIT: COMMIT,
    NOTIFICATION_LEGACY_INSPECT_CONFIRM: "inspect-prelaunch-notification-legacy-state",
    NOTIFICATION_RLS_PREREQUISITES_CONFIRMED: PREREQUISITE,
    RUNNER_TEMP,
    NOTIFICATION_LEGACY_INSPECT_EVIDENCE_PATH:
      `${RUNNER_TEMP}/notification-legacy-inspection-${COMMIT}.json`,
  };
}

describe("Notification prelaunch legacy inspection operator", () => {
  const source = fs.readFileSync("scripts/notification-legacy-inspect.mjs", "utf8");
  const accountDeletion = fs.readFileSync("src/lib/accountDeletion.ts", "utf8");
  const blogAdmin = fs.readFileSync("src/app/admin/blog/page.tsx", "utf8");
  const broadcastAdmin = fs.readFileSync("src/app/admin/broadcasts/page.tsx", "utf8");

  it("requires exact main dispatch, source, prerequisite, and inspect acknowledgement", () => {
    assert.equal(parseNotificationLegacyInspectionConfig(configEnv()).mode, "inspect");
    assert.throws(
      () => parseNotificationLegacyInspectionConfig({
        ...configEnv(),
        NOTIFICATION_LEGACY_INSPECT_CONFIRM: "yes",
      }),
      /must match the reviewed inspect value/,
    );
    assert.throws(
      () => parseNotificationLegacyInspectionConfig({
        ...configEnv(),
        NOTIFICATION_RLS_PREREQUISITES_CONFIRMED: "pending",
      }),
      /prerequisites are not explicitly confirmed/,
    );
    for (const drift of [
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_SHA: "b".repeat(40) },
      { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
      { DATABASE_URL: "present" },
      { GRANT_AUDIT_DATABASE_URL: "present" },
    ]) {
      assert.throws(() => parseNotificationLegacyInspectionConfig({ ...configEnv(), ...drift }));
    }
  });

  it("rejects pooler and non-owner targets", () => {
    const poolerUrl = DIRECT_URL.replace(".westus3", "-pooler.westus3");
    assert.throws(
      () => parseNotificationLegacyInspectionConfig({
        ...configEnv(),
        DIRECT_URL: poolerUrl,
        PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
          createHash("sha256").update(poolerUrl).digest("hex"),
      }),
      /not the reviewed direct production owner target/,
    );
    assert.throws(
      () => parseNotificationLegacyInspectionConfig({
        ...configEnv(),
        MIGRATION_DB_ROLE: "grainline_app_runtime",
      }),
      /not the reviewed direct production owner target/,
    );
  });

  it("keeps the standalone operator read-only and pre-RLS only", () => {
    assert.match(source, /row\.rls_enabled !== false/);
    assert.match(source, /row\.rls_forced !== false/);
    assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /CURRENT_USER AS current_user/);
    assert.doesNotMatch(source, /pg_catalog\.current_user/);
    assert.doesNotMatch(source, /DELETE FROM public\."Notification"|LOCK TABLE|\bCOMMIT\b/);
  });

  it("requires the exact clean release checkout before database access", () => {
    assert.deepEqual(
      assertNotificationLegacyInspectionGitState({ head: COMMIT, status: "" }, COMMIT),
      { head: COMMIT, clean: true },
    );
    assert.throws(
      () => assertNotificationLegacyInspectionGitState(
        { head: COMMIT, status: "?? unexpected.sql" },
        COMMIT,
      ),
      /exact clean dispatched commit/,
    );
  });

  it("writes aggregate-only evidence as a mode-0600 regular file", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "notification-legacy-evidence-"));
    const evidencePath = path.join(directory, "evidence.json");
    writeNotificationLegacyInspectionEvidence(evidencePath, {
      status: "passed",
      before: { total: 0, missingSource: 0, missingRelatedUser: 0 },
      retained: { rawRows: false, credentials: false },
    });
    const stat = fs.lstatSync(evidencePath);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.mode & 0o077, 0);
    assert.throws(
      () => writeNotificationLegacyInspectionEvidence(evidencePath, { status: "passed" }),
      /EEXIST/,
    );
  });

  it("pins a protected, serialized, aggregate-only main workflow", () => {
    const workflow = fs.readFileSync(
      ".github/workflows/notification-legacy-inspection.yml",
      "utf8",
    );
    assert.match(workflow, /^\s*workflow_dispatch:/m);
    assert.match(workflow, /^\s+environment: Production$/m);
    assert.match(workflow, /group: production-database-migrations/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /secrets\.PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.match(workflow, /vars\.PRODUCTION_MIGRATION_DIRECT_URL_SHA256/);
    assert.doesNotMatch(workflow, /secrets\.(?:DIRECT_URL|DATABASE_URL)\b/);
    assert.match(workflow, /upload-artifact@v4/);
    assert.match(workflow, /retention-days: 30/);
  });

  it("normalizes only aggregate evidence and rejects malformed counts", () => {
    assert.deepEqual(normalizeNotificationLegacyCounts({
      total_count: "4",
      missing_source_count: "3",
      missing_related_user_count: "2",
    }), { total: 4, missingSource: 3, missingRelatedUser: 2 });
    assert.throws(
      () => normalizeNotificationLegacyCounts({ total_count: "NaN" }),
      /invalid counts/,
    );
  });

  it("removes broad runtime Notification cleanup fallbacks", () => {
    assert.doesNotMatch(accountDeletion, /tx\.notification\.|FROM "Notification"/);
    assert.doesNotMatch(blogAdmin, /tx\.notification\./);
    assert.doesNotMatch(broadcastAdmin, /tx\.notification\./);
    assert.match(blogAdmin, /deleteBlogCommentNotificationServiceRows/);
    assert.match(broadcastAdmin, /deleteSellerBroadcastNotificationServiceRows/);
  });
});
