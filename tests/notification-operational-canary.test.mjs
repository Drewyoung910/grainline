import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(
  new URL("../scripts/notification-operational-canary.mjs", import.meta.url),
  "utf8",
);
const routeSmoke = readFileSync(
  new URL("../scripts/notification-authenticated-route-smoke.mjs", import.meta.url),
  "utf8",
);

describe("Notification operational canary", () => {
  it("uses one exact permanent Clerk marker without a customer inbox or delete path", () => {
    assert.match(source, /grainline-notification-rls-operational-canary-v1/);
    assert.match(source, /externalId: \[NOTIFICATION_CANARY_EXTERNAL_ID\]/);
    assert.match(source, /emailAddresses\.length !== 0/);
    assert.match(source, /phoneNumbers\.length !== 0/);
    assert.doesNotMatch(source, /deleteUser/);
    assert.doesNotMatch(source, /emailAddress:/);
  });

  it("requires current legal state, the production runtime role, and zero activity", () => {
    assert.match(source, /REVIEWED_TERMS_VERSION = "2026-06-14"/);
    assert.match(source, /ep-plain-river-aaqg8gj4/);
    assert.match(source, /grainline_app_runtime/);
    assert.match(source, /placeholder\.invalid/);
    assert.match(source, /assertNoMarketplaceActivity/);
    assert.match(source, /welcomeEmailSentAt !== null/);
  });

  it("stores hashes rather than raw Clerk or database identifiers", () => {
    assert.match(source, /clerkIdSha256: sha256\(canary\.id\)/);
    assert.match(source, /localUserIdSha256: sha256\(localUser\.id\)/);
    assert.match(source, /rawIdentifiersRetained: false/);
    assert.match(source, /credentialsRetained: false/);
  });

  it("binds the authenticated smoke to the exact Clerk external id", () => {
    assert.match(routeSmoke, /externalId: \[NOTIFICATION_CANARY_EXTERNAL_ID\]/);
    assert.match(routeSmoke, /"clerkId" = \$1/);
    assert.doesNotMatch(routeSmoke, /TEST_USER_EMAIL_PATTERN/);
  });
});
