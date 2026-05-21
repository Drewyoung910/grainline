import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("payment and fulfillment side-effect observability", () => {
  it("keeps fulfillment mutations from being masked by notification or email failures", () => {
    const route = source("src/app/api/orders/[id]/fulfillment/route.ts");

    assert.match(route, /source: "fulfillment_notification"/);
    assert.match(route, /source: "fulfillment_email"/);
    assert.match(route, /async function notifyBuyer/);
    assert.match(route, /function captureFulfillmentEmailFailure/);
    assert.doesNotMatch(route, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("captures seller-refund buyer notification and email failures", () => {
    const route = source("src/app/api/orders/[id]/refund/route.ts");

    assert.match(route, /source: "seller_refund_notification"/);
    assert.match(route, /source: "seller_refund_email"/);
    assert.match(route, /refundAmountCents/);
    assert.doesNotMatch(route, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("records seller refunds only while the refund lock is still held", () => {
    const route = source("src/app/api/orders/[id]/refund/route.ts");

    assert.match(route, /refundMayRestoreStock\(order\)/);
    assert.match(route, /tx\.order\.updateMany\(\{\s*where: \{ id: orderId, sellerRefundId: REFUND_LOCK_SENTINEL \}/s);
    assert.match(route, /if \(orderUpdate\.count !== 1\)/);
    assert.match(route, /manualStripeReconciliationNeeded: true/);
  });

  it("sanitizes Stripe webhook console error output before logging", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    assert.match(route, /sanitizeEmailOutboxError\(retrieveErr\)/);
    assert.match(route, /sanitizeEmailOutboxError\(err\)/);
    assert.doesNotMatch(route, /console\.error\("Webhook: failed to retrieve full event:", retrieveErr\)/);
    assert.doesNotMatch(route, /console\.error\("Stripe webhook handler error:", err\)/);
  });

  it("keeps shipping-label orphan paths observable without full label URLs", () => {
    const route = source("src/app/api/orders/[id]/label/route.ts");

    assert.match(route, /source: "label_lock_revert_failed"/);
    assert.match(route, /source: "shippo_label_post_purchase_db_update"/);
    assert.match(route, /source: "shippo_label_orphan_record_failed"/);
    assert.match(route, /hasLabelUrl: Boolean\(purchasedLabelDetails\?\.labelUrl\)/);
    assert.match(route, /hasTrackingNumber: Boolean\(purchasedLabelDetails\?\.trackingNumber\)/);
    assert.doesNotMatch(route, /extra: \{ orderId: id, purchasedLabelDetails \}/);
    assert.doesNotMatch(route, /source: "shippo_label_orphan_record_failed"[\s\S]*labelUrl: purchasedLabelDetails/s);
  });

  it("captures best-effort checkout stock restoration failures", () => {
    const sellerCheckout = source("src/app/api/cart/checkout-seller/route.ts");
    const singleCheckout = source("src/app/api/cart/checkout/single/route.ts");

    assert.match(sellerCheckout, /sanitizeEmailOutboxError\(err\)/);
    assert.match(singleCheckout, /sanitizeEmailOutboxError\(err\)/);
    assert.doesNotMatch(sellerCheckout, /console\.error\("POST \/api\/cart\/checkout-seller error:", err\)/);
    assert.doesNotMatch(singleCheckout, /console\.error\("POST \/api\/cart\/checkout\/single error:", err\)/);
    assert.match(sellerCheckout, /source: "checkout_stock_restore_failed", route: "cart_checkout_seller"/);
    assert.match(sellerCheckout, /reason: "insufficient_stock_batch_rollback"/);
    assert.match(sellerCheckout, /reason: "checkout_create_error"/);
    assert.match(singleCheckout, /source: "checkout_stock_restore_failed", route: "cart_checkout_single"/);
    assert.match(singleCheckout, /reason: "checkout_create_error"/);
    assert.doesNotMatch(sellerCheckout, /\.catch\(\(\) => \{\}\)/);
    assert.doesNotMatch(singleCheckout, /\.catch\(\(\) => \{\}\)/);
  });
});
