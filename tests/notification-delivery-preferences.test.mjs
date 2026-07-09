import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { isInAppNotificationEnabled } = await import("../src/lib/notificationDeliveryPreferences.ts");

describe("notification delivery preferences", () => {
  it("treats missing in-app preferences as enabled", () => {
    assert.equal(isInAppNotificationEnabled(null, "SELLER_BROADCAST"), true);
    assert.equal(isInAppNotificationEnabled({}, "SELLER_BROADCAST"), true);
  });

  it("honors explicit in-app opt-outs", () => {
    assert.equal(isInAppNotificationEnabled({ SELLER_BROADCAST: false }, "SELLER_BROADCAST"), false);
    assert.equal(isInAppNotificationEnabled({ SELLER_BROADCAST: true }, "SELLER_BROADCAST"), true);
  });

  it("ignores malformed in-app preference values", () => {
    assert.equal(isInAppNotificationEnabled({ SELLER_BROADCAST: "false" }, "SELLER_BROADCAST"), true);
    assert.equal(isInAppNotificationEnabled({ SELLER_BROADCAST: 0 }, "SELLER_BROADCAST"), true);
    assert.equal(isInAppNotificationEnabled(["SELLER_BROADCAST"], "SELLER_BROADCAST"), true);
  });

  it("reports partial mark-read updates when explicit notification ids are capped", () => {
    const route = readFileSync("src/app/api/notifications/read-all/route.ts", "utf8");
    const ownerAccess = readFileSync("src/lib/notificationOwnerAccess.ts", "utf8");

    assert.match(route, /const rawIds = Array\.isArray\(bodyObject\.ids\)/);
    assert.match(route, /const ids = Array\.from\(new Set\(rawIds\)\)\.slice\(0, 100\)/);
    assert.match(route, /const updated = await markOwnerNotificationsRead\(me\.id, ids\)/);
    assert.match(ownerAccess, /export async function markOwnerNotificationsRead/);
    assert.match(ownerAccess, /prisma\.notification\.updateMany/);
    assert.match(ownerAccess, /userId,\s+read: false/s);
    assert.match(route, /markedCount: updated\.count/);
    assert.match(route, /cappedIds: rawIds\.length > ids\.length/);
  });
});
