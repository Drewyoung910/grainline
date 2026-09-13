import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  AUTHORITY_MAIN_CI_RUN_ID,
  AUTHORITY_MIGRATION_NAME,
  AUTHORITY_POSTFLIGHT_CONFIRMATION,
  AUTHORITY_RELEASE_COMMIT,
  parseAuthorityProductionPostflightConfig,
  writeAuthorityPostflightEvidence,
} from "../scripts/conversation-message-authority-production-postflight.mjs";

const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function testDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cm-authority-postflight-"));
}

function environment(directory, overrides = {}) {
  return {
    CONVERSATION_MESSAGE_AUTHORITY_POSTFLIGHT_CONFIRM:
      AUTHORITY_POSTFLIGHT_CONFIRMATION,
    CONVERSATION_MESSAGE_AUTHORITY_MIGRATION_RUN_ID: "30190000000",
    CONVERSATION_MESSAGE_AUTHORITY_POSTFLIGHT_EVIDENCE_PATH:
      path.join(
        directory,
        `conversation-message-authority-production-postflight-${AUTHORITY_RELEASE_COMMIT}.json`,
      ),
    DATABASE_URL: RUNTIME_URL,
    ...overrides,
  };
}

describe("Conversation/Message authority production postflight", () => {
  it("accepts only the exact pooled production runtime target and fresh evidence path", () => {
    const directory = testDirectory();
    try {
      const config = parseAuthorityProductionPostflightConfig(
        environment(directory),
      );
      assert.equal(config.runtimeGuard.runtimeRole, "grainline_app_runtime");
      assert.equal(config.runtimeGuard.endpointId, "ep-plain-river-aaqg8gj4");
      assert.equal(config.runtimeGuard.runtimeDatabaseVerified, true);
      assert.equal(config.migrationRunId, 30190000000);
      assert.equal(AUTHORITY_RELEASE_COMMIT.length, 40);
      assert.equal(AUTHORITY_MAIN_CI_RUN_ID, 30185597811);
      assert.equal(
        AUTHORITY_MIGRATION_NAME,
        "20260726022500_prepare_conversation_message_authority",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects confirmation, run-id, target, alias, override, and evidence drift", () => {
    const cases = [
      { CONVERSATION_MESSAGE_AUTHORITY_POSTFLIGHT_CONFIRM: "yes" },
      { CONVERSATION_MESSAGE_AUTHORITY_MIGRATION_RUN_ID: "0" },
      { CONVERSATION_MESSAGE_AUTHORITY_MIGRATION_RUN_ID: "not-a-run" },
      { DATABASE_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner") },
      { DATABASE_URL: RUNTIME_URL.replace("-pooler", "") },
      { DATABASE_URL: RUNTIME_URL.replace("ep-plain-river-aaqg8gj4", "ep-other") },
      { DIRECT_URL: "present" },
      { OTHER_DATABASE_URL: RUNTIME_URL },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { PGOPTIONS: "-c row_security=off" },
      {
        CONVERSATION_MESSAGE_AUTHORITY_POSTFLIGHT_EVIDENCE_PATH:
          "/tmp/wrong-name.json",
      },
    ];
    for (const drift of cases) {
      const directory = testDirectory();
      try {
        assert.throws(
          () => parseAuthorityProductionPostflightConfig(
            environment(directory, drift),
          ),
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("writes sanitized evidence once with owner-only permissions", () => {
    const directory = testDirectory();
    try {
      const evidencePath = environment(directory)
        .CONVERSATION_MESSAGE_AUTHORITY_POSTFLIGHT_EVIDENCE_PATH;
      writeAuthorityPostflightEvidence(evidencePath, {
        status: "passed",
        productionChangedByPostflight: false,
      });
      assert.equal(
        fs.statSync(evidencePath).mode & 0o777,
        0o600,
      );
      assert.deepEqual(
        JSON.parse(fs.readFileSync(evidencePath, "utf8")),
        {
          status: "passed",
          productionChangedByPostflight: false,
        },
      );
      assert.throws(
        () => writeAuthorityPostflightEvidence(evidencePath, {}),
        { code: "EEXIST" },
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("is read-only and pins the exact migration, catalog, ACL, and denial proof", () => {
    const source = fs.readFileSync(
      "scripts/conversation-message-authority-production-postflight.mjs",
      "utf8",
    );
    assert.match(source, /BEGIN TRANSACTION READ ONLY/);
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO|FROM|public\.)/i);
    assert.match(source, /public\."_prisma_migrations"/);
    assert.match(source, /can_read_migration_history: false/);
    assert.match(source, /CONVERSATION_MESSAGE_AUTHORITY_RELEASE\.sha256/);
    assert.match(source, /collectConversationMessageFunctionIssues/);
    assert.match(source, /CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS\.length/);
    assert.match(source, /CONVERSATION_MESSAGE_PRIVATE_FUNCTION_NAMES\.length/);
    assert.match(source, /"42501"/);
    assert.match(source, /conversationMessageRlsEnabled: false/);
    assert.match(source, /oldApplicationDirectCrudCompatible: true/);
    assert.match(source, /postflightReadOnly: true/);
    assert.match(source, /productionChangedByPostflight: false/);
  });
});
