import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  appendLabelClawbackReviewNote,
  labelClawbackBackoffMs,
  labelClawbackErrorMessage,
  labelClawbackIdempotencyKey,
  labelClawbackNextAttemptAt,
  labelClawbackReviewNote,
  labelClawbackStatusAfterFailure,
} = await import("../src/lib/labelClawbackState.ts");

describe("label clawback reconciliation state", () => {
  it("builds a staff-visible note for missing seller transfer IDs", () => {
    const note = labelClawbackReviewNote({
      amountCents: 1234,
      reason: "missing_transfer",
      shippoTransactionId: "shippo_txn_1",
    });

    assert.match(note, /Shippo label shippo_txn_1 cost \$12\.34/);
    assert.match(note, /no Stripe transfer ID/);
    assert.match(note, /manually reconcile/);
  });

  it("builds a bounded staff-visible note for failed Stripe reversals", () => {
    const note = labelClawbackReviewNote({
      amountCents: 2500,
      reason: "stripe_reversal_failed",
      shippoTransactionId: "shippo_txn_2",
      stripeTransferId: "tr_123",
      errorMessage: "Stripe rejected the reversal",
    });

    assert.match(note, /Shippo label shippo_txn_2 cost \$25\.00/);
    assert.match(note, /transfer tr_123/);
    assert.match(note, /Stripe rejected the reversal/);
    assert.match(note, /retry or manually reconcile/);
  });

  it("appends label notes without dropping the newest reconciliation instruction", () => {
    const existing = "Existing shipping review note.";
    const next = labelClawbackReviewNote({
      amountCents: 500,
      reason: "missing_transfer",
    });
    const combined = appendLabelClawbackReviewNote(existing, next);

    assert.match(combined, /Existing shipping review note/);
    assert.match(combined, /The purchased Shippo label cost \$5\.00/);
  });

  it("normalizes and bounds Stripe error messages", () => {
    const err = new Error(` ${"Z".repeat(800)} `);
    const message = labelClawbackErrorMessage(err);

    assert.equal(message.length <= 500, true);
    assert.match(message, /\.\.\.$/);
  });

  it("sanitizes Stripe reversal errors before persisting review notes", () => {
    const message = labelClawbackErrorMessage(
      new Error(
        "Failed reversal for seller@example.com at https://api.stripe.com/v1/transfers/tr_1234567890abcdef with pi_1234567890abcdef and 0123456789abcdef0123456789abcdef",
      ),
    );

    assert.equal(message, "Failed reversal for [email] at [url] with [token] and [token]");
    assert.doesNotMatch(message, /seller@example\.com|https:\/\/api\.stripe\.com|tr_1234567890abcdef|pi_1234567890abcdef|0123456789abcdef/);
  });

  it("uses a stable Stripe idempotency key for initial and retry reversals", () => {
    assert.equal(
      labelClawbackIdempotencyKey({
        orderId: "ord_1",
        shippoTransactionId: "shippo_txn_1",
        shippoRateObjectId: "rate_1",
        amountCents: 1299,
      }),
      "label-cost:ord_1:shippo_txn_1:1299",
    );
    assert.equal(
      labelClawbackIdempotencyKey({
        orderId: "ord_1",
        shippoRateObjectId: "rate_1",
        amountCents: 1299,
      }),
      "label-cost:ord_1:rate_1:1299",
    );
  });

  it("backs off failed clawback retries before manual review", () => {
    const now = new Date("2026-05-23T12:00:00.000Z");

    assert.equal(labelClawbackBackoffMs(1), 15 * 60 * 1000);
    assert.equal(labelClawbackNextAttemptAt(2, now)?.toISOString(), "2026-05-23T13:00:00.000Z");
    assert.equal(labelClawbackStatusAfterFailure(4), "RETRY_PENDING");
    assert.equal(labelClawbackStatusAfterFailure(5), "MANUAL_REVIEW");
    assert.equal(labelClawbackNextAttemptAt(5, now), null);
  });
});
