import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("seller analytics refund guardrails", () => {
  it("keeps operational ledger SQL canonical while aggregate consumers use fixed projections", () => {
    const helper = source("src/lib/refundLedgerSql.ts");
    assert.match(helper, /paymentRefundBlockedSql/);
    assert.match(helper, /paymentOpenDisputeBlockedSql/);
    assert.match(helper, /paymentTransitionBlockedSql/);
    assert.match(helper, /"paymentRefundBlocked" = true/);
    assert.match(helper, /"paymentOpenDisputeBlocked" = true/);
    assert.doesNotMatch(helper, /OrderPaymentEvent|paymentEvents|ope\./);

    for (const path of [
      "src/app/api/seller/analytics/route.ts",
      "src/lib/metrics.ts",
      "src/app/api/verification/apply/route.ts",
      "src/app/dashboard/verification/page.tsx",
      "src/app/admin/verification/page.tsx",
      "src/lib/site-metrics-snapshot.ts",
      "src/lib/quality-score.ts",
    ]) {
      const text = source(path);

      assert.match(
        text,
        /paymentRefundBlocked/,
        `${path} should use the database-maintained refund projection`,
      );
      assert.doesNotMatch(
        text,
        /BLOCKING_REFUND_LEDGER_SQL|ope\."eventType" = 'REFUND'|OrderPaymentEvent/,
        `${path} should not enumerate the private payment ledger`,
      );
    }
  });

  it("keeps recent sales on the fixed Order refund projection", () => {
    const recentSales = source("src/app/api/seller/analytics/recent-sales/route.ts");

    assert.match(recentSales, /paymentRefundBlocked: false/);
    assert.doesNotMatch(recentSales, /paymentEvents:|blockingRefundLedgerWhere|OrderPaymentEvent/);
  });

  it("keeps homepage fulfilled-order statistics on the fixed Order refund projection", () => {
    const homepageStats = source("src/lib/homepageStats.ts");

    assert.match(homepageStats, /sellerRefundId: null/);
    assert.match(homepageStats, /paymentRefundBlocked: false/);
    assert.doesNotMatch(homepageStats, /paymentEvents:|blockingRefundLedgerWhere|OrderPaymentEvent/);
    assert.match(homepageStats, /fulfillmentStatus: \{ in: \["DELIVERED", "PICKED_UP"\] \}/);
  });

  it("keeps seller and staff Case refunds visible to Guild sales filters", () => {
    const helper = source("src/lib/localRefundEvidenceCore.ts");
    const sellerRefundRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const sellerRefundAuthority = source(
      "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
    );
    const caseResolveRoute = source("src/app/api/cases/[id]/resolve/route.ts");
    const caseResolveAuthority = source(
      "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
    );
    const verificationApplyRoute = source("src/app/api/verification/apply/route.ts");
    const dashboardVerification = source("src/app/dashboard/verification/page.tsx");
    const adminVerification = source("src/app/admin/verification/page.tsx");

    assert.match(helper, /eventType: "REFUND"/);
    assert.match(helper, /amountCents/);

    assert.match(sellerRefundRoute, /finalizeSellerOrderRefund\(\{/);
    assert.match(sellerRefundAuthority, /"sellerRefundAmountCents" = refund_amount/);
    assert.match(sellerRefundAuthority, /'SELLER_REFUND_RECORDED'/);
    assert.match(sellerRefundAuthority, /"amountCents"[\s\S]*refund_amount/);
    assert.match(
      sellerRefundRoute,
      /if \(refundParsed\.type === "PARTIAL"\)[\s\S]*Seller partial refunds require Grainline staff review/,
    );
    assert.match(caseResolveRoute, /resolution: z\.enum\(\["REFUND_FULL", "REFUND_PARTIAL", "DISMISSED"\]\)/);

    assert.match(
      caseResolveRoute,
      /amountCents: prepared\.refundAmountCents!/,
    );
    assert.match(
      caseResolveRoute,
      /finalized = await finalizeCaseStaffResolutionWithSideEffects\(\s*me\.id,\s*prepared,?\s*\)/,
    );
    assert.match(
      caseResolveAuthority,
      /"sellerRefundAmountCents" = locked_claim\."refundAmountCents"/,
    );
    assert.match(caseResolveAuthority, /'CASE_REFUND_RECORDED'/);
    assert.match(
      caseResolveAuthority,
      /'amountCents', locked_claim\."refundAmountCents"/,
    );

    for (const text of [verificationApplyRoute, dashboardVerification, adminVerification]) {
      assert.match(text, /o\."sellerRefundId" IS NULL/);
      assert.match(text, /o\."paymentRefundBlocked" = false/);
      assert.doesNotMatch(text, /BLOCKING_REFUND_LEDGER_SQL|OrderPaymentEvent/);
    }
  });

  it("orders seller refund and blocked-checkout dispute guards by Stripe event time", () => {
    const sellerRefundRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const stripeWebhook = source("src/app/api/stripe/webhook/route.ts");

    assert.match(sellerRefundRoute, /order\.paymentOpenDisputeBlocked/);
    assert.match(stripeWebhook, /currentOrder\.paymentOpenDisputeBlocked/);
    assert.doesNotMatch(sellerRefundRoute, /orderPaymentEvent|paymentEvents|OrderPaymentEvent/);
    assert.doesNotMatch(stripeWebhook, /orderPaymentEvent|paymentEvents|OrderPaymentEvent/);
  });
});
