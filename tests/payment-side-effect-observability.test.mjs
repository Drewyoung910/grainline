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
    assert.match(route, /buyerId: finalized\.buyerUserId/);
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
    const authority = source(
      "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
    );

    assert.match(route, /claimSellerOrderRefund\(\{/);
    assert.match(route, /recordSellerOrderRefund\(\{/);
    assert.match(route, /\.\.\.activeOrderRefundClaimWhere\(refundClaim\)/);
    assert.match(authority, /orders\."refundClaimGeneration" = p_claim_generation/);
    assert.match(authority, /"refundClaimProviderAuthorizedAt" IS NULL/);
    assert.match(authority, /"manualStripeReconciliationNeeded" = true/);
    assert.match(authority, /grainline_case_seller_refund_apply/);
    assert.match(authority, /IF case_action = 'terminal' THEN/);
    assert.match(authority, /Case auto-resolution did not update because Case state changed/);
    assert.doesNotMatch(route, /(?:prisma|tx)\.case\./);
  });

  it("records staff case refunds only while the refund lock is still held", () => {
    const route = source("src/app/api/cases/[id]/resolve/route.ts");
    const authority = source(
      "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
    );

    assert.match(route, /canReverseTransfer: prepared\.canReverseTransfer/);
    assert.doesNotMatch(route, /refundMayRestoreStock/);
    assert.match(authority, /"caseResolutionClaimId" = claim_id/);
    assert.match(authority, /"sellerRefundId" = CASE/);
    assert.match(authority, /ELSE 'pending'/);
    assert.match(
      authority,
      /WHERE orders\.id = locked_order\.id[\s\S]*orders\."sellerRefundId" IS NULL/,
    );
    assert.match(
      authority,
      /locked_order\."caseResolutionClaimId"[\s\S]*IS DISTINCT FROM locked_claim\.id/,
    );
    assert.match(
      authority,
      /locked_order\."sellerRefundId" IS DISTINCT FROM 'pending'/,
    );
    assert.match(authority, /Case staff-resolution lease acquisition failed/);
    assert.match(authority, /Case provider-record refund lease was lost/);
    assert.doesNotMatch(route, /Boolean\(caseRecord\.order\.stripeTransferId\)/);
  });

  it("keeps seller and case provider results retryable until local state is durable", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");

    assert.match(sellerRoute, /source: "seller_refund_finalize_retry"/);
    assert.match(sellerRoute, /source: "seller_refund_finalize_retry_failed"/);
    assert.ok(
      (sellerRoute.match(/recordSellerOrderRefund\(\{/g) ?? []).length >= 2,
      "seller provider evidence must retry through the same fixed finalizer",
    );
    assert.doesNotMatch(sellerRoute, /orphanRecovery|orphanRecord|recordLocalRefundEvidence/);

    assert.match(caseRoute, /source: "case_refund_provider_record_failed"/);
    assert.match(
      caseRoute,
      /await recordCaseStaffResolutionProvider\([\s\S]*refund\.primaryRefundId[\s\S]*refund\.refundIds/,
    );
    assert.match(
      caseRoute,
      /authorityFailureResponse\(error, "provider"\)[\s\S]*throw error/,
    );
    assert.doesNotMatch(caseRoute, /case_refund_orphaned_review_update_failed/);
  });

  it("marks no-refund-id Stripe failures as ambiguous instead of reopening refund attempts", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");

    assert.match(sellerRoute, /REFUND_AMBIGUOUS_SENTINEL/);
    assert.match(sellerRoute, /seller_refund_ambiguous_record_failed/);
    assert.match(sellerRoute, /ambiguous Stripe outcome/);
    assert.match(sellerRoute, /ambiguousRecord\.count !== 1/);
    assert.match(
      sellerRoute,
      /Seller refund ambiguous outcome was not recorded against the active generation/,
    );
    assert.doesNotMatch(sellerRoute, /source: "seller_refund_lock_release_failed"/);

    assert.match(caseRoute, /case_refund_ambiguous_record_failed/);
    assert.match(
      caseRoute,
      /catch \(stripeError\)[\s\S]*recordAmbiguousCaseStaffResolutionProvider\([\s\S]*throw stripeError/,
    );
    assert.match(
      source(
        "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
      ),
      /'RECONCILIATION_REQUIRED'::public\."CaseResolutionClaimStatus"/,
    );
    assert.match(
      source(
        "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
      ),
      /Ambiguous provider outcome cannot assert evidence/,
    );
  });

  it("derives first-party refund reversal eligibility from the order transfer", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");
    const sellerAuthority = source(
      "prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql",
    );

    assert.match(sellerRoute, /canReverseTransfer: refundClaim\.canReverseTransfer/);
    assert.match(
      sellerAuthority,
      /'canReverseTransfer', locked_order\."stripeTransferId" IS NOT NULL/,
    );
    assert.match(caseRoute, /canReverseTransfer: prepared\.canReverseTransfer/);
    assert.match(
      source(
        "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
      ),
      /'canReverseTransfer', locked_order\."stripeTransferId" IS NOT NULL/,
    );

    assert.doesNotMatch(sellerRoute, /stripeAccountId: true/);
    assert.doesNotMatch(sellerRoute, /Boolean\(seller\.stripeAccountId\)/);
    assert.doesNotMatch(caseRoute, /stripeAccountId: true/);
    assert.doesNotMatch(caseRoute, /Boolean\(caseRecord\.order\.stripeTransferId\)/);
  });

  it("records transfer-reversal accounting evidence for first-party refunds", () => {
    const helper = source("src/lib/marketplaceRefunds.ts");
    const recordHelper = source("src/lib/orderRefundRecordAuthority.ts");
    const recordAuthority = source(
      "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
    );
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");
    const webhookRoute = source("src/app/api/stripe/webhook/route.ts");

    assert.match(helper, /expand: \["transfer_reversal"\]/);
    assert.match(helper, /transferReversalId/);
    assert.match(helper, /transferReversalAmountCents/);
    assert.match(helper, /platformFundedRefundCents/);
    assert.match(helper, /originalTransferAmountCents/);

    for (const route of [sellerRoute, webhookRoute]) {
      assert.match(route, /orderRefundProviderEvidence\(refund\)/);
    }
    assert.match(recordHelper, /accounting\.transferReversalId/);
    assert.match(recordHelper, /accounting\.transferReversalAmountCents/);
    assert.match(recordAuthority, /'transferReversalId', p_transfer_reversal_id/);
    assert.match(
      recordAuthority,
      /'transferReversalAmountCents', p_transfer_reversal_amount_cents/,
    );
    assert.match(recordAuthority, /'platformFundedRefundCents', platform_funded_refund_cents/);
    assert.match(
      caseRoute,
      /transferReversalId:\s*refund\.accountingEvidence\.transferReversalId/,
    );
    assert.match(
      caseRoute,
      /transferReversalAmountCents:\s*refund\.accountingEvidence\.transferReversalAmountCents/,
    );
    const caseAuthority = source(
      "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
    );
    assert.match(caseAuthority, /'transferReversalId', p_transfer_reversal_id/);
    assert.match(
      caseAuthority,
      /'transferReversalAmountCents',\s*p_transfer_reversal_amount_cents/,
    );
  });

  it("serializes staff case refunds and dismissals before Stripe moves money", () => {
    const route = source("src/app/api/cases/[id]/resolve/route.ts");
    const authority = source(
      "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
    ).replace(/\s+/g, " ");
    const prepareStart = route.indexOf("await prepareCaseStaffResolution(");
    const stripeStart = route.indexOf("await createMarketplaceRefund(");
    const finalizeStart = route.indexOf("await finalizeCaseStaffResolution(");

    assert.ok(prepareStart >= 0 && stripeStart > prepareStart);
    assert.ok(finalizeStart > stripeStart);
    assert.match(
      authority,
      /FROM public\."Order" AS orders WHERE orders\.id = source_order_id FOR UPDATE[\s\S]*FROM public\."Case" AS case_row[\s\S]*FOR UPDATE/,
    );
    assert.match(
      authority,
      /orders\."caseResolutionClaimId" IS NULL[\s\S]*orders\."sellerRefundId" IS NULL[\s\S]*orders\."sellerRefundLockedAt" IS NULL/,
    );
    assert.match(
      authority,
      /Case staff-resolution Order has refund activity/,
    );
    assert.doesNotMatch(route, /prisma\.\$transaction/);
  });

  it("keeps seller and staff refund entrypoints single-refund per order", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");
    const sellerAuthority = source(
      "prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql",
    );

    assert.match(sellerRoute, /blockingRefundLedgerWhere/);
    assert.match(sellerRoute, /latestOpenDisputeLedgerExistsSql/);
    assert.doesNotMatch(sellerRoute, /blockingRefundOrDisputeLedgerWhere/);
    assert.match(sellerRoute, /sellerRefundConflictResponse/);
    assert.match(sellerRoute, /orderHasRefundLedger/);
    assert.match(sellerRoute, /claimSellerOrderRefund\(\{/);
    assert.doesNotMatch(sellerRoute, /\.\$executeRaw`[\s\S]*SET "sellerRefundId"/);

    assert.match(
      sellerRoute,
      /if \(orderHasRefundLedger\(orderForRefundState\)\)/,
    );
    assert.match(
      sellerAuthority,
      /FROM public\."Order" AS orders[\s\S]*FOR UPDATE[\s\S]*locked_order\."sellerRefundId" IS NOT NULL/,
    );
    assert.match(sellerAuthority, /payment_event\."eventType" = 'REFUND'/);
    assert.match(sellerAuthority, /latest_dispute/);
    assert.match(
      sellerAuthority,
      /WHERE orders\.id = locked_order\.id[\s\S]*orders\."sellerRefundId" IS NULL[\s\S]*orders\."refundClaimId" IS NULL/,
    );
    assert.doesNotMatch(caseRoute, /blockingRefundLedgerWhere/);
    assert.doesNotMatch(caseRoute, /sellerRefundConflictResponse/);
    assert.doesNotMatch(caseRoute, /orderHasRefundLedger/);
    const caseAuthority = source(
      "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
    );
    assert.match(
      caseAuthority,
      /WHERE orders\.id = locked_order\.id[\s\S]*orders\."sellerRefundId" IS NULL[\s\S]*Case staff-resolution lease acquisition failed/,
    );
    assert.match(
      caseAuthority,
      /FROM public\."OrderPaymentEvent" AS refund_event[\s\S]*refund_event\."eventType" = 'REFUND'/,
    );
  });

  it("co-writes local refund ledger and system audit evidence for first-party refunds", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");
    const webhookRoute = source("src/app/api/stripe/webhook/route.ts");
    const helper = source("src/lib/localRefundEvidence.ts");
    const helperCore = source("src/lib/localRefundEvidenceCore.ts");
    const refundAuthority = source(
      "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
    );

    assert.match(helper, /client\.orderPaymentEvent\.createMany/);
    assert.match(helper, /buildLocalRefundEvidenceRecords\(input\)/);
    assert.match(helper, /skipDuplicates: true/);
    assert.match(helper, /if \(ledgerWrite\.count === 0\) return/);
    assert.match(helper, /logSystemActionOrThrow/);

    assert.match(helperCore, /eventType: "REFUND"/);
    assert.match(helper, /export \{ localRefundEvidenceEventId \}/);
    assert.match(helperCore, /localRefundEvidenceEventId\(action, refundId\)/);

    assert.match(sellerRoute, /recordSellerOrderRefund\(\{/);
    assert.match(webhookRoute, /recordBlockedCheckoutOrderRefund\(\{/);
    assert.doesNotMatch(sellerRoute, /recordLocalRefundEvidence/);
    assert.doesNotMatch(webhookRoute, /recordLocalRefundEvidence/);
    for (const action of [
      "SELLER_REFUND_RECORDED",
      "BLOCKED_CHECKOUT_REFUND_RECORDED",
    ]) {
      assert.match(
        refundAuthority,
        new RegExp(`INSERT INTO public\\.\"OrderPaymentEvent\"[\\s\\S]*'${action}'[\\s\\S]*INSERT INTO public\\.\"SystemAuditLog\"`),
      );
    }
    const caseAuthority = source(
      "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
    );
    assert.match(caseRoute, /await recordCaseStaffResolutionProvider\(/);
    assert.match(
      caseAuthority,
      /INSERT INTO public\."OrderPaymentEvent"[\s\S]*'CASE_REFUND_RECORDED'[\s\S]*INSERT INTO public\."SystemAuditLog"/,
    );
    assert.match(refundAuthority, /UPDATE public\."Listing" AS listing[\s\S]*INSERT INTO public\."SystemAuditLog"/);
  });

  it("keeps refund and label-purchase locks aligned", () => {
    const sellerRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const caseRoute = source("src/app/api/cases/[id]/resolve/route.ts");
    const labelRoute = source("src/app/api/orders/[id]/label/route.ts");
    const sellerAuthority = source(
      "prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql",
    );

    assert.match(sellerRoute, /orderHasPurchasedLabel/);
    assert.match(
      sellerRoute,
      /Cannot refund this order after a shipping label has been purchased/,
    );
    assert.match(
      sellerAuthority,
      /locked_order\."labelStatus"::text = 'PURCHASED'/,
    );
    assert.match(sellerRoute, /labelStatus: true/);

    assert.doesNotMatch(caseRoute, /orderHasPurchasedLabel/);
    assert.match(
      source(
        "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
      ),
      /locked_order\."labelStatus" =\s*'PURCHASED'::public\."LabelStatus"/,
    );

    assert.match(labelRoute, /"sellerRefundId" IS NULL/);
    assert.match(labelRoute, /"sellerRefundLockedAt" IS NULL/);
    assert.match(labelRoute, /releaseStaleRefundLocks\(id\)/);
    assert.match(labelRoute, /staleLocksReleased\.count > 0/);
    assert.ok(
      labelRoute.indexOf("releaseStaleRefundLocks(id)") <
        labelRoute.indexOf("if (order.labelStatus ==="),
      "label route should release stale refund locks before label/refund guards",
    );
    assert.match(labelRoute, /caseOrderActiveForSeller/);
    assert.match(
      labelRoute,
      /lockOrderForCaseLifecycle\(tx, order\.id\)[\s\S]*caseOrderActiveForSeller\([\s\S]*tx,/,
    );
    assert.doesNotMatch(labelRoute, /SELECT 1 FROM "Case" c/);
    assert.doesNotMatch(labelRoute, /\bACTIVE_CASE_STATUSES\b/);
    assert.match(labelRoute, /ope\."status" IS NULL/);
    assert.match(labelRoute, /lower\(ope\."status"\) NOT IN \(\$\{Prisma\.join\(NON_BLOCKING_REFUND_LEDGER_STATUSES\)\}\)/);
    assert.match(labelRoute, /latestOpenDisputeLedgerExistsSql/);
    assert.match(labelRoute, /latestOpenDisputeLedgerExistsSql\(Prisma\.sql`"Order"\.id`\)/);
  });

  it("keeps seller refund copy honest when transfer reversal needs manual reconciliation", () => {
    const salesPage = source("src/app/dashboard/sales/[orderId]/page.tsx");

    assert.match(salesPage, /manualStripeReconciliationNeeded: true/);
    assert.match(salesPage, /staff may need to reconcile the connected-account transfer manually/);
    assert.match(salesPage, /This amount has been deducted from your Stripe balance/);
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

  it("limits seller self-service to full cancellation refunds", () => {
    const route = source("src/app/api/orders/[id]/refund/route.ts");
    const panel = source("src/components/SellerRefundPanel.tsx");
    const salesPage = source("src/app/dashboard/sales/[orderId]/page.tsx");

    assert.match(route, /restoreStock:\s*z\s*\.array/);
    assert.match(
      route,
      /if \(refundParsed\.type === "PARTIAL"\)[\s\S]*Seller partial refunds require Grainline staff review/,
    );
    assert.match(route, /const type = "FULL" as const/);
    assert.match(route, /recordSellerOrderRefund\(\{/);
    assert.doesNotMatch(route, /(?:prisma|tx)\.listing\.(?:update|updateMany)/);
    assert.match(
      source("prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql"),
      /locked_order\."fulfillmentStatus"::text[\s\S]*FROM public\."OrderItem" AS item[\s\S]*UPDATE public\."Listing" AS listing/,
    );
    assert.match(panel, /JSON\.stringify\(\{ type: "FULL" \}\)/);
    assert.match(panel, /Partial refunds require Grainline staff review/);
    assert.doesNotMatch(panel, /Partial Refund|partialAmount|restoreQuantities/);
    assert.doesNotMatch(salesPage, /restorableRefundItems|canRestoreRefundStock/);
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
      /stockRestoreDecision:[\s\S]*resolution === "REFUND_PARTIAL"\s*\?\s*requestedStockRestores\s*:\s*\[\]/,
    );
    assert.match(
      source(
        "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
      ),
      /p_stock_restore_decision <> '\[\]'::jsonb[\s\S]*locked_order\."fulfillmentStatus" IN[\s\S]*Stock cannot be restored after fulfillment/,
    );
    assert.match(
      source(
        "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
      ),
      /FROM pg_catalog\.jsonb_array_elements\(\s*p_stock_restore_decision[\s\S]*LEFT JOIN available USING \(listing_id\)[\s\S]*Stock-restoration target or quantity is invalid/,
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
    assert.doesNotMatch(existingRetryBranch, /lineItems:/);
    const blockedRefundHelper = route.slice(
      route.indexOf("async function refundBlockedCheckout"),
      route.indexOf("if (existingBlockedCheckoutRetry)"),
    );
    assert.doesNotMatch(blockedRefundHelper, /input\.lineItems/);
    assert.match(blockedRefundHelper, /recordBlockedCheckoutOrderRefund\(/);
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

  it("uses a source-bound generation claim before automatic blocked-checkout refunds", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");
    const authority = source(
      "prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql",
    );
    const recordAuthority = source(
      "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
    );

    assert.match(route, /releaseStaleRefundLocks\(input\.orderId\)/);
    assert.match(route, /claimBlockedCheckoutOrderRefund\(\{/);
    assert.match(route, /eventClaimGeneration: claimGeneration/);
    assert.match(route, /sessionId,[\s\S]*orderId: input\.orderId/);
    assert.match(route, /createMarketplaceRefund\(\{/);
    assert.match(route, /idempotencyKeyBase: refundClaim\.idempotencyScope/);
    assert.match(route, /recordBlockedCheckoutOrderRefund\(\{/);
    assert.match(
      route,
      /Blocked checkout refund completed without a primary refund identifier/,
    );
    assert.doesNotMatch(route, /refund\s*=\s*await stripe\.refunds\.create/);
    assert.ok(
      route.indexOf("claimBlockedCheckoutOrderRefund({") <
        route.indexOf("createMarketplaceRefund({"),
      "blocked-checkout refunds must acquire the source-bound claim before the Stripe helper",
    );
    assert.doesNotMatch(route, /clearedOrderRefundClaimData|orderRefundClaimEvidence/);
    assert.match(recordAuthority, /grainline_blocked_checkout_refund_claim_resume/);
    assert.match(recordAuthority, /"refundClaimSourceGeneration" = locked_event\."claimGeneration"/);
    assert.match(recordAuthority, /orders\."refundClaimGeneration" = p_claim_generation/);
    assert.match(
      route,
      /stripe_webhook_blocked_checkout_refund_ambiguous_record_failed/,
    );
    assert.match(route, /ambiguousRecord\.count !== 1/);
    assert.match(
      route,
      /Blocked checkout ambiguous outcome was not recorded against the active generation/,
    );
    assert.match(authority, /locked_event\."claimGeneration" IS DISTINCT FROM p_event_claim_generation/);
    assert.match(authority, /locked_event\."sourceObjectId" IS DISTINCT FROM p_session_id/);
    assert.match(authority, /locked_order\."stripeSessionId" IS DISTINCT FROM p_session_id/);
    assert.match(authority, /claim_amount IS DISTINCT FROM p_expected_amount_cents/);
  });

  it("keeps blocked-checkout refund recovery retryable until local state is durable", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");
    const notificationSource = 'source: "stripe_webhook_blocked_checkout_refund_notification"';
    const retrySource = 'source: "stripe_webhook_blocked_checkout_finalize_retry"';
    const retryFailedSource = 'source: "stripe_webhook_blocked_checkout_finalize_retry_failed"';
    const lockReleaseSource = 'source: "stripe_webhook_blocked_checkout_refund_ambiguous_record_failed"';

    const notificationStart = route.indexOf(notificationSource);
    const retryStart = route.indexOf(retrySource);
    assert.ok(notificationStart > 0, "blocked-checkout refund notification failures should be observable");
    assert.ok(retryStart > 0, "blocked-checkout fixed finalization retries should be observable");

    const notificationBlock = route.slice(
      route.lastIndexOf("if (input.buyerUserId)", notificationStart),
      route.indexOf("} catch (refundError) {", notificationStart),
    );
    assert.match(notificationBlock, /try \{[\s\S]*await createNotification\(\{/);
    assert.match(notificationBlock, /catch \(notificationError\)/);

    assert.match(route, new RegExp(retryFailedSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(
      (route.match(/recordBlockedCheckoutOrderRefund\(\{/g) ?? []).length >= 2,
      "blocked-checkout provider evidence must retry through the same fixed finalizer",
    );
    assert.doesNotMatch(route, /orphanRecovery|orphanRecord|recordLocalRefundEvidence/);

    const lockReleaseStart = route.indexOf(lockReleaseSource);
    const noRefundIdBranch = route.slice(
      route.lastIndexOf("} else {", lockReleaseStart),
      route.indexOf("} catch (refundError) {", lockReleaseStart + 1),
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
    const refundStart = route.indexOf("await createMarketplaceRefund({");
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
    assert.match(route, /Boolean\(order\.refundClaimId\)/);
    assert.match(route, /!isStaleRefundLock\(/);
    assert.match(route, /delete orderUpdate\.sellerRefundLockedAt/);
  });

  it("serializes Stripe dispute Case promotion inside the fixed database operation", () => {
    const route = source("src/app/api/stripe/webhook/route.ts");
    const authority = source(
      "prisma/migrations/20260729043000_prepare_case_stripe_dispute_authority/migration.sql",
    );
    const disputeBranch = route.slice(
      route.indexOf("if (STRIPE_DISPUTE_EVENT_TYPES.has(event.type))"),
      route.indexOf('if (event.type === "payout.failed")'),
    );

    assert.match(disputeBranch, /grainline_case_stripe_dispute_apply\(\$\{paymentEvent\.id\}::text\)/);
    assert.doesNotMatch(disputeBranch, /tx\.case\.(?:create|update|updateMany)\(/);
    assert.match(
      authority,
      /FROM public\."Case" AS case_row\s+WHERE case_row\."orderId" = locked_order\.id\s+FOR UPDATE;/,
    );
    assert.match(authority, /RAISE EXCEPTION 'Case Stripe dispute target disappeared'\s+USING ERRCODE = '40001'/);
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
    assert.match(sellerCheckout, /isCheckoutStockUnavailableDatabaseError\(reservationError\)/);
    assert.match(sellerCheckout, /createConsistentCartCheckoutStockReservation/);
    assert.match(sellerCheckout, /abortCheckoutStockReservation/);
    assert.match(sellerCheckout, /restoreBuyerExpiredCheckoutStockOnce/);
    assert.match(sellerCheckout, /reason: "checkout_create_error"/);
    assert.match(
      singleCheckout,
      /source: "checkout_stock_restore_failed", route: "cart_checkout_single"/,
    );
    assert.match(singleCheckout, /isCheckoutStockUnavailableDatabaseError\(reservationError\)/);
    assert.match(singleCheckout, /createConsistentSingleCheckoutStockReservation/);
    assert.match(singleCheckout, /abortCheckoutStockReservation/);
    assert.match(singleCheckout, /restoreBuyerExpiredCheckoutStockOnce/);
    assert.match(singleCheckout, /reason: "checkout_create_error"/);
    assert.doesNotMatch(sellerCheckout, /\.catch\(\(\) => \{\}\)/);
    assert.doesNotMatch(singleCheckout, /\.catch\(\(\) => \{\}\)/);
  });
});
