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

test("post-FORCE mode pins the exact release, migration run, and operator branch", () => {
  assert.match(
    script,
    /const POST_FORCE_RELEASE_COMMIT =\s+"f23ac2da6843671d1353bbbbeada65530b575cc8"/,
  );
  assert.match(script, /const POST_FORCE_MIGRATION_RUN_ID = 30207825683/);
  assert.match(
    script,
    /const POST_FORCE_OPERATOR_BRANCH =\s+"agent\/conversation-message-force-postflight-20260726"/,
  );
  assert.equal(
    packageJson.scripts["ops:conversation-message-force-postflight"],
    "node scripts/conversation-message-compatibility-production-postflight.mjs --post-force",
  );
});

test("post-FORCE mode is distinct, mutually exclusive, and preserves prior modes", () => {
  assert.match(script, /const POST_FORCE_FLAG = "--post-force"/);
  assert.match(script, /const ACTIVATED = POST_ACTIVATION \|\| POST_FORCE/);
  assert.match(script, /POST_ACTIVATION && POST_FORCE/);
  assert.match(script, /--post-activation and --post-force are mutually exclusive/);
  assert.match(script, /\[--post-activation\|--post-force\]/);
  assert.match(script, /const MODE_FLAG = POST_FORCE/);
});

test("post-FORCE mode proves exact forced catalog and pooled-runtime authority", () => {
  assert.match(script, /row\.rlsEnabled !== true/);
  assert.match(script, /row\.rlsForced !== POST_FORCE/);
  assert.match(script, /row\.policyCount !== 1/);
  assert.match(script, /collectConversationPolicyIssues\([\s\S]*POST_FORCE/);
  assert.match(script, /collectMessagePolicyIssues\([\s\S]*POST_FORCE/);
  assert.match(script, /async function assertActivatedRuntimeBoundary/);
  assert.match(script, /current_setting\('app\.user_id', true\)/);
  assert.match(script, /caught\?\.code !== "42501"/);
  assert.match(script, /scope: POST_FORCE/);
  assert.match(script, /rlsForced: POST_FORCE/);
});

test("post-FORCE evidence stays sanitized and cleanup remains exact", () => {
  assert.match(script, /writePrivateJson\(evidencePath, evidence\)/);
  assert.match(script, /chmodSync\(filePath, 0o600\)/);
  assert.match(script, /fixtureRowsDeleted/);
  assert.match(script, /sessionRevoked/);
  assert.match(script, /rateLimitCountersReset/);
  assert.match(script, /notificationsCreated: 0/);
  assert.match(script, /emailsSent: 0/);
  assert.match(script, /postflight: POST_FORCE/);
});
