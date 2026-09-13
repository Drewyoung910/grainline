import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const record = readFileSync(
  "docs/order-payment-shipping-inspection-force-posture-correction.md",
  "utf8",
);

test("records the failed inspection and exact FORCE-posture correction", () => {
  assert.match(record, /31918034914/);
  assert.match(record, /e78c1ef28f88778f86947a8cb501af8dfb916b26/);
  assert.match(record, /repeatable-read\/read-only transaction/);
  assert.match(record, /failed closed before the aggregate count query/);
  assert.match(record, /wrote no evidence file/);
  assert.match(record, /No migration, row mutation, grant\/RLS change, deployment or\s+provider mutation occurred/);
  assert.match(record, /`CheckoutStockReservation`; and\s+- `StripeWebhookEvent`/);
  assert.match(record, /`Order`;[\s\S]*`SellerPayoutEvent`/);
  assert.match(record, /`POSTURE_MISMATCH`/);
  assert.match(record, /new\s+protected inspection must then run/);
  assert.match(record, /Nothing here authorizes the\s+SellerPayoutEvent migration/);
});
