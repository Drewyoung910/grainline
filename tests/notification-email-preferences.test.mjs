import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { emailPreferenceDefaultEnabled, isEmailNotificationEnabled } = await import("../src/lib/notificationEmailPreferences.ts");

describe("notification email preferences", () => {
  it("keeps high-volume marketing-style email preferences default-off", () => {
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_SELLER_BROADCAST"), false);
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_NEW_FOLLOWER"), false);
  });

  it("keeps transactional email preferences default-on for transient preference lookup failures", () => {
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_NEW_ORDER"), true);
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_CASE_MESSAGE"), true);
  });

  it("disables default-on emails only for explicit boolean false", () => {
    assert.equal(isEmailNotificationEnabled({ EMAIL_NEW_ORDER: false }, "EMAIL_NEW_ORDER"), false);
    assert.equal(isEmailNotificationEnabled({ EMAIL_NEW_ORDER: true }, "EMAIL_NEW_ORDER"), true);
    assert.equal(isEmailNotificationEnabled({ EMAIL_NEW_ORDER: "false" }, "EMAIL_NEW_ORDER"), true);
    assert.equal(isEmailNotificationEnabled(["EMAIL_NEW_ORDER"], "EMAIL_NEW_ORDER"), true);
  });

  it("enables default-off emails only for explicit boolean true", () => {
    assert.equal(isEmailNotificationEnabled({ EMAIL_SELLER_BROADCAST: true }, "EMAIL_SELLER_BROADCAST"), true);
    assert.equal(isEmailNotificationEnabled({ EMAIL_SELLER_BROADCAST: false }, "EMAIL_SELLER_BROADCAST"), false);
    assert.equal(isEmailNotificationEnabled({ EMAIL_SELLER_BROADCAST: "true" }, "EMAIL_SELLER_BROADCAST"), false);
    assert.equal(isEmailNotificationEnabled({}, "EMAIL_SELLER_BROADCAST"), false);
  });
});
