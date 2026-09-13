import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("mutating API route rate-limit sweep", () => {
  it("rate-limits notification preference writes by the local user", () => {
    const route = source("src/app/api/account/notifications/preferences/route.ts");
    const limiters = source("src/lib/ratelimit.ts");

    assert.match(limiters, /notificationPreferenceRatelimit/);
    assert.match(limiters, /prefix: "rl:notification-preference"/);
    assert.match(route, /notificationPreferenceRatelimit/);
    assert.match(route, /safeRateLimit\(notificationPreferenceRatelimit, me\.id\)/);
    assert.match(route, /rateLimitResponse\(reset, "Too many notification preference changes\."/);
  });

  it("rate-limits notification mark-read writes fail-closed", () => {
    for (const path of [
      "src/app/api/notifications/read-all/route.ts",
      "src/app/api/notifications/[id]/read/route.ts",
    ]) {
      const route = source(path);

      assert.match(route, /markReadRatelimit/, `${path} must import/use markReadRatelimit`);
      assert.match(route, /safeRateLimit\(markReadRatelimit, userId\)/, `${path} must fail closed`);
      assert.doesNotMatch(route, /safeRateLimitOpen\(markReadRatelimit/, `${path} must not fail open`);
      assert.match(route, /rateLimitResponse\(reset, "Too many notification updates\."/);
    }

    const limiters = source("src/lib/ratelimit.ts");
    assert.match(limiters, /Notification mark-read — low risk, but still a write path; fail closed\./);
  });

  it("rate-limits account deletion before blocker checks and external deletion calls", () => {
    const route = source("src/app/api/account/delete/route.ts");
    const limiters = source("src/lib/ratelimit.ts");

    assert.match(limiters, /accountDeletionRatelimit/);
    assert.match(limiters, /prefix: "rl:account-delete"/);
    assert.match(route, /accountDeletionRatelimit/);
    assert.match(route, /safeRateLimit\(accountDeletionRatelimit, me\.id\)/);
    assert.match(route, /rateLimitResponse\(reset, "Too many account deletion attempts\."/);
    assert.ok(
      route.indexOf("safeRateLimit(accountDeletionRatelimit, me.id)") <
        route.indexOf("getAccountDeletionBlockers(me.id)"),
      "account deletion limiter should run before blocker queries and Clerk deletion",
    );
    assert.ok(
      route.indexOf("safeRateLimit(accountDeletionRatelimit, me.id)") < route.indexOf("users.deleteUser(clerkId)"),
      "account deletion limiter should run before Clerk deletion",
    );
  });

  it("rate-limits favorite removal with the same save limiter as favorite creation", () => {
    const createRoute = source("src/app/api/favorites/route.ts");
    const deleteRoute = source("src/app/api/favorites/[listingId]/route.ts");

    assert.match(createRoute, /safeRateLimit\(saveRatelimit, userId\)/);
    assert.match(deleteRoute, /safeRateLimit\(saveRatelimit, userId\)/);
    assert.match(deleteRoute, /rateLimitResponse\(reset, "Too many save actions\."/);
  });

  it("rate-limits commission close and fulfilled status transitions", () => {
    const route = source("src/app/api/commission/[id]/route.ts");
    const limiters = source("src/lib/ratelimit.ts");

    assert.match(limiters, /commissionStatusRatelimit/);
    assert.match(limiters, /prefix: "rl:commission_status"/);
    assert.match(route, /commissionStatusRatelimit/);
    assert.match(route, /safeRateLimit\(commissionStatusRatelimit, userId\)/);
    assert.match(route, /openCommissionMutationWhere\(id, new Date\(\), \{ buyerId: me\.id \}\)/);
  });

  it("rate-limits destructive admin moderation routes by acting admin", () => {
    for (const path of [
      "src/app/api/admin/reviews/[id]/route.ts",
      "src/app/api/admin/users/[id]/ban/route.ts",
    ]) {
      const route = source(path);
      assert.match(route, /adminActionRatelimit/, `${path} must import/use adminActionRatelimit`);
      assert.match(route, /safeRateLimit\(adminActionRatelimit, admin\.id\)/, `${path} must key by admin.id`);
      assert.match(route, /rateLimitResponse\(reset, ['"]Too many admin actions\./, `${path} must return standard 429s`);
    }
  });
});
