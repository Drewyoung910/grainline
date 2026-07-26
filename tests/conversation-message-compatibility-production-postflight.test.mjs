import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptPath = new URL(
  "../scripts/conversation-message-compatibility-production-postflight.mjs",
  import.meta.url,
);
const script = await readFile(scriptPath, "utf8");

test("compatibility postflight is pinned to the reviewed release and deployment", () => {
  assert.match(
    script,
    /const RELEASE_COMMIT = "650d1dd818ac3694f7fd6da9954aaf053786cc40"/,
  );
  assert.match(
    script,
    /const DEPLOYMENT_ID = "dpl_C1rXvRMMJetR25Na4X5yHSa91HpM"/,
  );
  assert.match(script, /verifyProductionDeployment\(\)/);
  assert.match(script, /merge-base", "--is-ancestor", RELEASE_COMMIT, "HEAD"/);
});

test("compatibility postflight proves the explicit RLS-off boundary", () => {
  assert.match(script, /row\.rlsEnabled !== false/);
  assert.match(script, /row\.rlsForced !== false/);
  assert.match(script, /row\.policyCount !== 0/);
  assert.match(script, /row\.canSelect !== true/);
  assert.match(script, /row\.canInsert !== true/);
  assert.match(script, /row\.canUpdate !== true/);
  assert.match(script, /row\.canDelete !== true/);
  assert.match(script, /legacyTableCrudRetained: true/);
});

test("compatibility postflight covers authenticated owner and foreign routes", () => {
  assert.match(script, /\/api\/messages\/\$\{ownConversationId\}\/list/);
  assert.match(script, /\/api\/messages\/\$\{foreignConversationId\}\/list/);
  assert.match(script, /\/api\/messages\/unread-count/);
  assert.match(script, /\/api\/messages\/\$\{ownConversationId\}\/read/);
  assert.match(script, /fetchPage\("\/messages", token\)/);
  assert.match(script, /fetchPage\(`\/messages\/\$\{ownConversationId\}`/);
  assert.match(script, /fetchPage\(`\/messages\/\$\{foreignConversationId\}`/);
  assert.match(script, /origin: "https:\/\/example\.invalid"/);
  assert.match(script, /Invalid message cursor/);
});

test("compatibility postflight fixture authority uses the installed functions", () => {
  assert.match(script, /public\.grainline_conversation_start\(\$1, \$2, \$3, NULL\)/);
  assert.match(script, /public\.grainline_message_send_ordinary/);
  assert.match(script, /canStart/);
  assert.match(script, /canSend/);
  assert.match(script, /canList/);
  assert.match(script, /canMarkRead/);
});

test("compatibility postflight cleanup is exact and recoverable", () => {
  assert.match(script, /recovery state exists; run the exact --cleanup command first/);
  assert.match(script, /DELETE FROM public\."Message"\s+WHERE id = ANY\(\$1::text\[\]\)/);
  assert.match(script, /DELETE FROM public\."Conversation"\s+WHERE id = ANY\(\$1::text\[\]\)/);
  assert.match(script, /DELETE FROM public\."User"\s+WHERE id = ANY\(\$1::text\[\]\)/);
  assert.match(script, /messages\.rowCount === state\.fixture\.messageIds\.length/);
  assert.match(script, /conversations\.rowCount === state\.fixture\.conversationIds\.length/);
  assert.match(script, /users\.rowCount === state\.fixture\.userIds\.length/);
  assert.match(script, /boundedPartialCounts/);
  assert.match(script, /cleanupFixture\(owner, state, \{ allowPartial: true \}\)/);
  assert.match(script, /unlinkSync\(RECOVERY_PATH\)/);
});

test("compatibility postflight evidence excludes secrets and row identifiers", () => {
  assert.match(script, /retainedIdentifier: false/);
  assert.match(script, /secretsRetained: false/);
  assert.match(script, /environment\.ownerDatabaseUrl/);
  assert.match(script, /environment\.runtimeDatabaseUrl/);
  assert.match(script, /environment\.clerkSecretKey/);
  assert.match(script, /\.\.\.fixture\.conversationIds/);
  assert.match(script, /\.\.\.fixture\.messageIds/);
  assert.match(script, /writePrivateJson\(EVIDENCE_PATH, evidence\)/);
});

test("compatibility postflight suppresses app side effects and clears operational state", () => {
  assert.match(script, /notificationsCreated: 0/);
  assert.match(script, /emailsSent: 0/);
  assert.match(script, /"sourceId" = ANY\(\$1::text\[\]\)/);
  assert.match(script, /revokeCanarySession/);
  assert.match(script, /resetUsedTokens/);
  assert.match(script, /account-state:vercel-production:clerk/);
});

test("compatibility postflight persists Clerk token and session recovery immediately", () => {
  const tokenCreate = script.indexOf("createSignInToken");
  const tokenPersist = script.indexOf("signInTokenId: signInToken.id", tokenCreate);
  const exchange = script.indexOf("created_session_id", tokenPersist);
  const sessionPersist = script.indexOf("sessionId,", exchange);
  const sessionLookup = script.indexOf("getSession(sessionId)", sessionPersist);
  assert.ok(tokenCreate >= 0);
  assert.ok(tokenPersist > tokenCreate);
  assert.ok(exchange > tokenPersist);
  assert.ok(sessionPersist > exchange);
  assert.ok(sessionLookup > sessionPersist);
});

test("compatibility postflight revokes unpersisted active canary sessions", () => {
  const cleanupStart = script.indexOf("async function revokeCanarySession");
  const activeList = script.indexOf("getSessionList", cleanupStart);
  const revoke = script.indexOf("revokeSession(session.id)", activeList);
  const afterList = script.indexOf("getSessionList", revoke);
  const zeroProof = script.indexOf("after.totalCount === 0", afterList);
  assert.ok(cleanupStart >= 0);
  assert.ok(activeList > cleanupStart);
  assert.ok(revoke > activeList);
  assert.ok(afterList > revoke);
  assert.ok(zeroProof > afterList);
});
