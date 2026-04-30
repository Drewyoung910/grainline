import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { emailPreferenceDefaultEnabled } = await import("../src/lib/notificationEmailPreferences.ts");

describe("notification email preferences", () => {
  it("keeps high-volume marketing-style email preferences default-off", () => {
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_SELLER_BROADCAST"), false);
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_NEW_FOLLOWER"), false);
  });

  it("keeps transactional email preferences default-on for transient preference lookup failures", () => {
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_NEW_ORDER"), true);
    assert.equal(emailPreferenceDefaultEnabled("EMAIL_CASE_MESSAGE"), true);
  });
});
