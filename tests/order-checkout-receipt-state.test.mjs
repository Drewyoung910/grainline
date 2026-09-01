import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { orderCheckoutReceiptsFromRows } from "../src/lib/orderCheckoutReceiptState.ts";

function row(overrides = {}) {
  return {
    order_id: "order-2",
    created_at_epoch_millis: 1_700_000_000_000,
    paid_at_epoch_millis: 1_700_000_001_000,
    currency: "USD",
    items_subtotal_cents: 500,
    shipping_title: "Ground",
    shipping_amount_cents: 100,
    tax_amount_cents: 50,
    gift_wrapping_price_cents: 25,
    buyer_label: "Checkout Buyer",
    items: [{
      id: "item-1",
      listingId: "listing-1",
      priceCents: 500,
      quantity: 1,
      listingLinkAvailable: true,
      listingSnapshot: {
        title: "Snapshot title",
        description: "Checkout-time description",
        priceCents: 500,
        imageUrls: [],
        category: "FURNITURE",
        tags: ["oak"],
        sellerName: "Snapshot maker",
        capturedAt: "2026-08-31T10:00:00.000Z",
        listingType: "IN_STOCK",
        processingTimeMinDays: null,
        processingTimeMaxDays: null,
        shipsWithinDays: 2,
      },
      selectedVariants: null,
    }],
    ...overrides,
  };
}

describe("Order checkout receipt state", () => {
  it("maps a bounded historical receipt projection", () => {
    const receipts = orderCheckoutReceiptsFromRows([row()]);
    assert.equal(receipts[0].currency, "usd");
    assert.equal(receipts[0].buyerLabel, "Checkout Buyer");
    assert.equal(receipts[0].items[0].snapshot.title, "Snapshot title");
    assert.equal(receipts[0].items[0].listingLinkAvailable, true);
    assert.equal(receipts[0].paidAt instanceof Date, true);
  });

  it("fails closed on empty items and subtotal drift", () => {
    assert.throws(
      () => orderCheckoutReceiptsFromRows([row({ items: [] })]),
      /items are invalid/i,
    );
    assert.throws(
      () => orderCheckoutReceiptsFromRows([row({ items_subtotal_cents: 499 })]),
      /subtotal is inconsistent/i,
    );
  });

  it("fails closed on duplicate or unstable receipt order", () => {
    assert.throws(
      () => orderCheckoutReceiptsFromRows([row(), row()]),
      /duplicated/i,
    );
    assert.throws(
      () => orderCheckoutReceiptsFromRows([
        row({ order_id: "order-1", created_at_epoch_millis: 1_700_000_000_000 }),
        row({ order_id: "order-3", created_at_epoch_millis: 1_700_000_001_000 }),
      ]),
      /ordering is invalid/i,
    );
  });

  it("fails closed on missing payment time and malformed buyer labels", () => {
    assert.throws(
      () => orderCheckoutReceiptsFromRows([row({ paid_at_epoch_millis: null })]),
      /paid time is invalid/i,
    );
    assert.throws(
      () => orderCheckoutReceiptsFromRows([row({ buyer_label: "" })]),
      /buyer label is invalid/i,
    );
  });
});
