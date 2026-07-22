import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const proof = fs.readFileSync("scripts/notification-rls-rollback-proof.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/notification-rls-ephemeral-proof.yml", "utf8");

describe("Notification database-first rollback proof", () => {
  it("is hard-limited to disposable loopback PostgreSQL", () => {
    assert.match(proof, /rollback proof refuses a non-loopback database/);
    assert.match(proof, /parsed\.pathname, "\/grainline_ci"/);
    assert.match(proof, /session_user: "ci"/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /persistentStagingChanged: false/);
  });

  it("restores legacy access database-first while preserving the new RPC surface", () => {
    const disable = proof.indexOf('DISABLE ROW LEVEL SECURITY');
    const broadGrant = proof.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE');
    const directCrud = proof.indexOf('Old app rollback update');
    const recipientRpc = proof.indexOf('grainline_notification_bell($1, 20)');
    const restore = proof.indexOf('async function restoreActivation');
    assert.ok(restore >= 0 && disable > restore && broadGrant > disable);
    assert.ok(directCrud > broadGrant && recipientRpc > broadGrant);
    assert.match(proof, /can_execute_core: false/);
    assert.match(proof, /rollbackPreservedPoliciesAndFunctions: true/);
    assert.match(proof, /oldApplicationDirectCrudCompatible: true/);
    assert.match(proof, /newApplicationRecipientRpcsCompatible: true/);
  });

  it("restores exact FORCE activation and says the destructive purge is irreversible", () => {
    assert.match(proof, /REVOKE ALL ON TABLE public\."Notification" FROM PUBLIC, grainline_app_runtime/);
    assert.match(proof, /GRANT UPDATE \(read\)/);
    assert.match(proof, /ENABLE ROW LEVEL SECURITY/);
    assert.match(proof, /FORCE ROW LEVEL SECURITY/);
    assert.match(proof, /exactForceActivationRestored: true/);
    assert.match(proof, /activationPurgeReversible: false/);
  });

  it("runs after activation and before the final authority proof", () => {
    const activation = workflow.indexOf(
      "Apply current migrations including committed Notification FORCE",
    );
    const rollback = workflow.indexOf("Prove database-first Notification rollback");
    const finalProof = workflow.indexOf("Prove Notification RLS and service authority");
    assert.ok(activation >= 0 && activation < rollback && rollback < finalProof);
  });
});
