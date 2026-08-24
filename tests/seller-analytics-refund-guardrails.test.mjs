import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("seller analytics refund guardrails", () => {
  it("centralizes raw blocking-refund ledger SQL and keeps callers on it", () => {
    const helper = source("src/lib/refundLedgerSql.ts");
    assert.match(helper, /NON_BLOCKING_REFUND_LEDGER_STATUSES/);
    assert.match(helper, /lower\(ope\."status"\) NOT IN \(\$\{Prisma\.join\(NON_BLOCKING_REFUND_LEDGER_STATUSES\)\}\)/);
    assert.match(helper, /latestOpenDisputeLedgerExistsSql/);
    assert.match(helper, /latestOpenDisputeLedgerRowsSql/);
    assert.match(helper, /latestDisputeLedgerRowsSql/);
    assert.match(helper, /latestConversionBlockingDisputeLedgerExistsSql/);
    assert.match(helper, /SELECT DISTINCT ON \(COALESCE\(ope\."stripeObjectId", ope\.id\)\)/);
    assert.match(helper, /NULLIF\(ope\."metadata"->>'stripeEventCreated', ''\)::bigint/);
    assert.match(helper, /EXTRACT\(EPOCH FROM ope\."createdAt"\)::bigint/);
    assert.match(helper, /ope\."createdAt" DESC/);
    assert.match(helper, /STRIPE_DISPUTE_CLOSED_STATUSES/);

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

      assert.match(text, /BLOCKING_REFUND_LEDGER_SQL/, `${path} should import/use shared raw refund ledger SQL`);
      assert.doesNotMatch(text, /ope\."eventType" = 'REFUND'/, `${path} should not inline bare refund ledger SQL`);
    }
  });

  it("keeps recent sales on the Prisma blocking refund helper", () => {
    const recentSales = source("src/app/api/seller/analytics/recent-sales/route.ts");

    assert.match(recentSales, /paymentEvents: \{ none: blockingRefundLedgerWhere\(\) \}/);
    assert.doesNotMatch(recentSales, /OrderPaymentEvent/);
  });

  it("keeps homepage fulfilled-order statistics on the Prisma blocking refund helper", () => {
    const homepageStats = source("src/lib/homepageStats.ts");

    assert.match(homepageStats, /sellerRefundId: null/);
    assert.match(homepageStats, /paymentEvents: \{ none: blockingRefundLedgerWhere\(\) \}/);
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
      /finalized = await finalizeCaseStaffResolution\(me\.id, prepared\)/,
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
      assert.match(text, /BLOCKING_REFUND_LEDGER_SQL/);
    }
  });

  it("orders seller refund and blocked-checkout dispute guards by Stripe event time", () => {
    const sellerRefundRoute = source("src/app/api/orders/[id]/refund/route.ts");
    const stripeWebhook = source("src/app/api/stripe/webhook/route.ts");

    assert.match(sellerRefundRoute, /latestOpenDisputeLedgerExistsSql\(Prisma\.sql`\$\{orderId\}`\)/);
    assert.doesNotMatch(sellerRefundRoute, /orderPaymentEvent\.findFirst\(\{\s*where: \{ orderId, eventType: "DISPUTE" \}/s);

    assert.match(stripeWebhook, /latestOpenDisputeLedgerRowsSql\(Prisma\.sql`\$\{input\.orderId\}`\)/);
    assert.doesNotMatch(stripeWebhook, /orderPaymentEvent\.findFirst\(\{\s*where: \{ orderId: input\.orderId, eventType: "DISPUTE" \}/s);
    assert.doesNotMatch(sellerRefundRoute, /blockingRefundOrDisputeLedgerWhere/);
    assert.doesNotMatch(stripeWebhook, /blockingRefundOrDisputeLedgerWhere/);
  });
});
