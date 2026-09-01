import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  isFinalRefundStatus,
  orderPaymentPresentationLabel,
  orderPaymentPresentationState,
  suppressActiveFulfillmentForPaymentState,
} = await import("../src/lib/orderPaymentPresentation.ts");

describe("order payment presentation", () => {
  it("keeps unpaid and paid orders distinct", () => {
    assert.equal(orderPaymentPresentationState({
      paid: false,
      orderTotalCents: 5_000,
      refundAmountCents: null,
      refundRecorded: false,
    }), "UNPAID");
    assert.equal(orderPaymentPresentationState({
      paid: true,
      orderTotalCents: 5_000,
      refundAmountCents: null,
      refundRecorded: false,
    }), "PAID");
  });

  it("does not present a provider-pending refund as final", () => {
    assert.equal(orderPaymentPresentationState({
      paid: true,
      orderTotalCents: 5_000,
      refundAmountCents: 5_000,
      refundRecorded: false,
      providerRefundStatus: "pending",
    }), "REFUND_PROCESSING");
  });

  it("distinguishes final partial and full refunds", () => {
    assert.equal(orderPaymentPresentationState({
      paid: true,
      orderTotalCents: 5_000,
      refundAmountCents: 1_000,
      refundRecorded: true,
    }), "PARTIALLY_REFUNDED");
    assert.equal(orderPaymentPresentationState({
      paid: true,
      orderTotalCents: 5_000,
      refundAmountCents: 5_000,
      refundRecorded: false,
      providerRefundStatus: "SUCCEEDED",
    }), "FULLY_REFUNDED");
    assert.equal(isFinalRefundStatus("succeeded"), true);
    assert.equal(orderPaymentPresentationLabel("FULLY_REFUNDED"), "Fully refunded");
  });

  it("suppresses active work but preserves terminal fulfillment history", () => {
    assert.equal(suppressActiveFulfillmentForPaymentState("FULLY_REFUNDED", "PENDING"), true);
    assert.equal(suppressActiveFulfillmentForPaymentState("FULLY_REFUNDED", "SHIPPED"), true);
    assert.equal(suppressActiveFulfillmentForPaymentState("FULLY_REFUNDED", "DELIVERED"), false);
    assert.equal(suppressActiveFulfillmentForPaymentState("FULLY_REFUNDED", "PICKED_UP"), false);
    assert.equal(suppressActiveFulfillmentForPaymentState("PARTIALLY_REFUNDED", "PENDING"), false);
  });
});
