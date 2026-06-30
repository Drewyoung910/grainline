import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

function source(path) {
  return readFileSync(path, "utf8");
}

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
      currency: "jpy",
      reason: "stripe_reversal_failed",
      shippoTransactionId: "shippo_txn_2",
      stripeTransferId: "tr_123",
      errorMessage: "Stripe rejected the reversal",
    });

    assert.match(note, /Shippo label shippo_txn_2 cost ¥2,500/);
    assert.doesNotMatch(note, /\$25\.00/);
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

  it("advances stale retry claims instead of reusing the previous attempt count", () => {
    const retry = source("src/lib/labelClawbackRetry.ts");

    assert.match(retry, /const attemptCount = order\.labelClawbackRetryCount \+ 1/);
    assert.doesNotMatch(retry, /Math\.max\(1, order\.labelClawbackRetryCount\)/);
  });

  it("preserves accepted Stripe reversals if the local success write fails", () => {
    const route = source("src/app/api/orders/[id]/label/route.ts");
    const orphanStart = route.indexOf("const orphanRecordedAt = new Date()");
    const orphanEnd = route.indexOf(".catch((updateError)", orphanStart);
    const orphanBlock = route.slice(orphanStart, orphanEnd);

    assert.match(route, /let labelClawbackReversalAccepted = false/);
    assert.match(route, /labelClawbackReversalAccepted = true/);
    assert.match(route, /acceptedLabelClawbackReversalId = reversal\.id \?\? null/);
    assert.match(route, /source: "label_cost_clawback_record_failed"/);
    assert.match(orphanBlock, /labelClawbackReversalAccepted/);
    assert.match(orphanBlock, /labelClawbackStatus: "REVERSED" as const/);
    assert.match(orphanBlock, /labelClawbackReversalId: acceptedLabelClawbackReversalId/);
    assert.ok(
      orphanBlock.indexOf('labelClawbackStatus: "REVERSED" as const') <
        orphanBlock.indexOf('labelClawbackStatus: "RETRY_PENDING" as const'),
      "accepted reversals should be preserved before retry-pending fallback",
    );
  });

  it("keeps active label-cost reconciliation holds visible to staff", () => {
    const adminActions = source("src/app/admin/actions.ts");

    assert.match(adminActions, /NOT: \{ labelClawbackStatus: \{ in: \["RETRY_PENDING", "RETRYING"\] \} \}/);
    assert.match(adminActions, /active label-cost reconciliation/);
  });
});
