import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  emailPreferenceKeyForDelivery,
  isAlwaysOnEmailPreferenceKey,
  isOptionalEmailPreferenceKey,
} = await import("../src/lib/emailPreferencePolicy.ts");
const { userEmailDeliveryRecipient } = await import(
  "../src/lib/userEmailDeliveryAccess.ts"
);

describe("transactional email policy", () => {
  it("keeps order, case, and refund mail always on", () => {
    for (const key of [
      "EMAIL_NEW_ORDER",
      "EMAIL_CASE_OPENED",
      "EMAIL_CASE_MESSAGE",
      "EMAIL_CASE_RESOLVED",
      "EMAIL_REFUND_ISSUED",
    ]) {
      assert.equal(isAlwaysOnEmailPreferenceKey(key), true);
      assert.equal(isOptionalEmailPreferenceKey(key), false);
      assert.equal(emailPreferenceKeyForDelivery(key), null);
    }
  });

  it("keeps marketing and community email optional", () => {
    for (const key of [
      "EMAIL_NEW_MESSAGE",
      "EMAIL_CUSTOM_ORDER",
      "EMAIL_BACK_IN_STOCK",
      "EMAIL_NEW_REVIEW",
      "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
      "EMAIL_SELLER_BROADCAST",
    ]) {
      assert.equal(isAlwaysOnEmailPreferenceKey(key), false);
      assert.equal(isOptionalEmailPreferenceKey(key), true);
      assert.equal(emailPreferenceKeyForDelivery(key), key);
    }
  });

  it("bypasses stored false preferences for transactional recipients", async () => {
    const calls = [];
    const client = {
      async $queryRaw(_strings, ...values) {
        calls.push(values);
        return [{ userId: "user_1", name: "Buyer", email: "buyer@example.com" }];
      },
    };

    const recipient = await userEmailDeliveryRecipient(client, {
      userId: "user_1",
      preferenceKey: "EMAIL_CASE_OPENED",
    });

    assert.equal(recipient?.email, "buyer@example.com");
    assert.deepEqual(calls, [["user_1", null]]);
  });

  it("preserves preference checks for optional recipients", async () => {
    const calls = [];
    const client = {
      async $queryRaw(_strings, ...values) {
        calls.push(values);
        return [{ userId: "user_1", name: "Buyer", email: "buyer@example.com" }];
      },
    };

    await userEmailDeliveryRecipient(client, {
      userId: "user_1",
      preferenceKey: "EMAIL_NEW_MESSAGE",
    });

    assert.deepEqual(calls, [["user_1", "EMAIL_NEW_MESSAGE"]]);
  });
});
