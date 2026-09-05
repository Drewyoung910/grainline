import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const aggregateConsumers = [
  "src/app/account/page.tsx",
  "src/app/admin/verification/page.tsx",
  "src/app/api/seller/analytics/recent-sales/route.ts",
  "src/app/api/seller/analytics/route.ts",
  "src/components/ReviewsSection.tsx",
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
    assert.equal(aggregateConsumers.length, 10);
    const publicAggregateConsumers = new Set([
      "src/lib/homepageStats.ts",
      "src/lib/publicSellerStats.ts",
      "src/lib/quality-score.ts",
      "src/lib/site-metrics-snapshot.ts",
    ]);
    const sellerAnalyticsConsumers = new Set([
      "src/app/account/page.tsx",
      "src/app/api/seller/analytics/recent-sales/route.ts",
      "src/app/api/seller/analytics/route.ts",
    ]);
    const sellerMetricsConsumers = new Set([
      "src/app/admin/verification/page.tsx",
      "src/lib/metrics.ts",
    ]);
    for (const file of aggregateConsumers) {
      const value = source(file);
      assert.match(
        value,
        publicAggregateConsumers.has(file)
          ? /orderPublicAggregateAuthority|getPublic/
          : sellerAnalyticsConsumers.has(file)
            ? /orderSellerAnalyticsAuthority|readSeller|countSellerCompletedOrders/
          : sellerMetricsConsumers.has(file)
            ? /orderSellerMetricsAuthority|readOrderSellerMetricsFacts/
          : /lockReviewEligibleOrderItem/,
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
    const metrics = source("src/lib/metrics.ts");
    assert.match(metrics, /readOrderSellerMetricsFacts/u);
    assert.doesNotMatch(metrics, /FROM "Order"|JOIN "OrderItem"/u);
    assert.doesNotMatch(metrics, /Promise\.all\([^)]*orders\.map/u);

    const sellerMetricsAuthority = source(
      "prisma/migrations/20260901070000_prepare_order_seller_metrics_authority/migration.sql",
    );
    assert.match(sellerMetricsAuthority, /source_order\."paymentRefundBlocked" = false/u);
    assert.match(sellerMetricsAuthority, /source_order\."sellerProfileId" = p_seller_profile_id/u);
    assert.match(sellerMetricsAuthority, /source_item\."sellerProfileId" = p_seller_profile_id/u);

    const sellerAnalyticsAuthority = source(
      "prisma/migrations/20260901060000_prepare_order_seller_analytics_authority/migration.sql",
    );
    assert.match(sellerAnalyticsAuthority, /source_order\."paymentRefundBlocked" = false/u);
    assert.doesNotMatch(sellerAnalyticsAuthority, /Promise\.all/u);
    const publicAuthority = source(
      "prisma/migrations/20260901050000_prepare_order_public_aggregate_authority/migration.sql",
    );
    assert.match(publicAuthority, /source_order\."paymentRefundBlocked" = false/u);
    assert.match(publicAuthority, /source_order\."paymentConversionDisputeBlocked" = false/u);
    assert.doesNotMatch(publicAuthority, /Promise\.all/u);
  });

  it("keeps destructive/admin races conservatively fail-closed", () => {
    const softDelete = source("src/lib/listingSoftDelete.ts");
    const eligibility = source(
      "prisma/migrations/20260901040000_prepare_order_eligibility_authority/migration.sql",
    );
    const banOrderAuthority = source(
      "docs/rls-drafts/order-ban-review-authority.sql",
    );
    assert.match(softDelete, /getListingOrderArchiveBlocked/u);
    assert.match(eligibility, /source_order\."paymentRefundBlocked" = false/u);
    assert.match(softDelete, /TransactionIsolationLevel\.Serializable/u);
    assert.match(banOrderAuthority, /source_order\."paymentRefundBlocked" = false/u);
    assert.match(banOrderAuthority, /SET "reviewNeeded" = true/u);
    assert.match(banOrderAuthority, /FOR UPDATE/u);
  });
});
