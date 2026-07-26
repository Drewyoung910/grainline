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
    /const POST_FORCE_MIGRATION_NAME =\s+"20260726140000_force_conversation_message_rls"/,
  );
  assert.match(
    script,
    /const POST_FORCE_MIGRATION_SHA256 =\s+"c7f6bbb65c1b0b05c43c2ad450235523587de16f4c8b5ca3289bbff28df33a35"/,
  );
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
  assert.match(script, /FROM public\._prisma_migrations/);
  assert.match(script, /migration\.rowCount !== 1/);
  assert.match(script, /migration\.rows\[0\]\?\.checksum !== POST_FORCE_MIGRATION_SHA256/);
  assert.match(script, /migration\.rows\[0\]\?\.appliedSteps !== 1/);
  assert.match(script, /FORCE migration identity or completion drifted/);
  assert.match(script, /row\.rlsEnabled !== true/);
  assert.match(script, /row\.rlsForced !== POST_FORCE/);
  assert.match(script, /row\.policyCount !== 1/);
  assert.match(script, /collectConversationPolicyIssues\([\s\S]*POST_FORCE/);
  assert.match(script, /collectMessagePolicyIssues\([\s\S]*POST_FORCE/);
  assert.match(script, /async function assertActivatedRuntimeBoundary/);
  assert.match(script, /current_setting\('app\.user_id', true\)/);
  assert.match(script, /caught\?\.code !== "42501"/);
  assert.match(script, /scope: POST_FORCE/);
  assert.match(script, /migrationName: POST_FORCE \? POST_FORCE_MIGRATION_NAME : null/);
  assert.match(script, /migrationSha256: POST_FORCE \? POST_FORCE_MIGRATION_SHA256 : null/);
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
