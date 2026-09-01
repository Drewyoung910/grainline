import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  buyerOrderListPageFromRows,
  orderCountFromRows,
  sellerOrderListPageFromRows,
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
});
