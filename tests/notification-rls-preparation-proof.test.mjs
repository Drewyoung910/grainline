import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const proof = fs.readFileSync("scripts/notification-rls-preparation-proof.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/notification-rls-ephemeral-proof.yml", "utf8");

describe("Notification preparation compatibility proof", () => {
  it("is loopback-only and keeps persistent environments untouched", () => {
    assert.match(proof, /preparation proof refuses a non-loopback database/);
    assert.match(proof, /parsed\.pathname, "\/grainline_ci"/);
    assert.match(proof, /session_user: "ci"/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /persistentStagingChanged: false/);
  });

  it("pins disabled RLS, no policies, old CRUD, and new RPC execution", () => {
    assert.match(proof, /relrowsecurity: false/);
    assert.match(proof, /relforcerowsecurity: false/);
    assert.match(proof, /policy_count: 0/);
    assert.match(proof, /can_insert: true/);
    assert.match(proof, /can_update: true/);
    assert.match(proof, /can_delete: true/);
    assert.match(proof, /can_execute_core: false/);
    assert.match(proof, /can_execute_bell: true/);
    assert.match(proof, /can_execute_social: true/);
    assert.match(proof, /grainline_notification_bell/);
    assert.match(proof, /grainline_notification_mark_one_read/);
    assert.match(proof, /grainline_notification_create_social_event/);
  });

  it("leaves one exact row for the activation migration purge", () => {
    assert.match(proof, /notification-preparation-proof-legacy-row/);
    assert.match(proof, /legacyRowLeftForLockedActivationPurge: true/);
    assert.match(
      proof,
      /const directDelete = await runtime\.query\([\s\S]*?DELETE FROM public\."Notification" WHERE id = \$1 RETURNING id[\s\S]*?\[fixture\.deletedId\]/,
    );
    assert.match(
      proof,
      /const retained = await owner\.query\([\s\S]*?WHERE id = \$1`[\s\S]*?\[fixture\.legacyId\]/,
    );
  });

  it("retains the historical preparation proof without replaying it after promotion", () => {
    assert.match(workflow, /Verify committed Notification activation release artifact/);
    assert.match(workflow, /Apply current migrations including committed Notification activation/);
    assert.doesNotMatch(workflow, /audit:rls-notification-preparation(?:\s|$)/);
    assert.doesNotMatch(workflow, /--stage-(?:preparation|activation)/);
  });
});
