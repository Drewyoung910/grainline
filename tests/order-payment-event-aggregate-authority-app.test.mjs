import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const aggregateConsumers = [
  "src/app/account/page.tsx",
  "src/app/admin/verification/page.tsx",
  "src/app/api/seller/analytics/recent-sales/route.ts",
  "src/app/api/seller/analytics/route.ts",
  "src/components/ReviewsSection.tsx",
  "src/lib/ban.ts",
  "src/lib/homepageStats.ts",
  "src/lib/metrics.ts",
  "src/lib/publicSellerStats.ts",
  "src/lib/quality-score.ts",
  "src/lib/site-metrics-snapshot.ts",
];

function source(file) {
  return readFileSync(file, "utf8");
}

describe("OrderPaymentEvent aggregate-authority application conversion", () => {
  it("keeps remaining aggregate consumers on fixed projections", () => {
    assert.equal(aggregateConsumers.length, 11);
    for (const file of aggregateConsumers) {
      const value = source(file);
      assert.match(
        value,
        /paymentRefundBlocked|paymentConversionDisputeBlocked/,
        `${file} lost its fixed payment eligibility projection`,
      );
      assert.doesNotMatch(
        value,
        /(?:prisma|tx)\.orderPaymentEvent|paymentEvents\s*:|FROM\s+"OrderPaymentEvent"|JOIN\s+"OrderPaymentEvent"|blockingRefundLedgerWhere|BLOCKING_REFUND_LEDGER_SQL|latestConversionBlockingDisputeLedgerExistsSql/,
        `${file} regained direct payment-ledger authority`,
      );
    }
  });

  it("serializes verified review creation against payment evidence insertion", () => {
    const route = source("src/app/api/reviews/route.ts");
    const eligibility = source(
      "prisma/migrations/20260901040000_prepare_order_eligibility_authority/migration.sql",
    );
    assert.match(route, /prisma\.\$transaction\(async \(tx\) => \{/u);
    assert.match(route, /lockReviewEligibleOrderItem\([\s\S]*tx/u);
    assert.match(eligibility, /FOR UPDATE OF source_order/u);
    assert.match(eligibility, /source_order\."paymentRefundBlocked" = false/u);
    assert.match(route, /if \(!eligibleOrderItem\) return null;/u);
    assert.match(route, /if \(!created\)[\s\S]*status: 403/u);
    assert.match(route, /refreshSellerRatingSummary\(eligibleOrderItem\.sellerProfileId, tx\)/u);
  });

  it("keeps raw aggregate consumers set-based on Order projections", () => {
    for (const file of [
      "src/app/api/seller/analytics/route.ts",
      "src/lib/metrics.ts",
      "src/lib/publicSellerStats.ts",
      "src/lib/quality-score.ts",
      "src/lib/site-metrics-snapshot.ts",
    ]) {
      const value = source(file);
      assert.match(value, /o\."paymentRefundBlocked" = false/u);
      assert.doesNotMatch(value, /Promise\.all\([^)]*orders\.map/u);
    }
  });

  it("keeps destructive/admin races conservatively fail-closed", () => {
    const softDelete = source("src/lib/listingSoftDelete.ts");
    const eligibility = source(
      "prisma/migrations/20260901040000_prepare_order_eligibility_authority/migration.sql",
    );
    const ban = source("src/lib/ban.ts");
    assert.match(softDelete, /getListingOrderArchiveBlocked/u);
    assert.match(eligibility, /source_order\."paymentRefundBlocked" = false/u);
    assert.match(softDelete, /TransactionIsolationLevel\.Serializable/u);
    assert.match(ban, /paymentRefundBlocked: false/u);
    assert.match(ban, /reviewNeeded: true/u);
  });
});
