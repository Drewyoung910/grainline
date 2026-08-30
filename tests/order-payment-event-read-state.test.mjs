import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buyerOrderPaymentHistoryPageFromRows,
  orderPaymentRefundOutcomesFromRows,
  orderPaymentStaffTimelineFromRows,
  sellerOrderPaymentHistoryPageFromRows,
} from "../src/lib/orderPaymentEventReadState.ts";

const BASE_ROW = Object.freeze({
  payment_event_id: "payment-1",
  order_id: "order-1",
  event_type: "REFUND",
  amount_cents: 500,
  currency: "usd",
  status: "succeeded",
  created_at_epoch_millis: 1_787_997_600_000n,
});

describe("OrderPaymentEvent read-state parsing", () => {
  it("parses bounded outcome rows and rejects duplicate orders", () => {
    const outcomes = orderPaymentRefundOutcomesFromRows([BASE_ROW]);
    assert.deepEqual(outcomes.get("order-1"), {
      eventType: "REFUND",
      amountCents: 500,
      currency: "usd",
      status: "succeeded",
      createdAt: new Date(1_787_997_600_000),
    });
    assert.throws(
      () => orderPaymentRefundOutcomesFromRows([BASE_ROW, BASE_ROW]),
      /duplicate order/i,
    );
    assert.throws(
      () => orderPaymentRefundOutcomesFromRows([
        { ...BASE_ROW, currency: "USD" },
      ]),
      /invalid currency/i,
    );
  });

  it("keeps buyer and seller export projections distinct and cursor-safe", () => {
    const buyer = buyerOrderPaymentHistoryPageFromRows([BASE_ROW], 1);
    assert.equal(buyer.rows[0].value.eventType, "REFUND");
    assert.equal("reason" in buyer.rows[0].value, false);
    assert.deepEqual(buyer.cursor, {
      paymentEventId: "payment-1",
      createdAtEpochMillis: 1_787_997_600_000n,
    });

    const seller = sellerOrderPaymentHistoryPageFromRows([
      { ...BASE_ROW, reason: "seller_refund" },
    ], 1);
    assert.equal(seller.rows[0].value.reason, "seller_refund");

    assert.throws(
      () => buyerOrderPaymentHistoryPageFromRows([
        { ...BASE_ROW, event_type: "DISPUTE" },
      ], 1),
      /non-refund/i,
    );
    assert.throws(
      () => sellerOrderPaymentHistoryPageFromRows([
        { ...BASE_ROW, reason: "x".repeat(256) },
      ], 1),
      /invalid reason/i,
    );
  });

  it("parses only selected staff accounting fields and rejects malformed values", () => {
    const [event] = orderPaymentStaffTimelineFromRows([{
      ...BASE_ROW,
      stripe_event_id: "evt_one",
      stripe_object_id: "re_one",
      stripe_object_type: "refund",
      reason: "seller_refund",
      description: "Recorded refund.",
      transfer_reversal_id: "trr_one",
      transfer_reversal_amount_cents: "475",
      platform_funded_refund_cents: "25",
      original_transfer_amount_cents: "475",
    }]);
    assert.deepEqual(event.refundAccounting, {
      transferReversalId: "trr_one",
      transferReversalAmountCents: 475,
      platformFundedRefundCents: 25,
      originalTransferAmountCents: 475,
    });
    assert.throws(
      () => orderPaymentStaffTimelineFromRows([{
        ...BASE_ROW,
        stripe_event_id: "evt_one",
        stripe_object_id: "re_one",
        stripe_object_type: "refund",
        reason: null,
        description: null,
        transfer_reversal_id: null,
        transfer_reversal_amount_cents: "4.75",
        platform_funded_refund_cents: null,
        original_transfer_amount_cents: null,
      }]),
      /invalid transfer reversal amount/i,
    );
  });
});
