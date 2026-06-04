import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("seller analytics refund guardrails", () => {
  it("keeps raw seller analytics SQL aligned with blocking refund ledger semantics", () => {
    for (const path of [
      "src/app/api/seller/analytics/route.ts",
      "src/lib/metrics.ts",
    ]) {
      const text = source(path);
      const refundEventChecks = text.match(/ope\."eventType" = 'REFUND'/g) ?? [];

      assert.equal(refundEventChecks.length, 1, `${path} should use one shared raw refund ledger fragment`);
      assert.match(text, /NON_BLOCKING_REFUND_LEDGER_STATUSES/);
      assert.match(text, /lower\(ope\."status"\) NOT IN \(\$\{Prisma\.join\(NON_BLOCKING_REFUND_LEDGER_STATUSES\)\}\)/);
      assert.doesNotMatch(text, /SELECT 1 FROM "OrderPaymentEvent" ope[\s\S]{0,180}ope\."eventType" = 'REFUND'[\s\S]{0,80}\)[\s\S]{0,80}AND o\."createdAt"/);
    }
  });

  it("keeps recent sales on the Prisma blocking refund helper", () => {
    const recentSales = source("src/app/api/seller/analytics/recent-sales/route.ts");

    assert.match(recentSales, /paymentEvents: \{ none: blockingRefundLedgerWhere\(\) \}/);
    assert.doesNotMatch(recentSales, /OrderPaymentEvent/);
  });
});
