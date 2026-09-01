import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buyerOrderDetailFromRows,
  sellerOrderDetailFromRows,
} from "../src/lib/orderParticipantDetailState.ts";
import { sellerRefundDisplayState } from "../src/lib/refundLockState.ts";

function baseRow() {
  return {
    order_id: "order-1",
    created_at_epoch_millis: 1_700_000_000_000,
    paid_at_epoch_millis: null,
    currency: "USD",
    items_subtotal_cents: 500,
    shipping_title: null,
    shipping_amount_cents: 0,
    tax_amount_cents: 0,
    fulfillment_method: "PICKUP",
    fulfillment_status: "PENDING",
    tracking_carrier: null,
    tracking_number: null,
    pickup_ready_at_epoch_millis: null,
    picked_up_at_epoch_millis: null,
    shipped_at_epoch_millis: null,
    delivered_at_epoch_millis: null,
    estimated_delivery_at_epoch_millis: null,
    shipping_carrier: null,
    shipping_service: null,
    review_needed: false,
    gift_note: null,
    gift_wrapping: false,
    gift_wrapping_price_cents: null,
    buyer_data_purged_at_epoch_millis: null,
    ship_to_line_1: null,
    ship_to_line_2: null,
    ship_to_city: null,
    ship_to_state: null,
    ship_to_postal_code: null,
    ship_to_country: null,
    seller_refund_state: "NONE",
    seller_refund_amount_cents: null,
    items: [{
      id: "item-1",
      listingId: "listing-1",
      priceCents: 500,
      quantity: 1,
      listingLinkAvailable: true,
      listingSnapshot: null,
      selectedVariants: null,
    }],
  };
}

describe("Order participant detail state", () => {
  it("maps buyer and seller rows into bounded application values", () => {
    const buyer = buyerOrderDetailFromRows([{ ...baseRow(), seller_user_id: "seller-user-1" }]);
    assert.equal(buyer?.currency, "usd");
    assert.equal(buyer?.items[0].snapshot.title, "Purchased item");

    const seller = sellerOrderDetailFromRows([{
      ...baseRow(),
      processing_deadline_epoch_millis: null,
      deauthorized_review_hold: false,
      buyer_id: "buyer-1",
      buyer_name: "Buyer",
      buyer_email: "buyer@example.test",
      buyer_deleted_at_epoch_millis: null,
      seller_notes: null,
      label_status: null,
      label_url: null,
      label_carrier: null,
      label_tracking_number: null,
      label_purchased_at_epoch_millis: null,
    }]);
    assert.equal(seller?.buyerName, "Buyer");
    assert.equal(
      buyerOrderDetailFromRows([{ ...baseRow(), seller_user_id: null }])?.sellerUserId,
      null,
    );
  });

  it("fails closed on purge, contact, and stale-label boundary drift", () => {
    assert.throws(
      () => buyerOrderDetailFromRows([{
        ...baseRow(),
        seller_user_id: "seller-1",
        buyer_data_purged_at_epoch_millis: 1_700_000_000_001,
        ship_to_line_1: "must not escape",
      }]),
      /purge boundary is inconsistent/i,
    );
    assert.throws(
      () => sellerOrderDetailFromRows([{
        ...baseRow(),
        processing_deadline_epoch_millis: null,
        deauthorized_review_hold: false,
        buyer_data_purged_at_epoch_millis: 1_700_000_000_001,
        buyer_id: "buyer-1",
        buyer_name: null,
        buyer_email: null,
        buyer_deleted_at_epoch_millis: null,
        seller_notes: null,
        label_status: null,
        label_url: null,
        label_carrier: null,
        label_tracking_number: null,
        label_purchased_at_epoch_millis: null,
      }]),
      /identity boundary is inconsistent/i,
    );
    assert.throws(
      () => sellerOrderDetailFromRows([{
        ...baseRow(),
        processing_deadline_epoch_millis: null,
        deauthorized_review_hold: false,
        buyer_id: "buyer-1",
        buyer_name: "Buyer",
        buyer_email: "buyer@example.test",
        buyer_deleted_at_epoch_millis: null,
        seller_notes: null,
        label_status: "EXPIRED",
        label_carrier: "Stale Carrier",
        label_tracking_number: null,
        label_purchased_at_epoch_millis: null,
      }]),
      /label boundary is inconsistent/i,
    );
  });

  it("fails closed on duplicate rows, inconsistent refund fields, and malformed items", () => {
    assert.throws(
      () => buyerOrderDetailFromRows([
        { ...baseRow(), seller_user_id: "seller-1" },
        { ...baseRow(), seller_user_id: "seller-1" },
      ]),
      /row is invalid/i,
    );
    assert.throws(
      () => buyerOrderDetailFromRows([{
        ...baseRow(),
        seller_user_id: "seller-1",
        seller_refund_amount_cents: 100,
      }]),
      /refund amount is inconsistent/i,
    );
    assert.throws(
      () => buyerOrderDetailFromRows([{
        ...baseRow(),
        seller_user_id: "seller-1",
        items: [{ ...baseRow().items[0], quantity: 0 }],
      }]),
      /item quantity is invalid/i,
    );
  });

  it("derives participant-safe refund display states without returning provider ids", () => {
    assert.equal(sellerRefundDisplayState(null), "NONE");
    assert.equal(sellerRefundDisplayState("pending"), "PROCESSING");
    assert.equal(
      sellerRefundDisplayState("ambiguous_refund_pending_reconciliation"),
      "AMBIGUOUS",
    );
    assert.equal(sellerRefundDisplayState("re_private_provider_id"), "RECORDED");
  });
});
