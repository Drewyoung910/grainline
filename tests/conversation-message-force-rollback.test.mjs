import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Conversation and Message FORCE rollback proof", () => {
  const script = readFileSync(
    "scripts/conversation-message-force-rollback-proof.mjs",
    "utf8",
  );
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  it("is loopback-only and retains a dedicated package command", () => {
    assert.match(script, /refuses a non-loopback database/);
    assert.match(script, /requires grainline_ci/);
    assert.equal(
      pkg.scripts["audit:rls-conversation-message-force-rollback"],
      "node scripts/conversation-message-force-rollback-proof.mjs",
    );
  });

  it("commits the narrow NO FORCE rollback and restores exact FORCE state", () => {
    assert.match(
      script,
      /ALTER TABLE public\."Conversation" \$\{command\} ROW LEVEL SECURITY/,
    );
    assert.match(
      script,
      /ALTER TABLE public\."Message" \$\{command\} ROW LEVEL SECURITY/,
    );
    assert.match(script, /const command = force \? "FORCE" : "NO FORCE"/);
    assert.match(script, /SET LOCAL lock_timeout = '10s'/);
    assert.match(script, /SET LOCAL statement_timeout = '60s'/);
    assert.match(script, /IN ACCESS EXCLUSIVE MODE/);
    assert.match(script, /databaseFirstNoForceRollbackVerified: true/);
    assert.match(script, /policiesPreserved: true/);
    assert.match(script, /selectOnlyGrantsPreserved: true/);
    assert.match(script, /runtimeNoContextIsolationPreserved: true/);
    assert.match(script, /exactForceStateRestored: true/);
    assert.match(script, /productionChanged: false/);
    assert.doesNotMatch(
      script,
      /DROP POLICY|DROP FUNCTION|DISABLE ROW LEVEL SECURITY|TRUNCATE/,
    );
  });
});
