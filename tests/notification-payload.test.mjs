import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  NOTIFICATION_BODY_MAX_LENGTH,
  NOTIFICATION_LINK_MAX_LENGTH,
  NOTIFICATION_TITLE_MAX_LENGTH,
  limitNotificationText,
} = await import("../src/lib/notificationPayload.ts");

describe("notification payload bounds", () => {
  it("keeps notification fields within database limits", () => {
    assert.equal(limitNotificationText("x".repeat(250), NOTIFICATION_TITLE_MAX_LENGTH).length, 200);
    assert.equal(limitNotificationText("x".repeat(1500), NOTIFICATION_BODY_MAX_LENGTH).length, 1000);
    assert.equal(limitNotificationText("x".repeat(3000), NOTIFICATION_LINK_MAX_LENGTH).length, 2048);
  });

  it("does not split surrogate-pair characters while truncating", () => {
    assert.equal(limitNotificationText("aa🙂bb", 3), "aa🙂");
  });

  it("strips bidi controls before persisting notification text", () => {
    assert.equal(limitNotificationText("John\u202Egnp.exe", NOTIFICATION_TITLE_MAX_LENGTH), "Johngnp.exe");
  });
});
