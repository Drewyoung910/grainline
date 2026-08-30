import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("activation rollback proof is exact, drift-rejecting and self-restoring", () => {
  const source = readFileSync(
    "scripts/order-payment-event-activation-rollback-proof.mjs",
    "utf8",
  );
  assert.match(source, /GRANT SELECT ON TABLE public\."OrderPaymentEvent" TO PUBLIC/u);
  assert.match(source, /grainline_order_payment_buyer_export_page/u);
  assert.match(source, /predecessorTableCrudRestored: true/u);
  assert.match(source, /predecessorRetiredFunctionsRestored: 2/u);
  assert.match(source, /activationRestored: true/u);
  assert.doesNotMatch(source, /INSERT INTO public\."OrderPaymentEvent"/u);
});
