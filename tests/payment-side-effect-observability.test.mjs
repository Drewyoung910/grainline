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
    assert.match(
      route,
      /tx\.order\.updateMany\(\{\s*where: \{ id: orderId, sellerRefundId: REFUND_LOCK_SENTINEL \}/s,
    );
    assert.match(route, /if \(orderUpdate\.count !== 1\)/);
    assert.match(route, /manualStripeReconciliationNeeded: true/);
  });

  it("records staff case refunds only while the refund lock is still held", () => {
    const route = source("src/app/api/cases/[id]/resolve/route.ts");

    assert.match(
      route,
      /sellerProfile: \{ select: \{ id: true, stripeAccountId: true \} \}/,
    );
    assert.match(route, /refundMayRestoreStock\(caseRecord\.order\)/);
    assert.match(
      route,
      /tx\.order\.updateMany\(\{\s*where: \{ id: caseRecord\.orderId, sellerRefundId: REFUND_LOCK_SENTINEL \}/s,
    );
    assert.match(route, /if \(orderUpdate\.count !== 1\)/);
    assert.match(route, /CASE_REFUND_LOCK_LOST/);
    assert.match(route, /manualStripeReconciliationNeeded: true/);
  });

  it("keeps seller and staff refund entrypoints single-refund per order", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");

    for (const route of [sellerRoute, caseRoute]) {
      assert.match(route, /blockingRefundLedgerWhere/);
      assert.match(route, /blockingRefundOrDisputeLedgerWhere/);
      assert.match(route, /blockingRefundOrLatestOpenDisputeLedgerExistsSql/);
      assert.match(route, /sellerRefundConflictResponse/);
      assert.match(route, /orderHasRefundLedger/);
      assert.match(
        route,
        /await prisma\.\$executeRaw`[\s\S]*"sellerRefundId" IS NULL[\s\S]*blockingRefundOrLatestOpenDisputeLedgerExistsSql/,
      );
    }

    assert.match(
      sellerRoute,
      /if \(orderHasRefundLedger\(orderForRefundState\)\)/,
    );
    assert.match(
      sellerRoute,
      /WHERE id = \$\{orderId\}[\s\S]*"sellerRefundId" IS NULL/s,
    );
    assert.match(caseRoute, /if \(orderHasRefundLedger\(caseRecord\.order\)\)/);
    assert.match(
      caseRoute,
      /WHERE id = \$\{caseRecord\.orderId\}[\s\S]*"sellerRefundId" IS NULL/s,
    );
  });

  it("keeps refund and label-purchase locks aligned", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");
    const labelRoute = source("src/app/api/orders/[id]/label/route.ts");

    for (const route of [sellerRoute, caseRoute]) {
      assert.match(route, /orderHasPurchasedLabel/);
      assert.match(
        route,
        /Cannot refund this order after a shipping label has been purchased/,
      );
      assert.match(
        route,
        /"labelStatus" IS NULL OR "labelStatus" != 'PURCHASED'::"LabelStatus"/,
      );
      assert.match(route, /labelStatus: true/);
    }

    assert.match(labelRoute, /"sellerRefundId" IS NULL/);
    assert.match(labelRoute, /"sellerRefundLockedAt" IS NULL/);
    assert.match(labelRoute, /SELECT 1 FROM "Case" c/);
    assert.match(labelRoute, /c\."status"::text IN \(\$\{Prisma\.join\(\[\.\.\.ACTIVE_CASE_STATUSES\]\)\}\)/);
    assert.match(labelRoute, /ope\."status" IS NULL/);
    assert.match(labelRoute, /lower\(ope\."status"\) NOT IN \(\$\{Prisma\.join\(NON_BLOCKING_REFUND_LEDGER_STATUSES\)\}\)/);
    assert.match(labelRoute, /latestOpenDisputeLedgerExistsSql/);
    assert.match(labelRoute, /latestOpenDisputeLedgerExistsSql\(Prisma\.sql`"Order"\.id`\)/);
  });

  it("allows seller partial refunds to restore only explicitly requested purchased stock", () => {
    const route = source("src/app/api/orders/[id]/refund/route.ts");
    const panel = source("src/components/SellerRefundPanel.tsx");
    const salesPage = source("src/app/dashboard/sales/[orderId]/page.tsx");

    assert.match(route, /restoreStock:\s*z\s*\.array/);
    assert.match(
      route,
      /requestedRefundStockRestoreQuantities\(\s*myItems,\s*requestedStockRestores,\s*\)/,
    );
    assert.match(route, /Full refunds restore eligible stock automatically/);
    assert.match(
      route,
      /Stock cannot be restored after this order has shipped or been picked up/,
    );
    assert.match(route, /: partialStockRestores/);
    assert.match(panel, /Restore inventory \(optional\)/);
    assert.match(
      panel,
      /restoreStock\.push\(\{ listingId: item\.listingId, quantity \}\)/,
    );
    assert.match(salesPage, /restorableRefundItems/);
    assert.match(salesPage, /canRestoreStock=\{canRestoreRefundStock\}/);
  });

  it("allows staff case partial refunds to restore only explicitly requested purchased stock", () => {
    const route = source("src/app/api/cases/[id]/resolve/route.ts");
    const panel = source("src/components/CaseResolutionPanel.tsx");
    const adminCasePage = source("src/app/admin/cases/[id]/page.tsx");

    assert.match(route, /restoreStock: z\.array/);
    assert.match(
      route,
      /resolution !== "REFUND_PARTIAL" && requestedStockRestores\.length > 0/,
    );
    assert.match(
      route,
      /requestedRefundStockRestoreQuantities\(\s*caseRecord\.order\.items,\s*requestedStockRestores,\s*\)/s,
    );
    assert.match(
      route,
      /Stock cannot be restored after this order has shipped or been picked up/,
    );
    assert.match(
      route,
      /resolution === "REFUND_PARTIAL"[\s\S]*\? partialStockRestores/,
    );
    assert.match(panel, /Restore inventory \(optional\)/);
    assert.match(
      panel,
      /restoreStock\.push\(\{ listingId: item\.listingId, quantity \}\)/,
    );
    assert.match(adminCasePage, /restorableRefundItems/);
    assert.match(adminCasePage, /canRestoreStock=\{canRestoreRefundStock\}/);
  });

  it("sanitizes Stripe webhook console error output before logging", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    assert.match(route, /sanitizeEmailOutboxError\(retrieveErr\)/);
    assert.match(route, /sanitizeEmailOutboxError\(err\)/);
    assert.doesNotMatch(
      route,
      /console\.error\("Webhook: failed to retrieve full event:", retrieveErr\)/,
    );
    assert.doesNotMatch(
      route,
      /console\.error\("Stripe webhook handler error:", err\)/,
    );
  });

  it("persists Stripe order emails to the outbox before any direct send", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    const enqueueIndex = route.indexOf(
      "enqueued = await enqueueEmailOutboxOnce",
    );
    const directSendIndex = route.indexOf("await sendRenderedEmail(email, {");

    assert.notEqual(enqueueIndex, -1);
    assert.notEqual(directSendIndex, -1);
    assert.ok(
      enqueueIndex < directSendIndex,
      "order emails must reserve the outbox dedup row before direct send",
    );
    assert.match(route, /throw outboxError/);
    assert.match(route, /status: "SENT"/);
    assert.match(
      route,
      /emailOutboxFailureState\(enqueued\.job\.attempts \+ 1\)/,
    );
    assert.match(route, /idempotencyKey: enqueued\.job\.dedupKey/);
  });

  it("skips post-payment side effects for refunded or blocked checkout orders", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    assert.match(route, /function orderPostPaymentSideEffectsBlocked/);
    assert.match(route, /orderHasRefundLedger\(order\)/);
    assert.match(route, /BLOCKED_CHECKOUT_REVIEW_MARKER/);
    assert.match(route, /sellerRefundId: true/);
    assert.match(route, /reviewNeeded: true/);
    assert.match(
      route,
      /if \(orderPostPaymentSideEffectsBlocked\(order\)\) return/,
    );
  });

  it("uses the refund sentinel lock before issuing automatic blocked-checkout refunds", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    assert.match(route, /sellerRefundId: REFUND_LOCK_SENTINEL/);
    assert.match(
      route,
      /await prisma\.\$executeRaw`[\s\S]*"sellerRefundId" IS NULL[\s\S]*blockingRefundOrLatestOpenDisputeLedgerExistsSql/,
    );
    assert.match(route, /createMarketplaceRefund\(\{/);
    assert.match(route, /scope: "blocked-checkout-refund"/);
    assert.match(route, /refundIdempotencyKeyBase\(\{/);
    assert.match(route, /Stripe refund status requires manual follow-up/);
    assert.doesNotMatch(route, /refund\s*=\s*await stripe\.refunds\.create/);
    assert.ok(
      route.indexOf('SET "sellerRefundId" = ${REFUND_LOCK_SENTINEL}') <
        route.indexOf("createMarketplaceRefund({"),
      "blocked-checkout refunds must acquire the local lock before the shared Stripe refund helper",
    );
    assert.match(
      route,
      /where: \{ id: input\.orderId, sellerRefundId: REFUND_LOCK_SENTINEL \}/,
    );
    assert.match(
      route,
      /Blocked checkout refund lock was no longer held while recording Stripe refund/,
    );
    assert.match(
      route,
      /stripe_webhook_blocked_checkout_refund_lock_release_failed/,
    );
  });

  it("does not tag ordinary staff case refunds as fraudulent Stripe refunds", () => {
    const route = source("src/app/api/cases/[id]/resolve/route.ts");
    const refundStart = route.indexOf("const refund = await createMarketplaceRefund({");
    const refundEnd = route.indexOf("});", refundStart);
    const refundCall = route.slice(refundStart, refundEnd);

    assert.ok(refundStart >= 0, "case resolution route must use the shared marketplace refund helper");
    assert.match(refundCall, /reason: "requested_by_customer"/);
    assert.doesNotMatch(refundCall, /fraudulent/);
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
    assert.match(
      route,
      /hasLabelUrl: Boolean\(purchasedLabelDetails\?\.labelUrl\)/,
    );
    assert.match(
      route,
      /hasTrackingNumber: Boolean\(purchasedLabelDetails\?\.trackingNumber\)/,
    );
    assert.doesNotMatch(
      route,
      /extra: \{ orderId: id, purchasedLabelDetails \}/,
    );
    assert.doesNotMatch(
      route,
      /source: "shippo_label_orphan_record_failed"[\s\S]*labelUrl: purchasedLabelDetails/s,
    );
  });

  it("captures best-effort checkout stock restoration failures", () => {
    const sellerCheckout = source("src/app/api/cart/checkout-seller/route.ts");
    const singleCheckout = source("src/app/api/cart/checkout/single/route.ts");

    assert.match(sellerCheckout, /logServerError\(err, \{/);
    assert.match(singleCheckout, /logServerError\(err, \{/);
    assert.match(sellerCheckout, /Server error creating checkout session/);
    assert.match(singleCheckout, /Server error creating checkout session/);
    assert.doesNotMatch(sellerCheckout, /err instanceof Error \? err\.message/);
    assert.doesNotMatch(singleCheckout, /err instanceof Error \? err\.message/);
    assert.doesNotMatch(
      sellerCheckout,
      /console\.error\("POST \/api\/cart\/checkout-seller error:", err\)/,
    );
    assert.doesNotMatch(
      singleCheckout,
      /console\.error\("POST \/api\/cart\/checkout\/single error:", err\)/,
    );
    assert.match(
      sellerCheckout,
      /source: "checkout_stock_restore_failed", route: "cart_checkout_seller"/,
    );
    assert.match(sellerCheckout, /CheckoutStockReservationStockError/);
    assert.match(sellerCheckout, /createCheckoutStockReservation/);
    assert.match(sellerCheckout, /reason: "checkout_create_error"/);
    assert.match(
      singleCheckout,
      /source: "checkout_stock_restore_failed", route: "cart_checkout_single"/,
    );
    assert.match(singleCheckout, /CheckoutStockReservationStockError/);
    assert.match(singleCheckout, /createCheckoutStockReservation/);
    assert.match(singleCheckout, /reason: "checkout_create_error"/);
    assert.doesNotMatch(sellerCheckout, /\.catch\(\(\) => \{\}\)/);
    assert.doesNotMatch(singleCheckout, /\.catch\(\(\) => \{\}\)/);
  });
});
