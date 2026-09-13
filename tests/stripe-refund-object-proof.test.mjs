import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertStripeRefundObject } from "../scripts/stripe-refund-object-proof.mjs";

const OPERATORS = [
  "order-payment-event-blocked-checkout-production-proof.mjs",
  "order-payment-event-case-refund-production-proof.mjs",
  "order-payment-event-seller-refund-production-proof.mjs",
  "order-payment-event-signed-production-proof.mjs",
];

test("Stripe Refund proof accepts the real field shape without inventing livemode", () => {
  const refund = { id: "re_test_refund", object: "refund" };
  assert.equal(assertStripeRefundObject(refund), refund);
  assert.equal(assertStripeRefundObject({ ...refund, livemode: false }).object, "refund");
  assert.throws(() => assertStripeRefundObject({ ...refund, livemode: true }), /object shape drifted/);
  assert.throws(() => assertStripeRefundObject({ ...refund, object: "charge" }), /object shape drifted/);
  assert.throws(() => assertStripeRefundObject({ ...refund, id: "rf_wrong" }), /object shape drifted/);
});

test("all production refund proof operators use the shared real-object guard", () => {
  for (const name of OPERATORS) {
    const source = readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");
    assert.match(source, /assertStripeRefundObject/);
    assert.doesNotMatch(source, /refund\??\.livemode/);
  }
});
