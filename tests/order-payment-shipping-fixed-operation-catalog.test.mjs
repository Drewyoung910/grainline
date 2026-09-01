import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const catalog = fs.readFileSync(
  "docs/order-payment-shipping-fixed-operation-catalog.md",
  "utf8",
);

test("Order fixed-operation catalog separates live service ledgers from designs", () => {
  assert.match(catalog, /mixed implementation ledger/);
  assert.match(catalog, /StripeWebhookEvent operations 1-3 and\s+34-36 are live/);
  assert.match(
    catalog,
    /SellerPayoutEvent operation 11 plus its latest\/export projections are live\s+as compatible preparation/,
  );
  assert.match(catalog, /application conversion remains isolated and undeployed/);
  assert.match(
    catalog,
    /Remaining Order,\s+OrderItem, shipping-quote and\s+payment families are design contracts only/,
  );
  assert.match(catalog, /does not authorize SQL, a migration,\s+an EXECUTE grant/);
  assert.match(catalog, /policyless ENABLE\/FORCE RLS/);
  assert.match(catalog, /PUBLIC` has no EXECUTE/);
});

test("reservation creation catalog names the source-consistent live successors", () => {
  assert.match(catalog, /grainline_checkout_reservation_create_cart_consistent/);
  assert.match(catalog, /grainline_checkout_reservation_create_single_consistent/);
  assert.match(catalog, /application witness only as a rejection condition/);
  assert.match(catalog, /predecessor deployment coexistence/);
});

test("catalog pins every numbered operation family from 1 through 37", () => {
  const operationNumbers = [...catalog.matchAll(/^([0-9]+)\. `grainline_/gm)].map(
    (match) => Number(match[1]),
  );
  assert.deepEqual(
    operationNumbers,
    Array.from({ length: 37 }, (_, index) => index + 1),
  );
});

test("webhook lifecycle is generation-bound and type-immutable", () => {
  assert.match(catalog, /grainline_stripe_webhook_begin/);
  assert.match(catalog, /claimGeneration/);
  assert.match(catalog, /stale reclaim increments it under a row lock/);
  assert.match(catalog, /Existing type\s+mismatch fails/);
  assert.match(catalog, /grainline_stripe_webhook_complete/);
  assert.match(catalog, /grainline_stripe_webhook_fail/);
  assert.match(catalog, /ID-only finalization is forbidden/);
});

test("every mutable provider family has claim/finalize semantics", () => {
  for (const marker of [
    "checkout_reservation_repair_claim_batch",
    "checkout_reservation_repair_finalize",
    "seller_refund_claim",
    "seller_refund_provider_record",
    "seller_refund_finalize",
    "seller_label_claim",
    "seller_label_provider_record",
    "seller_label_finalize",
    "label_clawback_claim_batch",
    "label_clawback_finalize",
  ]) assert.match(catalog, new RegExp(marker), marker);
  assert.match(catalog, /exact claim generation/);
  assert.match(catalog, /stale workers cannot finalize/);
});

test("participant and staff projections are bounded and cursor-paged", () => {
  for (const marker of [
    "grainline_buyer_order_page",
    "grainline_buyer_order_detail",
    "grainline_seller_order_page",
    "grainline_seller_order_detail",
    "grainline_staff_order_page",
    "grainline_staff_order_detail",
    "grainline_checkout_success_order",
    "grainline_order_review_eligibility",
  ]) assert.match(catalog, new RegExp(marker), marker);
  assert.match(catalog, /raw payment-event\s+rows/);
  assert.match(catalog, /`\(createdAt,id\)` keyset cursors/);
  assert.match(catalog, /limits are clamped in the database/);
});

test("catalog refuses generic CRUD escape hatches", () => {
  assert.match(catalog, /No function may be named or shaped as generic/);
  for (const marker of ["get_order", "update_order", "set_status", "cleanup_rows"])
    assert.match(catalog, new RegExp("`" + marker + "`"), marker);
  assert.match(catalog, /leave an unconverted ordinary\s+runtime base-table access behind/);
});

test("catalog covers Stripe lease maintenance and legacy stock dedup", () => {
  assert.match(catalog, /grainline_stripe_webhook_prune_batch/);
  assert.match(catalog, /caller cannot supply row IDs or a cutoff/);
  assert.match(catalog, /grainline_stripe_webhook_health_summary/);
  assert.match(catalog, /cannot enumerate\s+event IDs, types or retained errors/);
  assert.match(catalog, /grainline_legacy_stock_restore_claim/);
  assert.match(catalog, /canonical `checkout-stock-restore:` identity/);
});
