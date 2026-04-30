import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  isOpenStripeDisputeStatus,
  isBlockingRefundLedgerEvent,
  latestRefundLedgerEvent,
  orderHasPurchasedLabel,
  orderHasRefundLedger,
  orderRefundTotalCents,
  partialRefundExceedsOrderTotal,
  partialRefundInputError,
  refundAmountForResolution,
  refundLockAcquisitionConflictResponse,
  refundStockRestoreQuantities,
  sellerRefundConflictResponse,
  shouldReactivateRefundedListing,
} = await import("../src/lib/refundRouteState.ts");

const order = {
  itemsSubtotalCents: 10_000,
  shippingAmountCents: 500,
  giftWrappingPriceCents: 300,
  taxAmountCents: 825,
};

describe("refund route state", () => {
  it("calculates full refund amounts from the order total", () => {
    assert.equal(orderRefundTotalCents(order), 11_625);
    assert.equal(refundAmountForResolution("FULL", order, null), 11_625);
    assert.equal(refundAmountForResolution("REFUND_FULL", order, 100), 11_625);
  });

  it("uses the requested amount for partial refunds", () => {
    assert.equal(refundAmountForResolution("PARTIAL", order, 1_200), 1_200);
    assert.equal(refundAmountForResolution("REFUND_PARTIAL", order, 1_200), 1_200);
    assert.equal(refundAmountForResolution("PARTIAL", order, null), null);
  });

  it("requires positive partial refund amounts before a DB lock is claimed", () => {
    assert.match(partialRefundInputError("PARTIAL", null), /required/);
    assert.match(partialRefundInputError("REFUND_PARTIAL", 0), /required/);
    assert.equal(partialRefundInputError("FULL", null), null);
    assert.equal(partialRefundInputError("PARTIAL", 1), null);
  });

  it("caps partial refunds at the order total", () => {
    assert.equal(partialRefundExceedsOrderTotal("PARTIAL", 11_626, order), true);
    assert.equal(partialRefundExceedsOrderTotal("REFUND_PARTIAL", 11_625, order), false);
    assert.equal(partialRefundExceedsOrderTotal("FULL", 99_999, order), false);
  });

  it("treats only terminal Stripe dispute statuses as closed", () => {
    assert.equal(isOpenStripeDisputeStatus("needs_response"), true);
    assert.equal(isOpenStripeDisputeStatus(null), true);
    assert.equal(isOpenStripeDisputeStatus("WON"), false);
    assert.equal(isOpenStripeDisputeStatus("lost"), false);
    assert.equal(isOpenStripeDisputeStatus("warning_closed"), false);
  });

  it("returns stable conflict payloads for pending and completed local refunds", () => {
    assert.equal(sellerRefundConflictResponse(null), null);
    assert.deepEqual(sellerRefundConflictResponse("pending"), {
      status: 409,
      error: "A refund is already being processed for this order.",
    });
    assert.deepEqual(sellerRefundConflictResponse("re_123"), {
      status: 400,
      error: "A refund has already been issued for this order.",
    });
  });

  it("classifies failed refund lock acquisition from fresh order state", () => {
    assert.deepEqual(
      refundLockAcquisitionConflictResponse({ sellerRefundId: "pending", paymentEvents: [] }),
      {
        status: 409,
        error: "A refund is already being processed for this order.",
      },
    );
    assert.deepEqual(
      refundLockAcquisitionConflictResponse({
        sellerRefundId: null,
        paymentEvents: [{ eventType: "REFUND", status: "succeeded" }],
      }),
      {
        status: 400,
        error: "A refund has already been issued for this order.",
      },
    );
    assert.deepEqual(
      refundLockAcquisitionConflictResponse({
        sellerRefundId: null,
        labelStatus: "PURCHASED",
        paymentEvents: [],
      }),
      {
        status: 409,
        error: "Cannot refund this order after a shipping label has been purchased. Void or resolve the label first.",
      },
    );
    assert.deepEqual(refundLockAcquisitionConflictResponse(null), {
      status: 409,
      error: "Refund state changed while processing. Refresh and try again.",
    });
  });

  it("detects local and external refund ledgers for route guards", () => {
    assert.equal(orderHasRefundLedger({ sellerRefundId: null, paymentEvents: [] }), false);
    assert.equal(orderHasRefundLedger({ sellerRefundId: "re_123", paymentEvents: [] }), true);
    assert.equal(
      orderHasRefundLedger({
        sellerRefundId: null,
        paymentEvents: [{ eventType: "DISPUTE" }, { eventType: "REFUND" }],
      }),
      true,
    );
    assert.equal(
      orderHasRefundLedger({
        sellerRefundId: null,
        paymentEvents: [
          { eventType: "REFUND", status: "failed" },
          { eventType: "REFUND", status: "canceled" },
        ],
      }),
      false,
    );
    assert.equal(
      orderHasRefundLedger({
        sellerRefundId: null,
        paymentEvents: [{ eventType: "REFUND", status: "succeeded" }],
      }),
      true,
    );
    assert.equal(
      orderHasRefundLedger({
        sellerRefundId: null,
        paymentEvents: [{ eventType: "DISPUTE" }],
      }),
      false,
    );
  });

  it("blocks seller refunds after a shipping label has been purchased", () => {
    assert.equal(orderHasPurchasedLabel({ labelStatus: null }), false);
    assert.equal(orderHasPurchasedLabel({ labelStatus: "PURCHASED" }), true);
    assert.equal(orderHasPurchasedLabel({ labelStatus: "VOIDED" }), false);
  });

  it("treats only failed and canceled refund ledger events as non-blocking", () => {
    assert.equal(isBlockingRefundLedgerEvent({ eventType: "REFUND", status: "failed" }), false);
    assert.equal(isBlockingRefundLedgerEvent({ eventType: "REFUND", status: "canceled" }), false);
    assert.equal(isBlockingRefundLedgerEvent({ eventType: "REFUND", status: "cancelled" }), false);
    assert.equal(isBlockingRefundLedgerEvent({ eventType: "REFUND", status: "pending" }), true);
    assert.equal(isBlockingRefundLedgerEvent({ eventType: "REFUND", status: null }), true);
    assert.equal(isBlockingRefundLedgerEvent({ eventType: "DISPUTE", status: "open" }), false);
  });

  it("selects the first refund ledger event from already-sorted payment events", () => {
    const events = [
      { eventType: "DISPUTE", amountCents: 2_000 },
      { eventType: "REFUND", amountCents: 1_500, stripeObjectId: "re_failed", status: "failed" },
      { eventType: "REFUND", amountCents: 1_000, stripeObjectId: "re_old", status: "succeeded" },
    ];
    assert.deepEqual(latestRefundLedgerEvent(events), events[2]);
    assert.equal(latestRefundLedgerEvent([{ eventType: "DISPUTE" }]), null);
    assert.equal(latestRefundLedgerEvent([{ eventType: "REFUND", status: "canceled" }]), null);
    assert.equal(latestRefundLedgerEvent(null), null);
  });

  it("aggregates only positive in-stock item quantities for refund stock restoration", () => {
    assert.deepEqual(
      refundStockRestoreQuantities([
        { listingId: "listing_1", quantity: 1, listing: { listingType: "IN_STOCK" } },
        { listingId: "listing_1", quantity: 2, listing: { listingType: "IN_STOCK" } },
        { listingId: "listing_2", quantity: 1, listing: { listingType: "MADE_TO_ORDER" } },
        { listingId: "listing_3", quantity: 0, listing: { listingType: "IN_STOCK" } },
      ]),
      [{ listingId: "listing_1", quantity: 3 }],
    );
  });

  it("reactivates refunded listings only from current visible sold-out stock state", () => {
    assert.equal(
      shouldReactivateRefundedListing({
        status: "SOLD_OUT",
        listingType: "IN_STOCK",
        stockQuantity: 1,
        isPrivate: false,
      }),
      true,
    );
    assert.equal(
      shouldReactivateRefundedListing({
        status: "HIDDEN",
        listingType: "IN_STOCK",
        stockQuantity: 1,
        isPrivate: false,
      }),
      false,
    );
    assert.equal(
      shouldReactivateRefundedListing({
        status: "SOLD_OUT",
        listingType: "IN_STOCK",
        stockQuantity: 1,
        isPrivate: true,
      }),
      false,
    );
    assert.equal(
      shouldReactivateRefundedListing({
        status: "SOLD_OUT",
        listingType: "MADE_TO_ORDER",
        stockQuantity: 1,
        isPrivate: false,
      }),
      false,
    );
    assert.equal(
      shouldReactivateRefundedListing({
        status: "SOLD_OUT",
        listingType: "IN_STOCK",
        stockQuantity: 0,
        isPrivate: false,
      }),
      false,
    );
  });
});
