import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  VALID_EMAIL_PREFERENCE_KEYS,
  VALID_PREFERENCE_KEYS,
  isValidEmailPreferenceKey,
} = await import("../src/lib/notificationPreferenceKeys.ts");

describe("notification preference keys", () => {
  it("validates email-only preference keys for durable email jobs", () => {
    assert.equal(isValidEmailPreferenceKey("EMAIL_NEW_ORDER"), true);
    assert.equal(isValidEmailPreferenceKey("NEW_ORDER"), false);
    assert.equal(isValidEmailPreferenceKey("EMAIL_NEW_ORDR"), false);
    assert.equal(isValidEmailPreferenceKey(null), false);
  });

  it("keeps the aggregate preference list aligned with email keys", () => {
    for (const key of VALID_EMAIL_PREFERENCE_KEYS) {
      assert.equal(VALID_PREFERENCE_KEYS.includes(key), true);
    }
  });
});
