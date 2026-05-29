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

  it("allows partial refunds to restore only explicitly requested purchased stock", () => {
    const route = source("src/app/api/orders/[id]/refund/route.ts");
    const panel = source("src/components/SellerRefundPanel.tsx");
    const salesPage = source("src/app/dashboard/sales/[orderId]/page.tsx");

    assert.match(route, /restoreStock: z\.array/);
    assert.match(route, /requestedRefundStockRestoreQuantities\(myItems, requestedStockRestores\)/);
    assert.match(route, /Full refunds restore eligible stock automatically/);
    assert.match(route, /Stock cannot be restored after this order has shipped or been picked up/);
    assert.match(route, /: partialStockRestores/);
    assert.match(panel, /Restore inventory \(optional\)/);
    assert.match(panel, /restoreStock\.push\(\{ listingId: item\.listingId, quantity \}\)/);
    assert.match(salesPage, /restorableRefundItems/);
    assert.match(salesPage, /canRestoreStock=\{canRestoreRefundStock\}/);
  });

  it("sanitizes Stripe webhook console error output before logging", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    assert.match(route, /sanitizeEmailOutboxError\(retrieveErr\)/);
    assert.match(route, /sanitizeEmailOutboxError\(err\)/);
    assert.doesNotMatch(route, /console\.error\("Webhook: failed to retrieve full event:", retrieveErr\)/);
    assert.doesNotMatch(route, /console\.error\("Stripe webhook handler error:", err\)/);
  });

  it("persists Stripe order emails to the outbox before any direct send", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    const enqueueIndex = route.indexOf("enqueued = await enqueueEmailOutboxOnce");
    const directSendIndex = route.indexOf("await sendRenderedEmail(email, { throwOnFailure: true })");

    assert.notEqual(enqueueIndex, -1);
    assert.notEqual(directSendIndex, -1);
    assert.ok(enqueueIndex < directSendIndex, "order emails must reserve the outbox dedup row before direct send");
    assert.match(route, /throw outboxError/);
    assert.match(route, /status: "SENT"/);
    assert.match(route, /emailOutboxFailureState\(enqueued\.job\.attempts \+ 1\)/);
  });

  it("skips post-payment side effects for refunded or blocked checkout orders", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    assert.match(route, /function orderPostPaymentSideEffectsBlocked/);
    assert.match(route, /orderHasRefundLedger\(order\)/);
    assert.match(route, /BLOCKED_CHECKOUT_REVIEW_MARKER/);
    assert.match(route, /sellerRefundId: true/);
    assert.match(route, /reviewNeeded: true/);
    assert.match(route, /if \(orderPostPaymentSideEffectsBlocked\(order\)\) return/);
  });

  it("uses the refund sentinel lock before issuing automatic blocked-checkout refunds", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    assert.match(route, /sellerRefundId: REFUND_LOCK_SENTINEL/);
    assert.match(route, /paymentEvents: \{ none: blockingRefundOrDisputeLedgerWhere\(\) \}/);
    assert.match(route, /stripe\.refunds\.create/);
    assert.ok(
      route.indexOf("sellerRefundId: REFUND_LOCK_SENTINEL") < route.indexOf("stripe.refunds.create"),
      "blocked-checkout refunds must acquire the local lock before the Stripe refund call",
    );
    assert.match(route, /where: \{ id: input\.orderId, sellerRefundId: REFUND_LOCK_SENTINEL \}/);
    assert.match(route, /Blocked checkout refund lock was no longer held while recording Stripe refund/);
    assert.match(route, /stripe_webhook_blocked_checkout_refund_lock_release_failed/);
  });

  it("preserves fresh refund locks when terminal Stripe dispute events arrive", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    assert.match(route, /sellerRefundLockedAt: true/);
    assert.match(route, /order\.sellerRefundId === REFUND_LOCK_SENTINEL/);
    assert.match(route, /!isStaleRefundLock\(/);
    assert.match(route, /delete orderUpdate\.sellerRefundLockedAt/);
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
    assert.match(sellerCheckout, /CheckoutStockReservationStockError/);
    assert.match(sellerCheckout, /createCheckoutStockReservation/);
    assert.match(sellerCheckout, /reason: "checkout_create_error"/);
    assert.match(singleCheckout, /source: "checkout_stock_restore_failed", route: "cart_checkout_single"/);
    assert.match(singleCheckout, /CheckoutStockReservationStockError/);
    assert.match(singleCheckout, /createCheckoutStockReservation/);
    assert.match(singleCheckout, /reason: "checkout_create_error"/);
    assert.doesNotMatch(sellerCheckout, /\.catch\(\(\) => \{\}\)/);
    assert.doesNotMatch(singleCheckout, /\.catch\(\(\) => \{\}\)/);
  });
});
