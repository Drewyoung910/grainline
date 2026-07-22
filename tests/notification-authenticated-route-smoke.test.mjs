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
