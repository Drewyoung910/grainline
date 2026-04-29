import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  invalidCheckoutSellerReason,
  latestSuccessfulRefund,
  normalizeShippoRateObjectId,
  parseOptionalNonNegativeInt,
  parsePositiveInt,
} = await import("../src/lib/stripeWebhookState.ts");

function seller(overrides = {}) {
  return {
    id: "seller_1",
    userId: "user_1",
    chargesEnabled: true,
    stripeAccountId: "acct_1",
    user: { id: "user_1", banned: false, deletedAt: null },
    ...overrides,
  };
}

describe("Stripe webhook state helpers", () => {
  it("selects the newest non-failed refund from Stripe charge data", () => {
    assert.deepEqual(
      latestSuccessfulRefund([
        { id: "re_old", status: "succeeded", created: 10 },
        { id: "re_failed", status: "failed", created: 30 },
        { id: "re_new", status: "pending", created: 20 },
      ]),
      { id: "re_new", status: "pending", created: 20 },
    );
    assert.equal(latestSuccessfulRefund([{ id: "re_failed", status: "failed", created: 30 }]), null);
  });

  it("parses positive integer metadata with a fallback", () => {
    assert.equal(parsePositiveInt("3", 7), 3);
    assert.equal(parsePositiveInt(4, 7), 4);
    assert.equal(parsePositiveInt("0", 7), 7);
    assert.equal(parsePositiveInt("1.5", 7), 7);
    assert.equal(parsePositiveInt("abc", 7), 7);
  });

  it("parses optional non-negative integer metadata", () => {
    assert.equal(parseOptionalNonNegativeInt("0"), 0);
    assert.equal(parseOptionalNonNegativeInt(12), 12);
    assert.equal(parseOptionalNonNegativeInt(null), null);
    assert.equal(parseOptionalNonNegativeInt(""), null);
    assert.equal(parseOptionalNonNegativeInt("-1"), null);
    assert.equal(parseOptionalNonNegativeInt("1.25"), null);
  });

  it("does not persist synthetic Shippo pickup/fallback IDs", () => {
    assert.equal(normalizeShippoRateObjectId("pickup"), null);
    assert.equal(normalizeShippoRateObjectId(" fallback "), null);
    assert.equal(normalizeShippoRateObjectId(null), null);
    assert.equal(normalizeShippoRateObjectId("shippo_rate_1"), "shippo_rate_1");
  });

  it("explains why a completed checkout seller is no longer eligible", () => {
    assert.match(invalidCheckoutSellerReason(null), /could not be verified/);
    assert.match(invalidCheckoutSellerReason(seller({ user: { id: "user_1", banned: true, deletedAt: null } })), /suspended/);
    assert.match(
      invalidCheckoutSellerReason(seller({ user: { id: "user_1", banned: false, deletedAt: new Date("2026-04-28") } })),
      /deleted/,
    );
    assert.match(invalidCheckoutSellerReason(seller({ chargesEnabled: false })), /disabled/);
    assert.match(invalidCheckoutSellerReason(seller({ stripeAccountId: null })), /disconnected/);
    assert.equal(invalidCheckoutSellerReason(seller()), null);
  });
});
