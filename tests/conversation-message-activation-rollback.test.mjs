import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const script = readFileSync(
  "scripts/conversation-message-activation-rollback-proof.mjs",
  "utf8",
);

describe("Conversation and Message activation rollback proof", () => {
  it("is loopback-only, transactional, data-preserving, and restores activation", () => {
    assert.match(
      script,
      /CONVERSATION_MESSAGE_ACTIVATION_ROLLBACK_PROOF_DATABASE_URL/,
    );
    assert.match(script, /\["localhost", "127\.0\.0\.1", "::1"\]/);
    assert.match(script, /\/grainline_ci/);
    assert.match(
      script,
      /grainline\.conversation-message\.rls\.activation/,
    );
    assert.match(
      script,
      /LOCK TABLE public\."Conversation", public\."Message" IN ACCESS EXCLUSIVE MODE/,
    );
    assert.match(
      script,
      /ALTER TABLE public\."Conversation" DISABLE ROW LEVEL SECURITY/,
    );
    assert.match(
      script,
      /ALTER TABLE public\."Message" DISABLE ROW LEVEL SECURITY/,
    );
    assert.match(
      script,
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE/,
    );
    assert.match(
      script,
      /ALTER TABLE public\."Conversation" ENABLE ROW LEVEL SECURITY/,
    );
    assert.match(
      script,
      /ALTER TABLE public\."Message" ENABLE ROW LEVEL SECURITY/,
    );
    assert.match(script, /NO FORCE ROW LEVEL SECURITY/g);
    assert.match(script, /rollbackPreservedPoliciesAndFunctions: true/);
    assert.match(script, /oldApplicationDirectCrudCompatible: true/);
    assert.match(script, /fixedRecipientFunctionCompatible: true/);
    assert.match(script, /fixtureResidue: 0/);
    assert.match(script, /productionChanged: false/);
    assert.doesNotMatch(script, /DROP POLICY|DROP FUNCTION|TRUNCATE/);
    assert.doesNotMatch(script, /process\.env\.DATABASE_URL/);
  });
});
