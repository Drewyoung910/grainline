import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(
  new URL("../scripts/notification-authenticated-route-smoke.mjs", import.meta.url),
  "utf8",
);

describe("Notification authenticated route smoke scaffold", () => {
  it("uses an existing dedicated identity and always revokes its short-lived session", () => {
    assert.match(source, /newUserCreated: false/);
    assert.match(source, /clerk\.sessions\.createSession/);
    assert.match(source, /clerk\.sessions\.revokeSession/);
    assert.match(source, /finally \{/);
    assert.doesNotMatch(source, /users\.createUser/);
    assert.doesNotMatch(source, /users\.deleteUser/);
    assert.match(source, /externalId: \[NOTIFICATION_CANARY_EXTERNAL_ID\]/);
    assert.match(source, /"clerkId" = \$1/);
  });

  it("adjusts only the disposable child state and restores it with exact Preview cache cleanup", () => {
    assert.match(source, /REVIEWED_TERMS_VERSION = "2026-06-14"/);
    assert.match(source, /stage = "adjust-child-account-state"/);
    assert.match(source, /candidate\.termsAcceptedAt/);
    assert.match(source, /candidate\.termsVersion/);
    assert.match(source, /candidate\.ageAttestedAt/);
    assert.match(source, /childAccountStateRestored/);
    assert.match(source, /vercel-preview-\$\{sha256\(PROVIDER_PROOF_BRANCH\)\.slice\(0, 16\)\}/);
    assert.match(source, /await redis\.del\(key\)/);
    assert.match(source, /previewCacheKeyDeleted/);
  });

  it("proves authentication, owner projection, mutation scope, and cross-origin denial", () => {
    assert.match(source, /unauthenticated\.status !== 401/);
    assert.match(source, /bellBefore\.body\.unreadCount !== 2/);
    assert.match(source, /bellBeforeIds\.includes\(fixture\.foreignId\)/);
    assert.match(source, /crossOrigin\.status !== 403/);
    assert.match(source, /byId\.get\(fixture\.foreignId\) !== false/);
    assert.match(source, /readAll\.body\.markedCount !== 1/);
  });

  it("retains sanitized mode-0600 evidence and cleans database fixtures", () => {
    assert.match(source, /openSync\(filePath, "wx", 0o600\)/);
    assert.match(source, /DELETE FROM public\."Notification"/);
    assert.match(source, /secretsRetained: false/);
    assert.match(source, /retainedIdentifier: false/);
  });
});
