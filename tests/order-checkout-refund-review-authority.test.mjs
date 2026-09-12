import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { checkoutRefundReviewOutcomeFromRows } from "../src/lib/orderCheckoutRefundReviewState.ts";

const sql = fs.readFileSync(
  "docs/rls-drafts/order-checkout-refund-review-authority.sql",
  "utf8",
);
const wrapper = fs.readFileSync(
  "src/lib/orderCheckoutRefundReviewAuthority.ts",
  "utf8",
);
const route = fs.readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

describe("Order checkout refund review authority", () => {
  it("binds writes to an active signed event generation and exact Order session", () => {
    assert.match(sql, /source_event\."sourceObjectId" IS DISTINCT FROM p_session_id/);
    assert.match(sql, /source_event\."claimGeneration" IS DISTINCT FROM p_claim_generation/);
    assert.match(sql, /source_event\."processingStartedAt" IS NULL/);
    assert.match(sql, /source_event\."processedAt" IS NOT NULL/);
    assert.match(sql, /source_order\."stripeSessionId" IS DISTINCT FROM p_session_id/);
    assert.match(sql, /FOR UPDATE/);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path = pg_catalog/);
    assert.doesNotMatch(sql, /\bEXECUTE\s+FORMAT\b|\bEXECUTE\s+IMMEDIATE\b/i);
    assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/);
    assert.match(wrapper, /grainline_stripe_checkout_refund_review/);
  });

  it("derives the review prefix and closed outcome messages in PostgreSQL", () => {
    assert.match(sql, /Order was held for staff review\./);
    assert.match(sql, /p_action IS NULL[\s\S]*p_action NOT IN \('missing_payment_intent', 'claim_conflict', 'provider_failure'\)/);
    assert.match(sql, /source_order\."stripePaymentIntentId" IS NOT NULL/);
    assert.match(sql, /source_has_refund/);
    assert.match(sql, /source_has_open_dispute/);
    assert.match(sql, /pg_catalog\.left\(source_note, 10000\)/);
    assert.doesNotMatch(sql, /p_reason|p_review_note|p_message/);
  });

  it("removes the last direct Order family from the Stripe webhook", () => {
    assert.match(route, /recordCheckoutRefundReview\(\{/);
    assert.doesNotMatch(route, /prisma\.order\./);
    assert.doesNotMatch(route, /blockedCheckoutDisputeState|orderHasRefundLedger|REFUND_LOCK_SENTINEL/);
    assert.match(route, /action: "missing_payment_intent"/);
    assert.match(route, /action: "claim_conflict"/);
    assert.match(route, /action: "provider_failure"/);
  });

  it("parses only exact closed outcomes", () => {
    for (const outcome of [
      "missing_payment_intent",
      "refund_exists",
      "open_dispute",
      "state_changed",
      "provider_failure",
    ]) {
      assert.equal(checkoutRefundReviewOutcomeFromRows([{ outcome }]), outcome);
    }
    assert.throws(() => checkoutRefundReviewOutcomeFromRows([]), /cardinality/);
    assert.throws(() => checkoutRefundReviewOutcomeFromRows([{ outcome: "other" }]), /outcome/);
    assert.throws(
      () => checkoutRefundReviewOutcomeFromRows([{ outcome: "open_dispute", extra: true }]),
      /unexpected fields/,
    );
  });
});
