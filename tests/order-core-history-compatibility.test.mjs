import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");
const record = read("docs/order-core-history-compatibility.md");

const historicalRenderers = [
  "src/app/admin/orders/[id]/page.tsx",
  "src/app/admin/orders/page.tsx",
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
  "src/app/api/orders/[id]/fulfillment/route.ts",
  "src/app/api/orders/[id]/label/route.ts",
  "src/app/api/orders/[id]/refund/route.ts",
  "src/app/api/stripe/webhook/route.ts",
  "src/lib/accountDeletion.ts",
  "src/lib/ban.ts",
];

describe("core Order historical compatibility", () => {
  it("renders retained Order items through the bounded checkout snapshot", () => {
    for (const file of historicalRenderers) {
      const source = read(file);
      assert.match(source, /readHistoricalOrderItemSnapshot/, file);
      assert.match(source, /listingSnapshot|firstItemListingSnapshot/, file);
      assert.doesNotMatch(source, /\.listing\.title|\.listing\.photos|\.listing\.seller\.displayName/, file);
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
    for (const field of [
      "listingType",
      "processingTimeMinDays",
      "processingTimeMaxDays",
      "shipsWithinDays",
    ]) {
      assert.equal(webhook.match(new RegExp(`${field}:`, "g"))?.length >= 2, true, field);
    }
    assert.match(webhook, /sellerProfileId: cartSellerProfileId/);
    assert.match(webhook, /sellerProfileId: singleSellerProfileId/);
    assert.match(webhook, /const seller = order\.sellerProfile/);
    assert.match(webhook, /where: \{ sellerProfileId: seller\.id \}/);
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
