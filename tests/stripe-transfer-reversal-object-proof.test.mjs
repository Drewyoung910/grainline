import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertStripeTransferReversalObject } from "../scripts/stripe-transfer-reversal-object-proof.mjs";

test("Stripe TransferReversal proof accepts the real field shape without inventing livemode", () => {
  const reversal = { id: "trr_test_reversal", object: "transfer_reversal" };
  assert.equal(assertStripeTransferReversalObject(reversal), reversal);
  assert.equal(
    assertStripeTransferReversalObject({ ...reversal, livemode: false }).object,
    "transfer_reversal",
  );
  assert.throws(
    () => assertStripeTransferReversalObject({ ...reversal, livemode: true }),
    /object shape drifted/,
  );
  assert.throws(
    () => assertStripeTransferReversalObject({ ...reversal, object: "transfer" }),
    /object shape drifted/,
  );
  assert.throws(
    () => assertStripeTransferReversalObject({ ...reversal, id: "tr_wrong" }),
    /object shape drifted/,
  );
});

test("the blocked-checkout reconciliation uses the real TransferReversal guard", () => {
  const source = readFileSync(
    new URL("../scripts/order-payment-event-blocked-checkout-production-proof.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /assertStripeTransferReversalObject/);
  assert.doesNotMatch(source, /reversal\??\.livemode/);
});
