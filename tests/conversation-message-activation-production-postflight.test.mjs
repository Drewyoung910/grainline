import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(
  new URL(
    "../scripts/conversation-message-compatibility-production-postflight.mjs",
    import.meta.url,
  ),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("post-activation mode pins the exact live release, migration, branch, and deployment", () => {
  assert.match(
    script,
    /const POST_ACTIVATION_RELEASE_COMMIT =\s+"448d5233ed3aad4fc3d88812e98d8ae299a62a42"/,
  );
  assert.match(
    script,
    /const POST_ACTIVATION_MIGRATION_RUN_ID = 30194195844/,
  );
  assert.match(
    script,
    /const POST_ACTIVATION_OPERATOR_BRANCH =\s+"agent\/conversation-message-postactivation-20260726"/,
  );
  assert.match(
    script,
    /const DEPLOYMENT_ID = "dpl_C1rXvRMMJetR25Na4X5yHSa91HpM"/,
  );
  assert.equal(
    packageJson.scripts["ops:conversation-message-activation-postflight"],
    "node scripts/conversation-message-compatibility-production-postflight.mjs --post-activation",
  );
});

test("post-activation mode proves the exact initial RLS policy and grant boundary", () => {
  assert.match(script, /row\.rlsEnabled !== true/);
  assert.match(script, /row\.rlsForced !== false/);
  assert.match(script, /row\.policyCount !== 1/);
  assert.match(script, /row\.canSelect !== true/);
  assert.match(script, /row\.canInsert !== false/);
  assert.match(script, /row\.canUpdate !== false/);
  assert.match(script, /row\.canDelete !== false/);
  assert.match(script, /collectConversationPolicyIssues/);
  assert.match(script, /collectMessagePolicyIssues/);
  assert.match(script, /readConversationPolicyState\(owner\)/);
  assert.match(script, /readMessagePolicyState\(owner\)/);
});

test("post-activation mode uses the actual pooled non-owner runtime and proves denial", () => {
  assert.match(script, /runtimeIdentity\.rows\[0\]\?\.sessionUser !== RUNTIME_ROLE/);
  assert.match(script, /runtimeIdentity\.rows\[0\]\?\.superuser !== false/);
  assert.match(script, /runtimeIdentity\.rows\[0\]\?\.bypassRls !== false/);
  assert.match(script, /runtimeIdentity\.rows\[0\]\?\.memberOfOwner !== false/);
  assert.match(script, /current_setting\('app\.user_id', true\)/);
  assert.match(script, /pooled runtime without user context crossed participant RLS/);
  assert.match(script, /label: "insert"/);
  assert.match(script, /label: "update"/);
  assert.match(script, /label: "delete"/);
  assert.match(script, /caught\?\.code !== "42501"/);
  assert.match(script, /await runtime\.query\("ROLLBACK"\)/);
});

test("post-activation mode retains authenticated isolation and exact cleanup", () => {
  assert.match(script, /await assertPostActivationRuntimeBoundary/);
  assert.match(script, /result = await exerciseRoutes/);
  assert.match(script, /fixtureRowsDeleted/);
  assert.match(script, /sessionRevoked/);
  assert.match(script, /rateLimitCountersReset/);
  assert.match(script, /notificationsCreated: 0/);
  assert.match(script, /emailsSent: 0/);
  assert.match(script, /scope: POST_ACTIVATION/);
  assert.match(script, /pooledRuntimeDirectWritesDenied: POST_ACTIVATION/);
});
