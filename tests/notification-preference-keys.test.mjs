import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  VALID_EMAIL_PREFERENCE_KEYS,
  VALID_PREFERENCE_KEYS,
  isValidPreferenceKey,
  isValidEmailPreferenceKey,
  normalizeNotificationPreferences,
} = await import("../src/lib/notificationPreferenceKeys.ts");

describe("notification preference keys", () => {
  it("validates email-only preference keys for durable email jobs", () => {
    assert.equal(isValidEmailPreferenceKey("EMAIL_NEW_ORDER"), true);
    assert.equal(isValidEmailPreferenceKey("NEW_ORDER"), false);
    assert.equal(isValidEmailPreferenceKey("EMAIL_NEW_ORDR"), false);
    assert.equal(isValidEmailPreferenceKey(null), false);
  });

  it("rejects unsupported legacy email preference keys", () => {
    for (const key of [
      "EMAIL_ORDER_SHIPPED",
      "EMAIL_ORDER_DELIVERED",
      "EMAIL_CUSTOM_ORDER_LINK",
      "EMAIL_LOW_STOCK",
      "EMAIL_NEW_FAVORITE",
      "EMAIL_NEW_BLOG_COMMENT",
      "EMAIL_BLOG_COMMENT_REPLY",
      "EMAIL_NEW_FOLLOWER",
      "EMAIL_FOLLOWED_MAKER_NEW_BLOG",
      "EMAIL_COMMISSION_INTEREST",
      "EMAIL_LISTING_APPROVED",
      "EMAIL_LISTING_REJECTED",
      "EMAIL_ACCOUNT_WARNING",
      "EMAIL_LISTING_FLAGGED_BY_USER",
      "EMAIL_PAYMENT_DISPUTE",
      "EMAIL_PAYOUT_FAILED",
    ]) {
      assert.equal(isValidEmailPreferenceKey(key), false, `${key} should not be accepted without a sender`);
      assert.equal(isValidPreferenceKey(key), false, `${key} should not be accepted by the preference API`);
    }
  });

  it("keeps the aggregate preference list aligned with email keys", () => {
    for (const key of VALID_EMAIL_PREFERENCE_KEYS) {
      assert.equal(VALID_PREFERENCE_KEYS.includes(key), true);
    }
  });

  it("validates aggregate preference keys", () => {
    assert.equal(isValidPreferenceKey("NEW_ORDER"), true);
    assert.equal(isValidPreferenceKey("EMAIL_NEW_ORDER"), true);
    assert.equal(isValidPreferenceKey("EMAIL_NEW_ORDR"), false);
    assert.equal(isValidPreferenceKey(undefined), false);
  });

  it("normalizes preferences to known boolean keys only", () => {
    assert.deepEqual(
      normalizeNotificationPreferences({
        NEW_ORDER: false,
        EMAIL_NEW_ORDER: true,
        EMAIL_NEW_FOLLOWER: true,
        EMAIL_CASE_MESSAGE: "false",
        UNKNOWN_PREF: false,
      }),
      {
        NEW_ORDER: false,
        EMAIL_NEW_ORDER: true,
      },
    );
    assert.deepEqual(normalizeNotificationPreferences(null), {});
    assert.deepEqual(normalizeNotificationPreferences(["NEW_ORDER"]), {});
  });
});
