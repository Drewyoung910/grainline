import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

describe("Notification RLS ephemeral PostgreSQL proof", () => {
  const proof = fs.readFileSync("scripts/notification-rls-ephemeral-proof.mjs", "utf8");
  const workflow = fs.readFileSync(".github/workflows/notification-rls-ephemeral-proof.yml", "utf8");
  const recipientSql = fs.readFileSync("docs/rls-drafts/notification-recipient-access.sql", "utf8");
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

  it("is hard-limited to the loopback grainline_ci database", () => {
    assert.match(proof, /ephemeral proof refuses a non-loopback database/);
    assert.match(proof, /parsed\.pathname, "\/grainline_ci"/);
    assert.match(proof, /current_user: "ci"/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /persistentStagingChanged: false/);
  });

  it("proves catalog, grants, direct denial, every service family, and both lock orderings", () => {
    assert.match(proof, /relrowsecurity: true/);
    assert.match(proof, /relforcerowsecurity: false/);
    assert.match(proof, /can_insert: false/);
    assert.match(proof, /can_delete: false/);
    assert.match(proof, /can_update_read: true/);
    assert.match(proof, /private notification core/);
    for (const family of [
      "source_fanout",
      "social",
      "message",
      "case",
      "commission",
      "inventory",
      "verification",
      "moderation",
      "account_warning",
      "order",
    ]) {
      assert.match(proof, new RegExp(`label: "${family}"`));
    }
    assert.match(
      proof,
      /service_family_\$\{family\.label\}_valid_replay_and_forged_recipient_rejected/,
    );
    assert.match(
      proof,
      /service_back_in_stock_claim_derives_identity_consumes_once_and_rejects_bad_evidence/,
    );
    assert.match(proof, /notification-proof-block-second/);
    assert.match(proof, /notification-proof-create-second/);
    assert.match(proof, /wait_event_type === "Lock"/);
    assert.match(proof, /recipient RPC p_user_id must come from server-resolved identity/);
    assert.ok(
      (recipientSql.match(/notification\.title::text/g) ?? []).length >= 3,
      "text-returning recipient RPCs must cast varchar title columns",
    );
    assert.ok(
      (recipientSql.match(/notification\.body::text/g) ?? []).length >= 3,
      "text-returning recipient RPCs must cast varchar body columns",
    );
    assert.ok(
      (recipientSql.match(/notification\.link::text/g) ?? []).length >= 3,
      "text-returning recipient RPCs must cast varchar link columns",
    );
  });

  it("runs only on the isolated branch or explicit dispatch against PostgreSQL 16", () => {
    assert.match(workflow, /codex\/rls-bucket-b-notification-20260719/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /paths:[\s\S]*docs\/rls-drafts\/\*\*/);
    assert.match(workflow, /scripts\/notification-rls-ephemeral-proof\.mjs/);
    assert.match(workflow, /scripts\/audit-runtime-db-grants\.mjs/);
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /notification-related-user\.sql[\s\S]*notification-recipient-access\.sql[\s\S]*notification-service-authority\.sql/);
    assert.match(workflow, /Re-converge Notification-aware runtime grants/);
    assert.ok(
      workflow.indexOf("Apply isolated Notification service-authority draft")
        < workflow.indexOf("Re-converge Notification-aware runtime grants"),
    );
    assert.equal(
      packageJson.scripts["audit:rls-notification-ephemeral"],
      "node scripts/notification-rls-ephemeral-proof.mjs",
    );
  });
});
