import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const route = readFileSync(
  new URL("../src/app/api/internal/saved-search-route-fixture/route.ts", import.meta.url),
  "utf8",
);

describe("SavedSearch staging-only route fixture runner", () => {
  it("is Preview-only, commit-pinned, token-gated, and bounded", () => {
    assert.match(route, /process\.env\.VERCEL_ENV !== "preview"/);
    assert.match(route, /SAVED_SEARCH_ROUTE_FIXTURE_ALLOWED_COMMIT_SHA/);
    assert.match(route, /VERCEL_GIT_COMMIT_SHA/);
    assert.match(route, /SAVED_SEARCH_ROUTE_FIXTURE_TRIGGER_SECRET/);
    assert.match(route, /timingSafeEqual/);
    assert.match(route, /safeRateLimit\([\s\S]*savedSearchRatelimit/);
    assert.match(route, /BODY_MAX_BYTES = 1024/);
    assert.match(route, /z\.object\(\{[\s\S]*token:[\s\S]*\}\)\.strict\(\)/);
    assert.doesNotMatch(route, /userId:\s*z\.|searchId:\s*z\./);
  });

  it("exercises the reviewed shared helper across every required surface", () => {
    for (const label of [
      "API exact-id read",
      "account overview exact-id read",
      "dashboard exact-id read",
      "account export exact-id read",
    ]) {
      assert.match(route, new RegExp(label));
    }
    assert.match(route, /listOwnerSavedSearches\(userA, prisma/);
    assert.match(route, /deleteOwnerSavedSearch\(userB, searchA\.id, prisma\)/);
    assert.match(route, /deleteOwnerSavedSearch\(userB, searchB\.id, prisma\)/);
    assert.match(route, /deleteAllOwnerSavedSearches\(userA, tx\)/);
    assert.match(route, /timeout: 30_000,[\s\S]*maxWait: 10_000/);
    assert.match(route, /current_setting\('app\.user_id', true\)/);
  });

  it("retains only bounded status evidence and unconditionally cleans fixtures", () => {
    assert.match(route, /finally \{/);
    assert.match(route, /prisma\.user\.deleteMany/);
    assert.match(route, /cleanupVerified/);
    assert.match(route, /acceptanceEligible: true/);
    const successResponse = route.slice(route.lastIndexOf("return privateJson({"));
    assert.doesNotMatch(successResponse, /(?:userA|userB|searchA|searchB)/);
  });
});
