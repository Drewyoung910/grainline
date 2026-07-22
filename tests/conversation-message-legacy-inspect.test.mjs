import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertConversationMessageLegacyInspectionGitState,
  normalizeConversationMessageLegacyCounts,
  parseConversationMessageLegacyInspectionConfig,
  writeConversationMessageLegacyInspectionEvidence,
} from "../scripts/conversation-message-legacy-inspect.mjs";

const DIRECT_URL = "postgresql://neondb_owner:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const COMMIT = "c".repeat(40);
const RUNNER_TEMP = "/private/tmp/conversation-message-legacy-inspection-test";
const COUNT_FIELDS = [
  "conversation_count",
  "self_conversation_count",
  "noncanonical_conversation_count",
  "duplicate_pair_group_count",
  "empty_conversation_count",
  "context_conversation_count",
  "archived_conversation_count",
  "invalid_conversation_time_count",
  "message_count",
  "invalid_message_pair_count",
  "self_message_count",
  "message_before_conversation_count",
  "message_after_conversation_update_count",
  "ordinary_message_count",
  "custom_request_count",
  "custom_link_count",
  "commission_interest_count",
  "unknown_kind_count",
  "user_authored_marked_system_count",
  "server_card_not_system_count",
  "message_listing_context_count",
  "invalid_message_listing_pair_count",
  "unresolved_thread_report_count",
  "orphan_unresolved_thread_report_count",
  "active_private_custom_listing_count",
  "invalid_private_custom_listing_pair_count",
];

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
    CONVERSATION_MESSAGE_LEGACY_INSPECT_RELEASE_COMMIT: COMMIT,
    CONVERSATION_MESSAGE_LEGACY_INSPECT_CONFIRM:
      "inspect-prelaunch-conversation-message-legacy-state",
    CONVERSATION_MESSAGE_LEGACY_PREREQUISITES_CONFIRMED:
      "notification-force-and-messaging-compatibility-migrations-passed",
    RUNNER_TEMP,
    CONVERSATION_MESSAGE_LEGACY_INSPECT_EVIDENCE_PATH:
      `${RUNNER_TEMP}/conversation-message-legacy-inspection-${COMMIT}.json`,
  };
}

describe("Conversation and Message legacy inspection operator", () => {
  const source = fs.readFileSync("scripts/conversation-message-legacy-inspect.mjs", "utf8");

  it("requires exact main dispatch, source, prerequisites, and acknowledgement", () => {
    assert.equal(parseConversationMessageLegacyInspectionConfig(configEnv()).mode, "inspect");
    for (const drift of [
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_SHA: "d".repeat(40) },
      { CONVERSATION_MESSAGE_LEGACY_INSPECT_CONFIRM: "yes" },
      { CONVERSATION_MESSAGE_LEGACY_PREREQUISITES_CONFIRMED: "pending" },
      { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
      { DATABASE_URL: "present" },
      { GRANT_AUDIT_DATABASE_URL: "present" },
    ]) {
      assert.throws(() => parseConversationMessageLegacyInspectionConfig({ ...configEnv(), ...drift }));
    }
  });

  it("rejects pooler and non-owner targets", () => {
    const poolerUrl = DIRECT_URL.replace(".westus3", "-pooler.westus3");
    assert.throws(
      () => parseConversationMessageLegacyInspectionConfig({
        ...configEnv(),
        DIRECT_URL: poolerUrl,
        PRODUCTION_MIGRATION_DIRECT_URL_SHA256:
          createHash("sha256").update(poolerUrl).digest("hex"),
      }),
      /not the reviewed direct production owner target/,
    );
    assert.throws(
      () => parseConversationMessageLegacyInspectionConfig({
        ...configEnv(),
        MIGRATION_DB_ROLE: "grainline_app_runtime",
      }),
      /not the reviewed direct production owner target/,
    );
  });

  it("uses one aggregate-only repeatable-read transaction", () => {
    assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /CURRENT_USER AS current_user/);
    assert.doesNotMatch(source, /pg_catalog\.current_user/);
    assert.doesNotMatch(source, /SELECT[\s\S]{0,80}\b(?:body|email)\b/i);
    assert.doesNotMatch(source, /\bINSERT INTO\b|\bUPDATE public\.|\bDELETE FROM\b|\bCOMMIT\b/);
    assert.match(source, /invalid_message_pair_count/);
    assert.match(source, /invalid_message_listing_pair_count/);
    assert.match(source, /orphan_unresolved_thread_report_count/);
  });

  it("requires the exact clean dispatched checkout", () => {
    assert.deepEqual(
      assertConversationMessageLegacyInspectionGitState({ head: COMMIT, status: "" }, COMMIT),
      { head: COMMIT, clean: true },
    );
    assert.throws(
      () => assertConversationMessageLegacyInspectionGitState(
        { head: COMMIT, status: "?? unexpected.sql" },
        COMMIT,
      ),
      /exact clean dispatched commit/,
    );
  });

  it("normalizes aggregate counts and rejects malformed output", () => {
    const row = Object.fromEntries(COUNT_FIELDS.map((field, index) => [field, String(index)]));
    const counts = normalizeConversationMessageLegacyCounts(row);
    assert.equal(Object.keys(counts).length, COUNT_FIELDS.length);
    assert.equal(counts.conversationCount, 0);
    assert.equal(counts.invalidPrivateCustomListingPairCount, COUNT_FIELDS.length - 1);
    assert.throws(
      () => normalizeConversationMessageLegacyCounts({ ...row, message_count: "NaN" }),
      /invalid aggregate counts/,
    );
  });

  it("writes only sanitized mode-0600 evidence", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-message-legacy-evidence-"));
    const evidencePath = path.join(directory, "evidence.json");
    writeConversationMessageLegacyInspectionEvidence(evidencePath, {
      status: "passed",
      counts: { conversationCount: 0, messageCount: 0 },
      retained: { rawRows: false, identifiers: false, messageBodies: false, credentials: false },
    });
    const stat = fs.lstatSync(evidencePath);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.mode & 0o077, 0);
    assert.throws(
      () => writeConversationMessageLegacyInspectionEvidence(evidencePath, { status: "passed" }),
      /EEXIST/,
    );
  });

  it("pins a protected serialized aggregate-only workflow", () => {
    const workflow = fs.readFileSync(
      ".github/workflows/conversation-message-legacy-inspection.yml",
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
    assert.match(
      JSON.parse(fs.readFileSync("package.json", "utf8")).scripts?.["ops:conversation-message-legacy-inspect"],
      /conversation-message-legacy-inspect\.mjs/,
    );
  });
});
