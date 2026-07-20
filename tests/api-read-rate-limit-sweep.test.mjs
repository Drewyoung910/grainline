import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function assertBefore(text, first, second, label) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  assert.notEqual(firstIndex, -1, `${label} missing ${first}`);
  assert.notEqual(secondIndex, -1, `${label} missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${label} should run ${first} before ${second}`);
}

describe("API read route rate-limit sweep", () => {
  it("defines fail-closed read limiters for signed-in fan-out reads", () => {
    const text = source("src/lib/ratelimit.ts");

    for (const [name, prefix] of [
      ["cartReadRatelimit", "rl:cart-read"],
      ["messageListRatelimit", "rl:message_list"],
      ["notificationReadRatelimit", "rl:notification-read"],
      ["sellerAnalyticsRatelimit", "rl:seller-analytics"],
      ["sellerBroadcastReadRatelimit", "rl:seller-broadcast-read"],
    ]) {
      assert.match(text, new RegExp(`export const ${name} = new Ratelimit`));
      assert.match(text, new RegExp(`prefix: "${prefix}"`));
    }
  });

  it("rate-limits signed-in fan-out GET routes before Prisma work", () => {
    for (const [path, limiter, dbNeedle] of [
      ["src/app/api/cart/route.ts", "safeRateLimit(cartReadRatelimit, userId)", "const cart = await ownerCartForDisplay"],
      ["src/app/api/messages/[id]/list/route.ts", "safeRateLimit(messageListRatelimit, userId)", "prisma.conversation.findFirst"],
      ["src/app/api/notifications/route.ts", "safeRateLimit(notificationReadRatelimit, userId)", "await ownerNotificationBellData"],
      ["src/app/api/seller/analytics/route.ts", "safeRateLimit(sellerAnalyticsRatelimit, userId)", "prisma.sellerProfile.findUnique"],
      ["src/app/api/seller/analytics/recent-sales/route.ts", "safeRateLimit(sellerAnalyticsRatelimit, userId)", "prisma.sellerProfile.findUnique"],
      ["src/app/api/seller/broadcast/route.ts", "safeRateLimit(\n    sellerBroadcastReadRatelimit,\n    userId,\n  )", "prisma.user.findUnique"],
    ]) {
      const file = source(path);
      const text = path === "src/app/api/seller/broadcast/route.ts"
        ? file.slice(file.indexOf("export async function GET"))
        : file;
      assert.match(text, new RegExp(limiter.replace(/[()]/g, "\\$&")));
      assert.doesNotMatch(text, /safeRateLimitOpen\(/);
      assertBefore(text, limiter, dbNeedle, path);
    }
  });

  it("keeps notification polling read-only after rate limiting", () => {
    const route = source("src/app/api/notifications/route.ts");
    const ownerAccess = source("src/lib/notificationOwnerAccess.ts");
    const cron = source("src/app/api/cron/notification-prune/route.ts");
    const bellStart = ownerAccess.indexOf("export async function ownerNotificationBellData");
    const bellBlock = ownerAccess.slice(
      bellStart,
      ownerAccess.indexOf("export async function markOwnerNotificationRead", bellStart),
    );

    assert.doesNotMatch(route, /pruneReadNotificationsHourly/);
    assert.doesNotMatch(route, /deleteMany|DELETE FROM "Notification"/);
    assert.match(route, /ownerNotificationBellData\(me\.id\)/);
    assert.match(ownerAccess, /export async function ownerNotificationBellData/);
    assert.match(ownerAccess, /public\.grainline_notification_bell\(\$\{userId\}::text, 20\)/);
    assert.match(ownerAccess, /unreadCount: safeRpcCount/);
    assert.doesNotMatch(bellBlock, /notification_(?:mark|delete|prune)/);
    assert.doesNotMatch(ownerAccess, /prisma\.notification\./);

    assert.match(cron, /pruneReadNotifications\(\)/);
    assert.match(cron, /pruneUnreadNotifications\(\)/);
    assert.match(cron, /deleteBatch: pruneReadNotificationServiceBatch/);
    assert.match(cron, /deleteBatch: pruneUnreadNotificationServiceBatch/);
    assert.doesNotMatch(cron, /DELETE FROM "Notification"/);
  });

  it("rate-limits optional-public GET routes before public Prisma work", () => {
    for (const [path, dbNeedle] of [
      ["src/app/api/blog/[slug]/comments/route.ts", "prisma.blogPost.findFirst"],
      ["src/app/api/commission/[id]/route.ts", "prisma.commissionRequest.findUnique"],
      ["src/app/api/follow/[sellerId]/route.ts", "prisma.sellerProfile.findFirst"],
      ["src/app/api/search/popular-tags/route.ts", "getPopularListingTags(8)"],
      ["src/app/api/search/popular-blog-tags/route.ts", "getPopularBlogTags(8)"],
    ]) {
      const text = source(path);
      assert.match(text, /searchRatelimit/);
      assert.match(text, /safeRateLimit\(searchRatelimit, getIP\(req\)\)/);
      assert.doesNotMatch(text, /safeRateLimitOpen\(searchRatelimit/);
      assertBefore(text, "safeRateLimit(searchRatelimit, getIP(req))", dbNeedle, path);
    }
  });
});
