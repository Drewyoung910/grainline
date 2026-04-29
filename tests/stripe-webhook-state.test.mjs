import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  chargeRefundLedgerState,
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

  it("classifies Stripe-confirmed local refunds without changing the order row", () => {
    const state = chargeRefundLedgerState({
      chargeId: "ch_1",
      chargeCurrency: "usd",
      amountRefundedCents: 4_000,
      latestRefund: { id: "re_local", amount: 4_000, status: "succeeded", created: 10 },
      order: { currency: "usd", sellerRefundId: "re_local", sellerRefundAmountCents: 4_000 },
    });

    assert.equal(state.latestRefundId, "re_local");
    assert.equal(state.ledger.reason, "local_refund_confirmed");
    assert.equal(state.ledger.description, "Stripe confirmed a Grainline-tracked refund.");
    assert.equal(state.ledger.metadata.preservedLocalRefundId, null);
    assert.equal(state.orderUpdate, null);
  });

  it("records external Stripe refunds and marks the order for review", () => {
    const state = chargeRefundLedgerState({
      chargeId: "ch_1",
      chargeCurrency: null,
      amountRefundedCents: 2_500,
      latestRefund: { id: "re_external", amount: 2_500, status: "succeeded", created: 10, reason: "requested_by_customer" },
      order: { currency: "usd", sellerRefundId: null, sellerRefundAmountCents: null },
    });

    assert.equal(state.ledger.stripeObjectId, "re_external");
    assert.equal(state.ledger.amountCents, 2_500);
    assert.equal(state.ledger.currency, "usd");
    assert.equal(state.ledger.reason, "requested_by_customer");
    assert.deepEqual(state.orderUpdate, {
      sellerRefundId: "re_external",
      sellerRefundAmountCents: 2_500,
      sellerRefundLockedAt: null,
      reviewNeeded: true,
      reviewNote: "Stripe refund was created outside Grainline.",
    });
  });

  it("preserves a local refund id when Stripe reports an additional external refund", () => {
    const state = chargeRefundLedgerState({
      chargeId: "ch_1",
      chargeCurrency: "usd",
      amountRefundedCents: 6_000,
      latestRefund: { id: "re_new_external", amount: 1_500, status: "succeeded", created: 20 },
      order: { currency: "usd", sellerRefundId: "re_local", sellerRefundAmountCents: 4_000 },
    });

    assert.equal(state.ledger.reason, "additional_external_refund");
    assert.equal(state.ledger.metadata.preservedLocalRefundId, "re_local");
    assert.deepEqual(state.orderUpdate, {
      sellerRefundAmountCents: 6_000,
      sellerRefundLockedAt: null,
      reviewNeeded: true,
      reviewNote: "Additional Stripe refund was detected outside Grainline; local refund audit ID was preserved.",
    });
  });

  it("falls back to charge-level refund data when Stripe omits refund details", () => {
    const state = chargeRefundLedgerState({
      chargeId: "ch_1",
      amountRefundedCents: 900,
      latestRefund: null,
      order: { currency: "usd", sellerRefundId: null, sellerRefundAmountCents: null },
    });

    assert.equal(state.ledger.stripeObjectId, "external:ch_1");
    assert.equal(state.ledger.amountCents, 900);
    assert.equal(state.ledger.status, "refunded");
    assert.equal(state.orderUpdate?.sellerRefundId, "external:ch_1");
  });
});
