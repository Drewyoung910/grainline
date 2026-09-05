import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");
const record = read("docs/order-core-history-compatibility.md");

const historicalRenderers = [
  "src/app/api/seller/analytics/recent-sales/route.ts",
];

const participantDetailRenderers = [
  ["src/app/dashboard/orders/[id]/page.tsx", "readBuyerOrderDetail"],
  ["src/app/dashboard/sales/[orderId]/page.tsx", "readSellerOrderDetail"],
];

const boundedSummaryRenderers = [
  "src/app/account/orders/page.tsx",
  "src/app/account/page.tsx",
  "src/app/dashboard/orders/page.tsx",
];

const boundedSellerSummaryRenderers = [
  "src/app/dashboard/sales/page.tsx",
];

const durableSellerConsumers = [
  "src/app/api/account/export/route.ts",
  "src/app/api/stripe/webhook/route.ts",
  "src/lib/accountDeletion.ts",
  "src/lib/ban.ts",
  "prisma/migrations/20260901130000_prepare_order_fulfillment_authority/migration.sql",
  "prisma/migrations/20260901140000_prepare_order_label_authority/migration.sql",
];

describe("core Order historical compatibility", () => {
  it("renders retained Order items through the bounded checkout snapshot", () => {
    for (const file of historicalRenderers) {
      const source = read(file);
      assert.match(source, /readHistoricalOrderItemSnapshot/, file);
      assert.match(source, /listingSnapshot|firstItemListingSnapshot/, file);
      assert.doesNotMatch(source, /\.listing\.title|\.listing\.photos|\.listing\.seller\.displayName/, file);
    }
    for (const file of [
      "src/app/admin/orders/[id]/page.tsx",
      "src/app/admin/orders/page.tsx",
      "src/app/admin/flagged/page.tsx",
    ]) {
      const source = read(file);
      assert.match(source, /readStaffOrder(?:Detail|Page)/, file);
      assert.doesNotMatch(source, /prisma\.order|listingSnapshot|\.listing\.title/, file);
    }
    const checkoutReceipt = read("src/app/checkout/success/page.tsx");
    assert.match(checkoutReceipt, /readBuyerCheckoutReceipts/);
    assert.match(checkoutReceipt, /\.snapshot\.(?:title|imageUrls|sellerName)/);
    assert.doesNotMatch(
      checkoutReceipt,
      /prisma\.order|listingSnapshot|readHistoricalOrderItemSnapshot/,
    );
    for (const file of boundedSummaryRenderers) {
      const source = read(file);
      assert.match(source, /readBuyerOrderSummaryPage/, file);
      assert.doesNotMatch(source, /prisma\.order|\.listing\.title|\.listing\.photos/, file);
    }
    for (const file of boundedSellerSummaryRenderers) {
      const source = read(file);
      assert.match(source, /readSellerOrderSummaryPage/, file);
      assert.doesNotMatch(source, /prisma\.order|\.listing\.title|\.listing\.photos/, file);
    }
    for (const [file, authority] of participantDetailRenderers) {
      const source = read(file);
      assert.match(source, new RegExp(`${authority}\\(`), file);
      assert.match(source, /\.snapshot\.(?:title|imageUrls|sellerName)/, file);
      assert.doesNotMatch(source, /prisma\.order|listingSnapshot|readHistoricalOrderItemSnapshot/, file);
    }
    const summaryAuthority = read(
      "prisma/migrations/20260901080000_prepare_order_participant_summary_authority/migration.sql",
    );
    assert.match(summaryAuthority, /summary_item\."listingSnapshot"/);
    assert.match(summaryAuthority, /LIMIT 5/);
    assert.doesNotMatch(summaryAuthority, /JOIN public\."Listing"/);
  });

  it("uses the durable Order seller key for converted seller authority", () => {
    for (const file of durableSellerConsumers) {
      const source = read(file);
      assert.match(source, /sellerProfileId/, file);
      assert.doesNotMatch(
        source,
        /items:\s*\{\s*(?:some|every):\s*\{\s*listing:\s*\{\s*sellerId/s,
        file,
      );
    }
    const sellerRefundPreflight = read(
      "docs/rls-drafts/order-seller-refund-preflight-authority.sql",
    );
    assert.match(
      sellerRefundPreflight,
      /locked_order\."sellerProfileId" IS DISTINCT FROM locked_seller\.id/,
    );
    assert.doesNotMatch(
      read("src/app/api/orders/[id]/refund/route.ts"),
      /\bprisma\.order\b/,
    );

    assert.match(read("src/app/account/page.tsx"), /countSellerCompletedOrders\(me\.id\)/);
    assert.match(
      read("src/app/api/seller/analytics/recent-sales/route.ts"),
      /readSellerRecentSales\(me\.id\)/,
    );
    const sellerAnalyticsAuthority = read(
      "prisma/migrations/20260901060000_prepare_order_seller_analytics_authority/migration.sql",
    );
    assert.match(
      sellerAnalyticsAuthority,
      /source_order\."sellerProfileId" = seller_actor\.id/,
    );
    assert.match(
      sellerAnalyticsAuthority,
      /seller\.id = source_order\."sellerProfileId"/,
    );
    const sellerMetricsAuthority = read(
      "prisma/migrations/20260901070000_prepare_order_seller_metrics_authority/migration.sql",
    );
    assert.match(
      sellerMetricsAuthority,
      /source_order\."sellerProfileId" = p_seller_profile_id/,
    );
    assert.match(
      sellerMetricsAuthority,
      /source_item\."sellerProfileId" = p_seller_profile_id/,
    );
    assert.doesNotMatch(sellerMetricsAuthority, /JOIN public\."Listing"/);
  });

  it("binds participant detail reads in the database predicate", () => {
    assert.match(
      read("src/app/dashboard/orders/[id]/page.tsx"),
      /readBuyerOrderDetail\(me\.id, id\)/,
    );
    assert.match(
      read("src/app/dashboard/sales/[orderId]/page.tsx"),
      /readSellerOrderDetail\(me\.id, orderId\)/,
    );
    const authority = read(
      "prisma/migrations/20260901010000_prepare_order_participant_detail_authority/migration.sql",
    );
    assert.match(authority, /source_order\."buyerId" = p_actor_user_id/g);
    assert.match(authority, /seller\.id = source_order\."sellerProfileId"/g);
    assert.match(authority, /seller\."userId" = p_actor_user_id/g);
  });

  it("writes the expanded snapshot in both paid webhook families", () => {
    const webhook = read("src/app/api/stripe/webhook/route.ts");
    const paidCheckoutAuthority = read("docs/rls-drafts/order-paid-checkout-authority.sql");
    for (const field of [
      "listingType",
      "processingTimeMinDays",
      "processingTimeMaxDays",
      "shipsWithinDays",
    ]) {
      assert.match(paidCheckoutAuthority, new RegExp(`'${field}'`), field);
    }
    assert.match(webhook, /createOrderFromPaidCheckout\(/);
    assert.match(paidCheckoutAuthority, /source_seller_id, source_now, p_paid_at, p_session_id/);
    assert.match(paidCheckoutAuthority, /source_order_id, source_listing_id,[\s\S]*source_seller_id/);
    assert.match(webhook, /const seller = order\.sellerProfile/);
    assert.match(webhook, /sellerProfileId: seller\.id,[\s\S]*paidAt: \{ not: null \}/);
    assert.match(webhook, /sellerRefundId: null,[\s\S]*paymentRefundBlocked: false/);
    assert.doesNotMatch(webhook, /order\.items\[0\]\?\.listing\.seller/);
  });

  it("does not expose a runtime paid-Order fabrication route", () => {
    assert.equal(fs.existsSync("src/app/api/dev/make-order/route.ts"), false);
    assert.doesNotMatch(read(".env.example"), /ENABLE_DEV_MAKE_ORDER/);
  });

  it("records the remaining boundaries without claiming RLS activation", () => {
    assert.match(record, /contains no\s+database migration, policy, grant, deployment, provider, credential or\s+production-state change/);
    assert.match(record, /never falls back to mutable Listing content/);
    assert.match(record, /Account export continues to include shipping-rate quote rows/);
    assert.match(record, /Order RLS remains off/);
    assert.match(record, /separate `OrderItem` and\s+`OrderShippingRateQuote` releases/);
  });
});
