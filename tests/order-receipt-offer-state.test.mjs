import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canOfferBuyerReceiptConfirmation } from "../src/lib/orderReceiptOfferState.ts";

function offer(overrides = {}) {
  return canOfferBuyerReceiptConfirmation({
    fulfillmentMethod: "SHIPPING",
    fulfillmentStatus: "SHIPPED",
    caseStatus: null,
    paymentState: "PAID",
    ...overrides,
  });
}

describe("buyer receipt confirmation offer", () => {
  it("offers receipt for shipped and pickup orders whose server-visible state allows it", () => {
    assert.equal(offer(), true);
    assert.equal(offer({
      fulfillmentMethod: "PICKUP",
      fulfillmentStatus: "READY_FOR_PICKUP",
    }), true);
    assert.equal(offer({ caseStatus: "RESOLVED" }), true);
    assert.equal(offer({ caseStatus: "CLOSED", paymentState: "PARTIALLY_REFUNDED" }), true);
  });

  it("keeps every active Case state and non-final payment state closed", () => {
    for (const caseStatus of ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"]) {
      assert.equal(offer({ caseStatus }), false);
    }
    for (const paymentState of ["UNPAID", "REFUND_PROCESSING", "FULLY_REFUNDED"]) {
      assert.equal(offer({ paymentState }), false);
    }
  });

  it("requires the exact receipt-confirmable fulfillment transition", () => {
    assert.equal(offer({ fulfillmentStatus: "PENDING" }), false);
    assert.equal(offer({ fulfillmentStatus: "DELIVERED" }), false);
    assert.equal(offer({ fulfillmentMethod: "PICKUP" }), false);
    assert.equal(offer({
      fulfillmentMethod: "PICKUP",
      fulfillmentStatus: "SHIPPED",
    }), false);
    assert.equal(offer({
      fulfillmentMethod: "SHIPPING",
      fulfillmentStatus: "READY_FOR_PICKUP",
    }), false);
  });
});
