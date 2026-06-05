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
    assert.match(helper, /SELECT DISTINCT ON \(COALESCE\(ope\."stripeObjectId", ope\.id\)\)/);
    assert.match(helper, /ORDER BY COALESCE\(ope\."stripeObjectId", ope\.id\), ope\."createdAt" DESC, ope\.id DESC/);
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
});
