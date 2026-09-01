import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  staffOrderDetailFromRows,
  staffOrderPageFromRows,
} from "../src/lib/orderStaffReadState.ts";

function detailRow() {
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
    processing_deadline_epoch_millis: null,
    shipping_carrier: null,
    shipping_service: null,
    review_needed: false,
    review_note: null,
    gift_note: null,
    gift_wrapping: false,
    gift_wrapping_price_cents: null,
    buyer_data_purged_at_epoch_millis: null,
    buyer_id: "buyer-1",
    buyer_name: "Buyer",
    buyer_email: "buyer@example.test",
    ship_to_line_1: null,
    ship_to_line_2: null,
    ship_to_city: null,
    ship_to_state: null,
    ship_to_postal_code: null,
    ship_to_country: null,
    quoted_shipping_amount_cents: null,
    quoted_to_city: null,
    quoted_to_state: null,
    quoted_to_postal_code: null,
    quoted_to_country: null,
    quoted_use_calculated_shipping: null,
    seller_profile_id: "seller-1",
    seller_display_name: "Maker",
    seller_refund_state: "NONE",
    seller_refund_id: null,
    seller_refund_amount_cents: null,
    refund_claim_state: null,
    label_status: null,
    label_clawback_status: null,
    items: [{
      id: "item-1",
      listingId: "listing-1",
      priceCents: 500,
      quantity: 1,
      currentListingType: "IN_STOCK",
      listingActive: true,
      listingSnapshot: null,
      selectedVariants: null,
    }],
  };
}

describe("Order staff read state", () => {
  it("maps bounded queue and detail rows", () => {
    const page = staffOrderPageFromRows([{
      total_count: 1,
      safe_page: 1,
      orders: [{
        id: "order-1",
        createdAtEpochMillis: 1_700_000_000_000,
        currency: "USD",
        itemsSubtotalCents: 500,
        shippingAmountCents: 0,
        taxAmountCents: 0,
        giftWrappingPriceCents: null,
        quotedShippingAmountCents: null,
        fulfillmentStatus: "PENDING",
        reviewNeeded: true,
        reviewNote: "Needs support",
        buyerLabel: "Buyer",
        buyerEmail: "buyer@example.test",
        sellerProfileId: "seller-1",
        sellerLabel: "Maker",
        itemCount: 1,
        items: [{ title: "Table", quantity: 1 }],
      }],
    }]);
    assert.equal(page?.orders[0].currency, "usd");

    const detail = staffOrderDetailFromRows([detailRow()]);
    assert.equal(detail?.items[0].snapshot.title, "Purchased item");
    assert.equal(detail?.items[0].currentListingType, "IN_STOCK");
  });

  it("fails closed on duplicate rows and inconsistent refund identity", () => {
    assert.throws(
      () => staffOrderDetailFromRows([detailRow(), detailRow()]),
      /row count/i,
    );
    assert.throws(
      () => staffOrderDetailFromRows([{
        ...detailRow(),
        seller_refund_state: "RECORDED",
      }]),
      /refund identity is inconsistent/i,
    );
  });

  it("rejects PII after the purge boundary", () => {
    assert.throws(
      () => staffOrderDetailFromRows([{
        ...detailRow(),
        buyer_data_purged_at_epoch_millis: 1_700_000_100_000,
      }]),
      /purged buyer data is inconsistent/i,
    );
  });
});
