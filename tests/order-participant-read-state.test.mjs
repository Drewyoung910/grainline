import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  buyerOrderListPageFromRows,
  buyerOrderSummaryPageFromRows,
  orderCountFromRows,
  sellerOrderListPageFromRows,
  sellerOrderSummaryPageFromRows,
} = await import("../src/lib/orderParticipantReadState.ts");

const buyerRow = {
  order_id: "order-1",
  created_at_epoch_millis: "1788199200000",
  paid_at_epoch_millis: 1788199260000n,
  currency: "USD",
  items_subtotal_cents: 500,
  shipping_title: "Ground",
  shipping_amount_cents: 100,
  tax_amount_cents: 50,
  gift_wrapping_price_cents: null,
  seller_refund_amount_cents: null,
  fulfillment_status: "PENDING",
};

describe("Order participant read state", () => {
  it("normalizes safe PostgreSQL scalar representations and emits a cursor", () => {
    const page = buyerOrderListPageFromRows([buyerRow], 1);
    assert.equal(page.rows[0].currency, "usd");
    assert.equal(page.rows[0].paidAt.getTime(), 1788199260000);
    assert.deepEqual(page.cursor, {
      createdAtEpochMillis: 1788199200000,
      orderId: "order-1",
    });
    assert.equal(orderCountFromRows([{ value: "2" }], "Buyer"), 2);
  });

  it("validates seller-only fields and deleted-buyer timestamps", () => {
    const page = sellerOrderListPageFromRows([{
      ...buyerRow,
      seller_notes_present: false,
      buyer_name: null,
      buyer_email: null,
      buyer_data_purged_at_epoch_millis: 1788199300000,
      buyer_deleted_at_epoch_millis: null,
    }], 10);
    assert.equal(page.rows[0].sellerNotesPresent, false);
    assert.equal(page.rows[0].buyerDataPurgedAt.getTime(), 1788199300000);
    assert.equal(page.cursor, null);
  });

  it("rejects unknown statuses, unsafe numbers and oversized pages", () => {
    assert.throws(
      () => buyerOrderListPageFromRows([{ ...buyerRow, fulfillment_status: "FORGED" }], 1),
      /fulfillment status is invalid/,
    );
    assert.throws(
      () => buyerOrderListPageFromRows([{ ...buyerRow, tax_amount_cents: -1 }], 1),
      /tax amount is invalid/,
    );
    assert.throws(
      () => buyerOrderListPageFromRows([buyerRow, buyerRow], 1),
      /exceeded its limit/,
    );
    assert.throws(
      () => orderCountFromRows([{ value: 1 }, { value: 2 }], "Buyer"),
      /count row is invalid/,
    );
  });

  it("parses bounded minimal historical summaries and rejects oversized payloads", () => {
    const summaryItem = {
      id: "item-1",
      listingId: "listing-1",
      priceCents: 500,
      quantity: 1,
      title: "Original stool",
      imageUrl: "https://example.test/stool.jpg",
      sellerName: "Maker One",
    };
    const buyer = buyerOrderSummaryPageFromRows([{
      ...buyerRow,
      label_carrier: "UPS",
      label_tracking_number: "TRACK-1",
      item_count: 6,
      items: [summaryItem],
    }], 5);
    assert.equal(buyer.rows[0].itemCount, 6);
    assert.equal(buyer.rows[0].items[0].title, "Original stool");
    assert.equal(buyer.rows[0].items[0].imageUrl, "https://example.test/stool.jpg");
    assert.equal(buyer.rows[0].items[0].sellerName, "Maker One");
    assert.equal(buyer.rows[0].labelTrackingNumber, "TRACK-1");

    const seller = sellerOrderSummaryPageFromRows([{
      ...buyerRow,
      seller_notes_present: false,
      buyer_name: "Buyer One",
      buyer_email: "buyer@example.test",
      buyer_data_purged_at_epoch_millis: null,
      buyer_deleted_at_epoch_millis: null,
      item_count: 1,
      items: [summaryItem],
    }], 5);
    assert.equal(seller.rows[0].items.length, 1);

    const emptyLegacyOrder = buyerOrderSummaryPageFromRows([{
      ...buyerRow,
      label_carrier: null,
      label_tracking_number: null,
      item_count: 0,
      items: [],
    }], 5);
    assert.equal(emptyLegacyOrder.rows[0].itemCount, 0);
    assert.deepEqual(emptyLegacyOrder.rows[0].items, []);
    assert.throws(
      () => buyerOrderSummaryPageFromRows([{
        ...buyerRow,
        label_carrier: null,
        label_tracking_number: null,
        item_count: 1,
        items: Array.from({ length: 6 }, () => summaryItem),
      }], 10),
      /summary items are invalid/,
    );
  });
});
