import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  POSTFLIGHT_CONFIRMATION,
  PREPARATION_DEPLOYMENT_ID,
  PREPARATION_MIGRATION_RUN_ID,
  PREPARATION_RELEASE_COMMIT,
  parseProductionInvariantPostflightConfig,
} from "../scripts/conversation-message-invariant-production-postflight.mjs";

const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function environment(overrides = {}) {
  return {
    CONVERSATION_MESSAGE_INVARIANT_POSTFLIGHT_CONFIRM:
      POSTFLIGHT_CONFIRMATION,
    DATABASE_URL: RUNTIME_URL,
    ...overrides,
  };
}

describe("Conversation/Message production invariant postflight", () => {
  it("accepts only the reviewed production pooled runtime identity", () => {
    const config = parseProductionInvariantPostflightConfig(environment());
    assert.equal(config.runtimeGuard.runtimeRole, "grainline_app_runtime");
    assert.equal(config.runtimeGuard.endpointId, "ep-plain-river-aaqg8gj4");
    assert.equal(config.runtimeGuard.runtimeDatabaseVerified, true);
    assert.equal(config.releaseCommit, PREPARATION_RELEASE_COMMIT);
    assert.equal(config.deploymentId, PREPARATION_DEPLOYMENT_ID);
    assert.equal(config.migrationRunId, PREPARATION_MIGRATION_RUN_ID);
  });

  it("rejects missing confirmation, owner/direct/other targets, aliases, and session overrides", () => {
    const cases = [
      { CONVERSATION_MESSAGE_INVARIANT_POSTFLIGHT_CONFIRM: "yes" },
      { DATABASE_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner") },
      { DATABASE_URL: RUNTIME_URL.replace("-pooler", "") },
      { DATABASE_URL: RUNTIME_URL.replace("ep-plain-river-aaqg8gj4", "ep-other") },
      { DIRECT_URL: "present" },
      { OTHER_DATABASE_URL: RUNTIME_URL },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { PGOPTIONS: "-c row_security=off" },
    ];
    for (const drift of cases) {
      assert.throws(
        () => parseProductionInvariantPostflightConfig(
          environment(drift),
        ),
      );
    }
  });

  it("keeps every synthetic write rollback-only and pins the release catalog checks", () => {
    const source = fs.readFileSync(
      "scripts/conversation-message-invariant-production-postflight.mjs",
      "utf8",
    );
    assert.match(source, /await client\.query\("BEGIN"\)/);
    assert.match(source, /await client\.query\("ROLLBACK"\)/);
    assert.doesNotMatch(source, /client\.query\("COMMIT"\)/);
    assert.match(source, /remainingFixtureRows/);
    assert.match(source, /conversationMessageRlsEnabled: false/);
    assert.match(source, /policyCount: 0/);
    assert.match(source, /runtime_can_execute/);
    assert.match(source, /public_execute_revoked/);
    assert.match(source, /Message_body_trgm_idx/);
    assert.match(source, /forged Message route/);
    assert.match(source, /direct runtime trigger-function execution/);
    assert.doesNotMatch(
      source,
      /\bAS\s+(?:constraint|current_user|session_user|table|user)\b/i,
    );
    assert.doesNotMatch(source, /\.toISOString\(\)/);
    assert.match(source, /matches_message_created_at/);
    assert.match(source, /pg_catalog\.to_char\(/);
  });
});
