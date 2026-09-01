import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("seller order mutation ownership guardrails", () => {
  it("requires seller routes to bind the checkout-owned Order seller", () => {
    const refund = source("src/app/api/orders/[id]/refund/route.ts");
    assert.match(
      refund,
      /findFirst\(\{\s*where: \{ id: orderId, sellerProfileId: seller\.id(?:,|\s*\})/s,
      "seller refund must bind the Order's durable seller key in the lookup",
    );
    assert.doesNotMatch(
      refund,
      /order\.items\.(?:some|every)\(\(it\) => it\.listing\.sellerId === seller\.id\)/,
      "seller refund must not derive retained Order authority from mutable Listings",
    );

    const label = source("src/app/api/orders/[id]/label/route.ts");
    const labelAuthority = source(
      "prisma/migrations/20260901140000_prepare_order_label_authority/migration.sql",
    );
    assert.match(
      label,
      /sellerLabelPreflight\(\{\s*actorUserId: actor\.id, orderId\s*\}\)/s,
    );
    assert.doesNotMatch(label, /\bprisma\.(?:order|orderShippingRateQuote)\b/);
    assert.match(
      labelAuthority,
      /source_order\."sellerProfileId" IS DISTINCT FROM seller\.id/,
      "seller label authority must bind the Order's durable seller key in PostgreSQL",
    );
    assert.match(labelAuthority, /source_seller\."userId" = actor\.id/);
    assert.doesNotMatch(labelAuthority, /listing\."sellerId"\s*=\s*seller\.id/);

    const fulfillment = source("src/app/api/orders/[id]/fulfillment/route.ts");
    const fulfillmentAuthority = source(
      "prisma/migrations/20260901130000_prepare_order_fulfillment_authority/migration.sql",
    );
    assert.match(fulfillment, /finalizeSellerOrderFulfillment\(\{/);
    assert.match(fulfillment, /updateSellerOrderNotes\(\{/);
    assert.doesNotMatch(fulfillment, /prisma\.order\./);
    assert.match(
      fulfillmentAuthority,
      /locked_order\."sellerProfileId" IS DISTINCT FROM source_seller\.id/,
    );
    assert.doesNotMatch(fulfillmentAuthority, /JOIN public\."Listing"/);

    const detail = source("src/app/dashboard/sales/[orderId]/page.tsx");
    const detailAuthority = source(
      "prisma/migrations/20260901010000_prepare_order_participant_detail_authority/migration.sql",
    );
    assert.match(
      detail,
      /readSellerOrderDetail\(me\.id, orderId\)/,
      "seller sales detail must use the actor-bound database projection",
    );
    assert.match(detailAuthority, /seller\.id = source_order\."sellerProfileId"/);
    assert.match(detailAuthority, /seller\."userId" = p_actor_user_id/);
    assert.doesNotMatch(detail, /prisma\.order\./);
    assert.doesNotMatch(
      detail,
      /myItems\.length === 0/,
      "seller sales detail must not expose whole-order data from partial order ownership",
    );
  });

  it("keeps seller order read surfaces on durable whole-order ownership", () => {
    for (const path of [
      "src/app/api/account/export/route.ts",
      "src/lib/accountDeletion.ts",
      "src/lib/ban.ts",
    ]) {
      const text = source(path);
      assert.match(
        text,
        /sellerProfileId:/,
        `${path} must use the checkout-bound Order seller key`,
      );
      assert.doesNotMatch(
        text,
        /items:\s*{\s*(?:some|every):\s*{\s*listing:\s*{\s*sellerId:/s,
        `${path} must not derive seller Order authority from current Listings`,
      );
    }

    const sales = source("src/app/dashboard/sales/page.tsx");
    const summaryAuthority = source(
      "prisma/migrations/20260901080000_prepare_order_participant_summary_authority/migration.sql",
    );
    assert.match(sales, /readSellerOrderSummaryPage/);
    assert.match(summaryAuthority, /seller\.id = source_order\."sellerProfileId"/);
    assert.match(summaryAuthority, /seller\."userId" = p_actor_user_id/);

    const recentSales = source("src/app/api/seller/analytics/recent-sales/route.ts");
    const analyticsAuthority = source("src/lib/orderSellerAnalyticsAuthority.ts");
    const analyticsMigration = source(
      "prisma/migrations/20260901060000_prepare_order_seller_analytics_authority/migration.sql",
    );
    assert.match(recentSales, /readSellerRecentSales\(me\.id\)/);
    assert.match(analyticsAuthority, /grainline_order_seller_recent_sales/);
    assert.match(analyticsMigration, /source_order\."sellerProfileId" = seller_actor\.id/);
    assert.doesNotMatch(recentSales, /prisma\.order\./);

    const account = source("src/app/account/page.tsx");
    assert.match(account, /countSellerCompletedOrders\(me\.id\)/);
    assert.doesNotMatch(account, /items:\s*\{\s*(?:some|every):\s*\{\s*listing:\s*\{\s*sellerId:/s);
  });

  it("keeps cached public seller stats on whole-order ownership", () => {
    const text = source("src/lib/publicSellerStats.ts");
    const authority = source(
      "prisma/migrations/20260901050000_prepare_order_public_aggregate_authority/migration.sql",
    );

    assert.match(text, /getPublicSellerOrderStats/u);
    assert.match(authority, /source_order\."sellerProfileId" = visible_seller\.id/u);
    assert.match(authority, /source_item\."sellerProfileId" = visible_seller\.id/u);
    assert.doesNotMatch(authority, /listing\."sellerId"\s*=\s*p_seller_profile_id/u);
  });
});
