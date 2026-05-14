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

    assert.match(sellerCheckout, /source: "checkout_stock_restore_failed", route: "cart_checkout_seller"/);
    assert.match(sellerCheckout, /reason: "insufficient_stock_batch_rollback"/);
    assert.match(sellerCheckout, /reason: "checkout_create_error"/);
    assert.match(singleCheckout, /source: "checkout_stock_restore_failed", route: "cart_checkout_single"/);
    assert.match(singleCheckout, /reason: "checkout_create_error"/);
    assert.doesNotMatch(sellerCheckout, /\.catch\(\(\) => \{\}\)/);
    assert.doesNotMatch(singleCheckout, /\.catch\(\(\) => \{\}\)/);
  });
});
