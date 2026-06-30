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

  it("keeps case resolution responses from being masked by notification or email failures", () => {
    const route = source("src/app/api/cases/[id]/resolve/route.ts");

    assert.match(route, /source: "case_resolved_notification"/);
    assert.match(route, /source: "case_resolved_email"/);
    assert.match(route, /notificationError/);
    assert.match(route, /buyerId: caseRecord\.buyerId/);
    assert.doesNotMatch(route, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("keeps case create and message responses from being masked by notification failures", () => {
    const createRoute = source("src/app/api/cases/route.ts");
    const messageRoute = source("src/app/api/cases/[id]/messages/route.ts");

    assert.match(createRoute, /source: "case_open_notification"/);
    assert.match(createRoute, /source: "case_open_email"/);
    assert.match(createRoute, /notificationError/);

    assert.match(messageRoute, /source: "case_staff_message_notification"/);
    assert.match(messageRoute, /source: "case_party_message_notification"/);
    assert.match(messageRoute, /source: "case_staff_message_email"/);
    assert.match(messageRoute, /source: "case_party_message_email"/);
    assert.match(messageRoute, /Promise\.all\(notifications\)/);

    for (const route of [createRoute, messageRoute]) {
      assert.doesNotMatch(route, /catch \{\s*\/\* non-fatal \*\/\s*\}/);
    }
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
    assert.match(route, /const caseUpdate = await tx\.case\.updateMany/);
    assert.match(route, /if \(caseUpdate\.count !== 1\)/);
    assert.match(route, /Case auto-resolution did not update because case state changed/);
  });

  it("records staff case refunds only while the refund lock is still held", () => {
    const route = source("src/app/api/cases/[id]/resolve/route.ts");

    assert.match(
      route,
      /sellerProfile: \{ select: \{ id: true \} \}/,
    );
    assert.match(route, /canReverseTransfer: Boolean\(caseRecord\.order\.stripeTransferId\)/);
    assert.doesNotMatch(route, /Boolean\(caseRecord\.seller\.sellerProfile\?\.stripeAccountId\)/);
    assert.match(route, /refundMayRestoreStock\(caseRecord\.order\)/);
    assert.match(
      route,
      /tx\.order\.updateMany\(\{\s*where: \{ id: caseRecord\.orderId, sellerRefundId: REFUND_LOCK_SENTINEL \}/s,
    );
    assert.match(route, /if \(orderUpdate\.count !== 1\)/);
    assert.match(route, /CASE_REFUND_LOCK_LOST/);
    assert.match(route, /manualStripeReconciliationNeeded: true/);
  });

  it("keeps seller and case orphan refund markers retryable until local state is durable", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");

    const sellerOrphanStart = sellerRoute.indexOf('source: "seller_refund_orphan_record_failed"');
    assert.ok(sellerOrphanStart > 0, "seller refund orphan marker failures should be observable");
    const sellerOrphanBlock = sellerRoute.slice(
      sellerRoute.lastIndexOf("try {", sellerOrphanStart),
      sellerRoute.indexOf("} else {", sellerOrphanStart),
    );
    assert.match(sellerOrphanBlock, /await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(sellerOrphanBlock, /const orphanRecord = await tx\.order\.updateMany/);
    assert.match(sellerOrphanBlock, /where: \{ id: orderId, sellerRefundId: REFUND_LOCK_SENTINEL \}/);
    assert.match(sellerOrphanBlock, /if \(orphanRecord\.count !== 1\)/);
    assert.match(sellerOrphanBlock, /Seller refund orphan record was not written/);
    assert.match(sellerOrphanBlock, /recordLocalRefundEvidence\(tx, \{/);
    assert.match(sellerOrphanBlock, /action: "SELLER_REFUND_RECORDED"/);
    assert.match(sellerOrphanBlock, /orphanRecovery: true/);
    assert.match(sellerOrphanBlock, /Sentry\.captureException\(dbError/);
    assert.match(sellerOrphanBlock, /throw dbError/);

    const caseOrphanStart = caseRoute.indexOf('source: "case_refund_orphaned_review_update_failed"');
    assert.ok(caseOrphanStart > 0, "case refund orphan marker failures should be observable");
    const caseOrphanBlock = caseRoute.slice(
      caseRoute.lastIndexOf("try {", caseOrphanStart),
      caseRoute.indexOf("} else if (refunding)", caseOrphanStart),
    );
    assert.match(caseOrphanBlock, /await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(caseOrphanBlock, /const orphanRecord = await tx\.order\.updateMany/);
    assert.match(caseOrphanBlock, /where: \{ id: caseRecord\.orderId, sellerRefundId: REFUND_LOCK_SENTINEL \}/);
    assert.match(caseOrphanBlock, /if \(orphanRecord\.count !== 1\)/);
    assert.match(caseOrphanBlock, /Case refund orphan record was not written/);
    assert.match(caseOrphanBlock, /recordLocalRefundEvidence\(tx, \{/);
    assert.match(caseOrphanBlock, /action: "CASE_REFUND_RECORDED"/);
    assert.match(caseOrphanBlock, /orphanRecovery: true/);
    assert.match(caseOrphanBlock, /Case refund orphan amount was unavailable/);
    assert.match(caseOrphanBlock, /Sentry\.captureException\(reviewUpdateError/);
    assert.match(caseOrphanBlock, /throw reviewUpdateError/);
  });

  it("marks no-refund-id Stripe failures as ambiguous instead of reopening refund attempts", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");

    assert.match(sellerRoute, /REFUND_AMBIGUOUS_SENTINEL/);
    assert.match(sellerRoute, /seller_refund_ambiguous_record_failed/);
    assert.match(sellerRoute, /ambiguous Stripe outcome/);
    assert.doesNotMatch(sellerRoute, /source: "seller_refund_lock_release_failed"/);

    assert.match(caseRoute, /REFUND_AMBIGUOUS_SENTINEL/);
    assert.match(caseRoute, /case_refund_ambiguous_record_failed/);
    assert.match(caseRoute, /ambiguous Stripe outcome/);
  });

  it("derives first-party refund reversal eligibility from the order transfer", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");

    assert.match(sellerRoute, /canReverseTransfer: Boolean\(order\.stripeTransferId\)/);
    assert.match(caseRoute, /canReverseTransfer: Boolean\(caseRecord\.order\.stripeTransferId\)/);

    assert.doesNotMatch(sellerRoute, /stripeAccountId: true/);
    assert.doesNotMatch(sellerRoute, /Boolean\(seller\.stripeAccountId\)/);
    assert.doesNotMatch(caseRoute, /stripeAccountId: true/);
    assert.doesNotMatch(caseRoute, /Boolean\(caseRecord\.seller\.sellerProfile\?\.stripeAccountId\)/);
  });

  it("records transfer-reversal accounting evidence for first-party refunds", () => {
    const helper = source("src/lib/marketplaceRefunds.ts");
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");
    const webhookRoute = source("src/app/api/stripe/webhook/route.ts");

    assert.match(helper, /expand: \["transfer_reversal"\]/);
    assert.match(helper, /transferReversalId/);
    assert.match(helper, /transferReversalAmountCents/);
    assert.match(helper, /platformFundedRefundCents/);
    assert.match(helper, /originalTransferAmountCents/);

    for (const route of [sellerRoute, caseRoute, webhookRoute]) {
      assert.match(route, /let refundAccountingEvidence: Prisma\.InputJsonObject \| null = null/);
      assert.match(route, /refundAccountingEvidence = refund\.accountingEvidence/);
      assert.match(route, /refundAccounting: (?:refund\.accountingEvidence|refundAccountingEvidence)/);
      assert.ok(
        (route.match(/refundAccounting:/g) ?? []).length >= 2,
        "normal and orphan refund evidence paths should include refundAccounting metadata",
      );
    }
  });

  it("serializes staff case refunds and dismissals before Stripe moves money", () => {
    const route = source("src/app/api/cases/[id]/resolve/route.ts");

    const refundLockStart = route.indexOf('SET "sellerRefundId" = ${REFUND_LOCK_SENTINEL}');
    const caseRecheckStart = route.indexOf("const caseStatusBeforeRefund = await prisma.case.findUnique");
    const stripeRefundStart = route.indexOf("const refund = await createMarketplaceRefund({");
    assert.ok(refundLockStart >= 0, "case refunds must acquire the order refund sentinel");
    assert.ok(caseRecheckStart > refundLockStart, "case status should be rechecked after the refund sentinel is held");
    assert.ok(stripeRefundStart > caseRecheckStart, "Stripe refunds should happen only after the post-lock case recheck");
    assert.match(route, /Case status changed before this refund could be issued/);

    const caseWriteStart = route.indexOf("const caseWrite = await prisma.$transaction");
    const nonRefundGuardStart = route.indexOf("const orderResolutionGuard = await tx.order.updateMany", caseWriteStart);
    const caseUpdateStart = route.indexOf("const caseUpdate = await tx.case.updateMany", caseWriteStart);
    assert.ok(nonRefundGuardStart > caseWriteStart, "non-refund case resolutions should check order refund state");
    assert.ok(caseUpdateStart > nonRefundGuardStart, "non-refund case resolution guard should run before the case update");
    assert.match(route, /sellerRefundId: \{ not: REFUND_LOCK_SENTINEL \}/);
    assert.match(route, /CASE_RESOLUTION_REFUND_IN_PROGRESS/);
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

  it("co-writes local refund ledger and system audit evidence for first-party refunds", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");
    const webhookRoute = source("src/app/api/stripe/webhook/route.ts");
    const helper = source("src/lib/localRefundEvidence.ts");

    assert.match(helper, /client\.orderPaymentEvent\.createMany/);
    assert.match(helper, /skipDuplicates: true/);
    assert.match(helper, /if \(ledgerWrite\.count === 0\) return/);
    assert.match(helper, /eventType: "REFUND"/);
    assert.match(helper, /logSystemActionOrThrow/);
    assert.match(helper, /localRefundEvidenceEventId\(action, refundId\)/);

    for (const [route, action] of [
      [sellerRoute, "SELLER_REFUND_RECORDED"],
      [caseRoute, "CASE_REFUND_RECORDED"],
      [webhookRoute, "BLOCKED_CHECKOUT_REFUND_RECORDED"],
    ]) {
      assert.match(route, /recordLocalRefundEvidence\(tx, \{/);
      assert.match(route, new RegExp(`action: "${action}"`));
    }

    assert.ok(
      sellerRoute.indexOf("const refundWrite = await prisma.$transaction") <
        sellerRoute.indexOf('action: "SELLER_REFUND_RECORDED"'),
      "seller refund evidence should be recorded in the final transaction",
    );
    assert.ok(
      caseRoute.indexOf("const caseWrite = await prisma.$transaction") <
        caseRoute.indexOf('action: "CASE_REFUND_RECORDED"'),
      "case refund evidence should be recorded in the final transaction",
    );
    assert.ok(
      webhookRoute.indexOf("const stockStatusRestoredCount = await prisma.$transaction") <
        webhookRoute.indexOf('action: "BLOCKED_CHECKOUT_REFUND_RECORDED"'),
      "blocked-checkout refund evidence should be recorded in the final transaction",
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
    assert.match(labelRoute, /releaseStaleRefundLocks\(id\)/);
    assert.match(labelRoute, /staleLocksReleased\.count > 0/);
    assert.ok(
      labelRoute.indexOf("releaseStaleRefundLocks(id)") <
        labelRoute.indexOf("if (order.labelStatus ==="),
      "label route should release stale refund locks before label/refund guards",
    );
    assert.match(labelRoute, /SELECT 1 FROM "Case" c/);
    assert.match(labelRoute, /c\."status"::text IN \(\$\{Prisma\.join\(\[\.\.\.ACTIVE_CASE_STATUSES\]\)\}\)/);
    assert.match(labelRoute, /ope\."status" IS NULL/);
    assert.match(labelRoute, /lower\(ope\."status"\) NOT IN \(\$\{Prisma\.join\(NON_BLOCKING_REFUND_LEDGER_STATUSES\)\}\)/);
    assert.match(labelRoute, /latestOpenDisputeLedgerExistsSql/);
    assert.match(labelRoute, /latestOpenDisputeLedgerExistsSql\(Prisma\.sql`"Order"\.id`\)/);
  });

  it("blocks fulfillment state changes on latest open Stripe dispute ledgers", () => {
    const route = source("src/app/api/orders/[id]/fulfillment/route.ts");

    assert.match(route, /latestOpenDisputeLedgerExistsSql/);
    assert.match(route, /SELECT \$\{latestOpenDisputeLedgerExistsSql\(Prisma\.sql`\$\{id\}`\)\} AS "hasOpenDispute"/);
    assert.match(route, /Resolve the open Stripe dispute before changing fulfillment/);
    assert.match(route, /UPDATE "Order"[\s\S]*blockingRefundLedgerExistsSql\(Prisma\.sql`"Order"\.id`\)[\s\S]*latestOpenDisputeLedgerExistsSql\(Prisma\.sql`"Order"\.id`\)/);
    assert.match(route, /"fulfillmentStatus"::text IN \(\$\{Prisma\.join\(allowed\)\}\)/);
    assert.doesNotMatch(route, /id:\s*\{\s*in: Prisma\.sql/);
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
    const v2Route = source("src/app/api/stripe/webhook/v2/route.ts");

    assert.match(route, /sanitizeEmailOutboxError\(retrieveErr\)/);
    assert.match(route, /sanitizeEmailOutboxError\(err\)/);
    assert.match(v2Route, /sanitizeEmailOutboxError\(err\)/);
    assert.doesNotMatch(
      route,
      /console\.error\("Webhook: failed to retrieve full event:", retrieveErr\)/,
    );
    assert.doesNotMatch(
      route,
      /console\.error\("Stripe webhook handler error:", err\)/,
    );
    assert.doesNotMatch(
      route,
      /console\.error\("Stripe webhook signature verification failed:", \(err as \{ message\?: string \}\)\?\.message\)/,
    );
    assert.doesNotMatch(
      v2Route,
      /console\.error\("Stripe v2 webhook signature verification failed:", \(err as \{ message\?: string \}\)\?\.message\)/,
    );
  });

  it("sanitizes label clawback Stripe errors before console logging", () => {
    const route = source("src/app/api/orders/[id]/label/route.ts");

    assert.match(route, /labelClawbackErrorMessage\(stripeErr\)/);
    assert.doesNotMatch(
      route,
      /console\.warn\(\s*`Stripe label cost clawback failed for order \$\{id\}:`,\s*stripeErr,?\s*\)/,
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
    assert.match(route, /function blockedCheckoutReviewPrefix/);
    assert.match(route, /function blockedCheckoutReviewReason/);
    assert.match(route, /function blockedCheckoutRefundRetryReason/);
    assert.match(route, /function blockedCheckoutRefundStillInProgress/);
    assert.match(route, /orderHasRefundLedger\(order\)/);
    assert.match(route, /BLOCKED_CHECKOUT_REVIEW_MARKER/);
    assert.match(route, /sellerRefundId: true/);
    assert.match(route, /sellerRefundLockedAt: true/);
    assert.match(route, /reviewNeeded: true/);
    assert.match(
      route,
      /if \(orderPostPaymentSideEffectsBlocked\(order\)\) return/,
    );
    const existingOrderBranch = route.slice(
      route.indexOf("const already = await prisma.order.findFirst"),
      route.indexOf("// Retrieve with expansions"),
    );
    assert.match(existingOrderBranch, /reviewNeeded: true/);
    assert.match(existingOrderBranch, /reviewNote: true/);
    assert.match(existingOrderBranch, /blockingRefundLedgerWhere\(\)/);
    assert.match(existingOrderBranch, /const retryReason = blockedCheckoutRefundRetryReason\(already\)/);
    assert.match(existingOrderBranch, /buyerId: already\.buyerId/);
    assert.match(existingOrderBranch, /sellerUserIds: \[/);
    assert.match(existingOrderBranch, /blockedCheckoutRefundStillInProgress\(already\)/);
    assert.match(existingOrderBranch, /throw new Error\("Blocked checkout automatic refund is still in progress\."\)/);
    assert.match(existingOrderBranch, /if \(!orderPostPaymentSideEffectsBlocked\(already\)\) \{/);
    assert.ok(
      existingOrderBranch.indexOf("orderPostPaymentSideEffectsBlocked(already)") <
        existingOrderBranch.indexOf("enqueueOrderPostPaymentSideEffects(already.id"),
      "existing-order retries must block side effects for marked blocked checkouts",
    );
    assert.ok(
      route.indexOf("blockedCheckoutRefundRetryReason(already)") <
        route.indexOf("stripe.checkout.sessions.retrieve"),
      "existing blocked-checkout retries should be detected before retrieving Stripe session details",
    );
    const existingRetryBranch = route.slice(
      route.indexOf("if (existingBlockedCheckoutRetry)"),
      route.indexOf("// CART CHECKOUT"),
    );
    assert.match(existingRetryBranch, /await releaseCheckoutLock\(checkoutLockKey, sessionId\)/);
    assert.match(existingRetryBranch, /await refundBlockedCheckout\(\{/);
    assert.match(existingRetryBranch, /reason: existingBlockedCheckoutRetry\.retryReason/);
    assert.match(existingRetryBranch, /lineItems: checkoutLineItems/);
    assert.match(existingRetryBranch, /return NextResponse\.json\(\{ ok: true \}\)/);
    assert.match(route, /reviewNote: cartInvalidState\.reason[\s\S]*blockedCheckoutReviewPrefix\(cartInvalidState\.reason\)/);
    assert.match(route, /reviewNote: singleInvalidState\.reason[\s\S]*blockedCheckoutReviewPrefix\(singleInvalidState\.reason\)/);
    assert.match(route, /const reviewPrefix = blockedCheckoutReviewPrefix\(input\.reason\)/);

    const cartInvalidBranch = route.slice(
      route.indexOf("if (createdCartOrder.invalidReason)"),
      route.indexOf("await enqueueOrderPostPaymentSideEffects(createdCartOrder.id"),
    );
    const singleInvalidBranch = route.slice(
      route.indexOf("if (createdSingleOrder.invalidReason)"),
      route.indexOf("await enqueueOrderPostPaymentSideEffects(createdSingleOrder.id"),
    );
    assert.match(cartInvalidBranch, /await refundBlockedCheckout\(\{/);
    assert.match(cartInvalidBranch, /return NextResponse\.json\(\{ ok: true \}\)/);
    assert.match(singleInvalidBranch, /await refundBlockedCheckout\(\{/);
    assert.match(singleInvalidBranch, /return NextResponse\.json\(\{ ok: true \}\)/);
  });

  it("uses the refund sentinel lock before issuing automatic blocked-checkout refunds", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    assert.match(route, /sellerRefundId: REFUND_LOCK_SENTINEL/);
    assert.match(route, /releaseStaleRefundLocks\(input\.orderId\)/);
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
      /stripe_webhook_blocked_checkout_refund_ambiguous_record_failed/,
    );
  });

  it("keeps blocked-checkout refund recovery retryable until local state is durable", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");
    const notificationSource = 'source: "stripe_webhook_blocked_checkout_refund_notification"';
    const orphanedSource = 'source: "stripe_webhook_blocked_checkout_orphaned_after_stripe"';
    const orphanRecordSource = 'source: "stripe_webhook_blocked_checkout_orphan_record_failed"';
    const lockReleaseSource = 'source: "stripe_webhook_blocked_checkout_refund_ambiguous_record_failed"';

    const notificationStart = route.indexOf(notificationSource);
    const orphanedStart = route.indexOf(orphanedSource);
    assert.ok(notificationStart > 0, "blocked-checkout refund notification failures should be observable");
    assert.ok(orphanedStart > notificationStart, "notification failure handling should not enter the refund-orphan catch");

    const notificationBlock = route.slice(
      route.lastIndexOf("if (input.buyerUserId)", notificationStart),
      orphanedStart,
    );
    assert.match(notificationBlock, /try \{[\s\S]*await createNotification\(\{/);
    assert.match(notificationBlock, /catch \(notificationError\)/);

    const orphanRecordStart = route.indexOf(orphanRecordSource);
    const orphanRecordBlock = route.slice(
      route.lastIndexOf("try {", orphanRecordStart),
      route.indexOf("} else {", orphanRecordStart),
    );
    assert.match(orphanRecordBlock, /await prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(orphanRecordBlock, /const orphanRecord = await tx\.order\.updateMany/);
    assert.match(orphanRecordBlock, /if \(orphanRecord\.count !== 1\)/);
    assert.match(orphanRecordBlock, /Blocked checkout orphan refund record was not written/);
    assert.match(orphanRecordBlock, /recordLocalRefundEvidence\(tx, \{/);
    assert.match(orphanRecordBlock, /action: "BLOCKED_CHECKOUT_REFUND_RECORDED"/);
    assert.match(orphanRecordBlock, /orphanRecovery: true/);
    assert.match(orphanRecordBlock, /Blocked checkout orphan refund amount was unavailable/);
    assert.match(orphanRecordBlock, /Sentry\.captureException\(dbError/);
    assert.match(orphanRecordBlock, /throw dbError/);

    const lockReleaseStart = route.indexOf(lockReleaseSource);
    const noRefundIdBranch = route.slice(
      route.lastIndexOf("} else {", lockReleaseStart),
      route.indexOf("} catch (refundError) {", lockReleaseStart),
    );
    const lockReleaseBlock = route.slice(
      route.lastIndexOf("try {", lockReleaseStart),
      route.indexOf("Sentry.captureException(refundError", lockReleaseStart),
    );
    assert.match(lockReleaseBlock, /Sentry\.captureException\(dbError/);
    assert.match(lockReleaseBlock, /throw dbError/);
    assert.match(lockReleaseBlock, /sellerRefundId: REFUND_AMBIGUOUS_SENTINEL/);
    assert.match(lockReleaseBlock, /ambiguous Stripe outcome/);
    assert.match(noRefundIdBranch, /retryBlockedCheckoutRefund = true/);
    assert.match(noRefundIdBranch, /throw refundError/);

    const outerCatch = route.slice(
      route.indexOf("} catch (refundError) {", lockReleaseStart),
      route.indexOf("await prisma.order.update({", lockReleaseStart),
    );
    assert.match(outerCatch, /if \(refundId \|\| retryBlockedCheckoutRefund\) \{\s*throw refundError;\s*\}/);
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

  it("keeps Stripe dispute case promotion retryable on stale case status", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");
    const disputeBranch = route.slice(
      route.indexOf("if (STRIPE_DISPUTE_EVENT_TYPES.has(event.type))"),
      route.indexOf('if (event.type === "payout.failed")'),
    );

    assert.match(disputeBranch, /const caseUpdate = await tx\.case\.updateMany/);
    assert.match(disputeBranch, /where: \{ id: caseAction\.caseId, status: caseAction\.expectedStatus \}/);
    assert.match(disputeBranch, /if \(caseUpdate\.count !== 1\)/);
    assert.match(disputeBranch, /throw new Error\("STRIPE_DISPUTE_CASE_UPDATE_CONFLICT"\)/);
  });

  it("deduplicates seller dispute notifications across webhook retries", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");
    const disputeNotificationStart = route.indexOf('type: "PAYMENT_DISPUTE"');
    assert.ok(disputeNotificationStart > 0, "Stripe dispute branch should notify the seller");
    const disputeNotification = route.slice(
      disputeNotificationStart,
      route.indexOf("});", disputeNotificationStart),
    );

    assert.match(disputeNotification, /dedupScope: `stripe-dispute:\$\{dispute\.id \?\? event\.id\}:created`/);
  });

  it("fails paid checkout webhooks instead of creating partial or unrouted orders", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");

    const partialResolutionStart = route.indexOf("stripe_webhook_cart_partial_line_item_resolution");
    const orderCreateStart = route.indexOf("const order = await tx.order.create", partialResolutionStart);
    assert.ok(partialResolutionStart > 0, "cart checkout must guard partial paid line resolution");
    assert.ok(orderCreateStart > partialResolutionStart, "partial paid line guard must run before order creation");
    assert.match(
      route,
      /if \(checkoutItems\.length !== paidItems\.length\) \{[\s\S]*throw new Error\("Paid cart checkout could not resolve all listing records"\);[\s\S]*\}/,
    );

    const metadataStart = route.indexOf("Stripe checkout completion missing routing metadata");
    const metadataBranch = route.slice(metadataStart, route.indexOf("}, async () => {", metadataStart));
    assert.match(metadataBranch, /level: "error"/);
    assert.match(metadataBranch, /throw new Error\("Stripe checkout completion missing routing metadata"\)/);
    assert.doesNotMatch(metadataBranch, /return NextResponse\.json\(\{ ok: true \}\)/);
  });

  it("keeps shipping-label orphan paths observable without full label URLs", () => {
    const route = source("src/app/api/orders/[id]/label/route.ts");
    const labelClawback = source("src/lib/labelClawbackRetry.ts");

    assert.match(route, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/);
    assert.match(route, /sanitizeShippoProviderErrorBody/);
    assert.match(route, /status: HTTP_STATUS\.ACCEPTED/);
    assert.match(route, /status: HTTP_STATUS\.BAD_GATEWAY/);
    assert.match(route, /source: "label_lock_revert_failed"/);
    assert.match(route, /source: "shippo_label_purchase_ambiguous"/);
    assert.match(route, /source: "shippo_label_ambiguous_record_failed"/);
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
    assert.doesNotMatch(route, /Shippo label purchase failed: \$\{msgs/);
    const ambiguousStart = route.indexOf("source: \"shippo_label_purchase_ambiguous\"");
    const orphanStart = route.indexOf("source: \"shippo_label_post_purchase_db_update\"", ambiguousStart);
    const ambiguousBlock = route.slice(ambiguousStart, orphanStart);
    assert.ok(ambiguousStart >= 0, "ambiguous Shippo label branch must be present");
    assert.ok(orphanStart > ambiguousStart, "orphan label branch must follow ambiguous branch");
    assert.match(ambiguousBlock, /AMBIGUOUS LABEL/);
    assert.doesNotMatch(ambiguousBlock, /revertLabelLock\(\)/);
    const orphanBlock = route.slice(orphanStart, route.indexOf(".catch((updateError)", orphanStart));
    assert.match(orphanBlock, /order\.stripeTransferId/);
    assert.match(orphanBlock, /labelStatus: "PURCHASED"/);
    assert.match(orphanBlock, /labelPurchasedAt: orphanRecordedAt/);
    assert.match(orphanBlock, /fulfillmentStatus: "SHIPPED"/);
    assert.match(orphanBlock, /shippedAt: orphanRecordedAt/);
    assert.match(orphanBlock, /labelClawbackReversalAccepted/);
    assert.match(orphanBlock, /labelClawbackStatus: "REVERSED"/);
    assert.match(orphanBlock, /labelClawbackReversalId: acceptedLabelClawbackReversalId/);
    assert.match(orphanBlock, /labelClawbackStatus: "RETRY_PENDING"/);
    assert.match(orphanBlock, /labelClawbackNextAttemptAt: orphanRecordedAt/);
    assert.match(orphanBlock, /labelClawbackStatus: "MANUAL_REVIEW"/);
    assert.doesNotMatch(route, /order:\s*updated/);
    assert.match(route, /order: labelPurchaseOrderResponse\(updated\)/);
    assert.match(route, /select: labelClawbackOrderSelect/);
    assert.match(labelClawback, /export const labelClawbackOrderSelect/);
    assert.match(labelClawback, /select: labelClawbackOrderSelect/);
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
