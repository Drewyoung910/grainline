import assert from "node:assert/strict";
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
});
