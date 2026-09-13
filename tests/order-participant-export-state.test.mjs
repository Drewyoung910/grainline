import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buyerOrderExportPageFromRows,
  sellerOrderExportPageFromRows,
} from "../src/lib/orderParticipantExportState.ts";

function item() {
  return {
    listingId: "listing-1",
    quantity: 1,
    priceCents: 500,
    selectedVariants: [{
      groupName: "Finish",
      optionLabel: "Natural",
      priceAdjustCents: 0,
    }],
    listingSnapshot: {
      title: "Historical table",
      priceCents: 500,
      imageUrls: [],
      tags: [],
      sellerName: "Historical maker",
      unexpectedSecret: "drop-me",
    },
  };
}

function base() {
  return {
    id: "order-1",
    createdAtEpochMillis: 1_788_177_600_000,
    paidAtEpochMillis: 1_788_177_660_000,
    currency: "usd",
    itemsSubtotalCents: 500,
    shippingTitle: "Ground",
    shippingAmountCents: 100,
    taxAmountCents: 50,
    fulfillmentMethod: "SHIPPING",
    fulfillmentStatus: "SHIPPED",
    trackingCarrier: "UPS",
    trackingNumber: "track-1",
    shippedAtEpochMillis: 1_788_181_200_000,
    deliveredAtEpochMillis: null,
    sellerRefundState: "RECORDED",
    sellerRefundAmountCents: 500,
    items: [item()],
  };
}

function row(orderData) {
  return {
    order_data: orderData,
    created_at_epoch_millis: orderData.createdAtEpochMillis,
    order_id: orderData.id,
  };
}

describe("Order participant export state", () => {
  it("parses fixed buyer and seller rows and strips historical snapshot extras", () => {
    const buyerData = {
      ...base(),
      buyerEmail: "buyer@example.test",
      buyerName: "Buyer",
      shipToLine1: "1 Main",
      shipToLine2: null,
      shipToCity: "Austin",
      shipToState: "TX",
      shipToPostalCode: "78701",
      shipToCountry: "US",
      giftNote: "Enjoy",
      giftWrapping: true,
      giftWrappingPriceCents: 25,
      buyerDataPurgedAtEpochMillis: null,
    };
    const buyer = buyerOrderExportPageFromRows([row(buyerData)], 25);
    assert.equal(buyer.values[0].items[0].listingSnapshot.title, "Historical table");
    assert.equal("unexpectedSecret" in buyer.values[0].items[0].listingSnapshot, false);
    assert.deepEqual(buyer.cursor, {
      createdAtEpochMillis: buyerData.createdAtEpochMillis,
      orderId: "order-1",
    });

    const seller = sellerOrderExportPageFromRows([row(base())], 25);
    assert.equal(seller.values[0].sellerRefundState, "RECORDED");
    assert.equal(seller.values[0].sellerRefundAmountCents, 500);
  });

  it("rejects unknown keys, cursor mismatch, invalid refunds and retained purged PII", () => {
    const buyerData = {
      ...base(),
      buyerEmail: null,
      buyerName: null,
      shipToLine1: null,
      shipToLine2: null,
      shipToCity: null,
      shipToState: null,
      shipToPostalCode: null,
      shipToCountry: null,
      giftNote: null,
      giftWrapping: false,
      giftWrappingPriceCents: null,
      buyerDataPurgedAtEpochMillis: 1_788_200_000_000,
    };
    assert.throws(
      () => buyerOrderExportPageFromRows([row({ ...buyerData, stripeChargeId: "ch_secret" })], 25),
      /invalid shape/,
    );
    assert.throws(
      () => buyerOrderExportPageFromRows([{ ...row(buyerData), order_id: "other" }], 25),
      /cursor does not match/,
    );
    assert.throws(
      () => buyerOrderExportPageFromRows([row({ ...buyerData, buyerEmail: "retained@example.test" })], 25),
      /retained purged PII/,
    );
    assert.throws(
      () => sellerOrderExportPageFromRows([row({
        ...base(),
        sellerRefundState: "PROCESSING",
        sellerRefundAmountCents: 500,
      })], 25),
      /refund amount is inconsistent/,
    );
  });

  it("rejects oversized item and page payloads", () => {
    assert.throws(
      () => sellerOrderExportPageFromRows([row({ ...base(), items: Array.from({ length: 101 }, item) })], 25),
      /items are invalid/,
    );
    assert.throws(
      () => sellerOrderExportPageFromRows(Array.from({ length: 26 }, () => row(base())), 25),
      /page size is invalid/,
    );
  });
});
