import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  blockedCheckoutDisputeState,
  chargeDisputeLedgerState,
  chargeRefundLedgerState,
  checkoutPriceDriftState,
  disputeCaseAction,
  invalidCheckoutBuyerReason,
  invalidCheckoutSellerReason,
  isLikelyThinStripeEventObject,
  isStaleStripeEvent,
  latestSuccessfulRefund,
  normalizeShippoRateObjectId,
  payoutFailureState,
  parseOptionalNonNegativeInt,
  parsePositiveInt,
  retrievedStripeEventMatchesSignedEnvelope,
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
  it("detects Stripe thin event data objects conservatively", () => {
    assert.equal(isLikelyThinStripeEventObject({ id: "cs_123", object: "checkout.session" }), true);
    assert.equal(isLikelyThinStripeEventObject({ id: "cs_123", object: "checkout.session", livemode: true }), true);
    assert.equal(isLikelyThinStripeEventObject({ id: "cs_123", object: "checkout.session", amount_total: 1000 }), false);
    assert.equal(
      isLikelyThinStripeEventObject({ id: "cs_123", object: "checkout.session", amount_total: 1000, metadata: {} }),
      false,
    );
    assert.equal(isLikelyThinStripeEventObject({ object: "checkout.session" }), false);
  });

  it("requires retrieved thin events to match the signed envelope", () => {
    const signed = { id: "evt_1", type: "checkout.session.completed", created: 100, api_version: "2026-04-30" };
    assert.equal(retrievedStripeEventMatchesSignedEnvelope(signed, { ...signed, data: { object: {} } }), true);
    assert.equal(
      retrievedStripeEventMatchesSignedEnvelope(signed, { ...signed, type: "charge.refunded" }),
      false,
    );
    assert.equal(
      retrievedStripeEventMatchesSignedEnvelope(signed, { ...signed, api_version: "2025-01-01" }),
      false,
    );
  });

  it("detects stale Stripe webhook events from the signed event timestamp", () => {
    const now = 1_000_000;
    assert.equal(isStaleStripeEvent(now - 24 * 60 * 60, now), false);
    assert.equal(isStaleStripeEvent(now - 24 * 60 * 60 - 1, now), true);
    assert.equal(isStaleStripeEvent(undefined, now), true);
  });

  it("selects the newest succeeded refund from Stripe charge data", () => {
    assert.deepEqual(
      latestSuccessfulRefund([
        { id: "re_old", status: "succeeded", created: 10 },
        { id: "re_failed", status: "failed", created: 30 },
        { id: "re_pending", status: "pending", created: 40 },
        { id: "re_canceled", status: "canceled", created: 50 },
        { id: "re_new", status: "succeeded", created: 20 },
      ]),
      { id: "re_new", status: "succeeded", created: 20 },
    );
    assert.equal(latestSuccessfulRefund([{ id: "re_failed", status: "failed", created: 30 }]), null);
    assert.equal(latestSuccessfulRefund([{ id: "re_pending", status: "pending", created: 30 }]), null);
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

  it("detects checkout price drift without changing Stripe-authoritative order data", () => {
    assert.deepEqual(
      checkoutPriceDriftState({
        stripeUnitAmountCents: 1_200,
        expectedUnitAmountCents: 1_000,
        checkoutPriceVersion: 3,
        currentPriceVersion: 4,
      }),
      {
        reasons: ["stripe_unit_amount_mismatch", "price_version_changed"],
        stripeUnitAmountCents: 1_200,
        expectedUnitAmountCents: 1_000,
        checkoutPriceVersion: 3,
        currentPriceVersion: 4,
      },
    );
    assert.equal(
      checkoutPriceDriftState({
        stripeUnitAmountCents: 1_000,
        expectedUnitAmountCents: 1_000,
        checkoutPriceVersion: 4,
        currentPriceVersion: 4,
      }),
      null,
    );
  });

  it("ignores incomplete checkout price drift inputs", () => {
    assert.equal(
      checkoutPriceDriftState({
        stripeUnitAmountCents: null,
        expectedUnitAmountCents: 1_000,
        checkoutPriceVersion: null,
        currentPriceVersion: 4,
      }),
      null,
    );
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

  it("explains why a completed checkout buyer is no longer eligible", () => {
    assert.match(invalidCheckoutBuyerReason(null), /could not be verified/);
    assert.match(invalidCheckoutBuyerReason({ id: "buyer_1", banned: true, deletedAt: null }), /suspended/);
    assert.match(
      invalidCheckoutBuyerReason({ id: "buyer_1", banned: false, deletedAt: new Date("2026-04-30") }),
      /deleted/,
    );
    assert.equal(invalidCheckoutBuyerReason({ id: "buyer_1", banned: false, deletedAt: null }), null);
  });

  it("blocks automatic invalid-checkout refunds while a Stripe dispute is open", () => {
    const state = blockedCheckoutDisputeState({
      latestDispute: { status: "needs_response", stripeObjectId: "dp_123" },
      reviewPrefix: "Seller account was suspended. Order was held for staff review.",
    });

    assert.deepEqual(state, {
      reviewNeeded: true,
      reviewNote: "Seller account was suspended. Order was held for staff review. Automatic refund was skipped because Stripe dispute dp_123 is still open; staff must reconcile this payment manually.",
      disputeId: "dp_123",
      disputeStatus: "needs_response",
    });
    assert.equal(
      blockedCheckoutDisputeState({
        latestDispute: { status: "won", stripeObjectId: "dp_closed" },
        reviewPrefix: "Seller account was suspended. Order was held for staff review.",
      }),
      null,
    );
    assert.equal(
      blockedCheckoutDisputeState({
        latestDispute: null,
        reviewPrefix: "Seller account was suspended. Order was held for staff review.",
      }),
      null,
    );
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
      fallbackRefundId: "external:evt_refunded",
      order: { currency: "usd", sellerRefundId: null, sellerRefundAmountCents: null },
    });

    assert.equal(state.ledger.stripeObjectId, "external:evt_refunded");
    assert.equal(state.ledger.amountCents, 900);
    assert.equal(state.ledger.status, "refunded");
    assert.equal(state.orderUpdate?.sellerRefundId, "external:evt_refunded");
  });

  it("builds dispute ledger rows and order review updates", () => {
    const state = chargeDisputeLedgerState({
      chargeId: "ch_1",
      eventType: "charge.dispute.created",
      orderCurrency: "usd",
      dispute: { id: "dp_1", amount: 3_200, currency: null, reason: "fraudulent", status: null },
    });

    assert.deepEqual(state.ledger, {
      stripeObjectId: "dp_1",
      amountCents: 3_200,
      currency: "usd",
      status: "created",
      reason: "fraudulent",
      description: "Stripe dispute charge.dispute.created: fraudulent",
      metadata: {
        chargeId: "ch_1",
        disputeId: "dp_1",
        stripeEventType: "charge.dispute.created",
      },
    });
    assert.deepEqual(state.orderUpdate, {
      reviewNeeded: true,
      reviewNote: "Stripe dispute charge.dispute.created: fraudulent",
    });
  });

  it("clears stale refund-lock timestamps when a Stripe dispute closes", () => {
    const state = chargeDisputeLedgerState({
      chargeId: "ch_1",
      eventType: "charge.dispute.closed",
      orderCurrency: "usd",
      dispute: { id: "dp_1", amount: 3_200, currency: "usd", reason: "fraudulent", status: "lost" },
    });

    assert.deepEqual(state.orderUpdate, {
      reviewNeeded: true,
      reviewNote: "Stripe dispute charge.dispute.closed: fraudulent",
      sellerRefundLockedAt: null,
    });
  });

  it("updates only active existing cases for new Stripe disputes", () => {
    assert.deepEqual(
      disputeCaseAction({
        eventType: "charge.dispute.created",
        existingCase: { id: "case_1", status: "OPEN" },
        dispute: { id: "dp_1" },
      }),
      { action: "update", caseId: "case_1", status: "UNDER_REVIEW" },
    );
    assert.deepEqual(
      disputeCaseAction({
        eventType: "charge.dispute.created",
        existingCase: { id: "case_1", status: "RESOLVED" },
        dispute: { id: "dp_1" },
      }),
      { action: "none" },
    );
    assert.deepEqual(
      disputeCaseAction({
        eventType: "charge.dispute.closed",
        existingCase: null,
        dispute: { id: "dp_1" },
      }),
      { action: "none" },
    );
  });

  it("creates a case action for new Stripe disputes without an existing case", () => {
    const now = new Date("2026-04-29T12:00:00.000Z");
    const action = disputeCaseAction({
      eventType: "charge.dispute.created",
      existingCase: null,
      dispute: { id: "dp_1", reason: "product_not_received" },
      now,
    });

    assert.equal(action.action, "create");
    assert.equal(action.status, "UNDER_REVIEW");
    assert.equal(action.description, "Stripe payment dispute dp_1: product_not_received");
    assert.equal(action.sellerRespondBy.toISOString(), "2026-05-01T12:00:00.000Z");
  });

  it("builds durable payout-failure ledger state and seller notification copy", () => {
    const state = payoutFailureState(
      {
        id: "po_1",
        status: null,
        amount: 10_500,
        currency: "usd",
        failure_code: "account_closed",
        failure_message: "The destination account is closed.",
      },
      "evt_1",
    );

    assert.deepEqual(state.event, {
      stripePayoutId: "po_1",
      status: "failed",
      amountCents: 10_500,
      currency: "usd",
      failureCode: "account_closed",
      failureMessage: "The destination account is closed.",
      stripeEventId: "evt_1",
    });
    assert.deepEqual(state.notification, {
      type: "PAYOUT_FAILED",
      title: "Payout failed",
      body: "Stripe could not complete a payout: The destination account is closed.",
      link: "/dashboard/seller",
    });
  });

  it("uses safe payout-failure fallbacks when Stripe omits optional fields", () => {
    const state = payoutFailureState({ id: "po_1" }, "evt_1");

    assert.equal(state.event.status, "failed");
    assert.equal(state.event.amountCents, null);
    assert.equal(state.event.currency, "usd");
    assert.equal(state.event.failureCode, null);
    assert.equal(state.notification.body, "Stripe could not complete a payout. Review your Stripe account so the payout can be retried.");
  });
});
