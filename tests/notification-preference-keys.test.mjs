import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { emailServiceLeastPrivilegeMigrationPath } from "./helpers/email-service-least-privilege-migration-path.mjs";

const {
  VALID_EMAIL_PREFERENCE_KEYS,
  VALID_PREFERENCE_KEYS,
  isValidPreferenceKey,
  isValidEmailPreferenceKey,
  normalizeNotificationPreferences,
} = await import("../src/lib/notificationPreferenceKeys.ts");
const {
  ALWAYS_ON_EMAIL_PREFERENCE_KEYS,
  isOptionalEmailPreferenceKey,
} = await import("../src/lib/emailPreferencePolicy.ts");

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

  it("keeps optional unsubscribe preferences aligned with the database boundary", () => {
    const migration = fs.readFileSync(
      emailServiceLeastPrivilegeMigrationPath(),
      "utf8",
    );
    const functionBody = migration.match(
      /AS \$grainline_email_unsubscribe_apply\$([\s\S]*?)\$grainline_email_unsubscribe_apply\$;/u,
    )?.[1];
    assert.ok(functionBody, "unsubscribe authority must exist in the reviewed migration");

    const allowedKeys = new Set(
      [...functionBody.matchAll(/'(EMAIL_[A-Z_]+)'/gu)].map((match) => match[1]),
    );
    const optionalKeys = new Set(
      VALID_EMAIL_PREFERENCE_KEYS.filter(isOptionalEmailPreferenceKey),
    );
    assert.deepEqual(allowedKeys, optionalKeys);
    assert.equal(allowedKeys.size, VALID_EMAIL_PREFERENCE_KEYS.length - ALWAYS_ON_EMAIL_PREFERENCE_KEYS.length);
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
