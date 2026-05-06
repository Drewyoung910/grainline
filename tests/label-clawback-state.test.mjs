import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  appendLabelClawbackReviewNote,
  labelClawbackErrorMessage,
  labelClawbackReviewNote,
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
    const err = new Error(` ${"A".repeat(800)} `);
    const message = labelClawbackErrorMessage(err);

    assert.equal(message.length <= 500, true);
    assert.match(message, /\.\.\.$/);
  });
});
