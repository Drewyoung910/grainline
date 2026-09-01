import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  sellerCompletedOrderCountFromRows,
  sellerOrderAnalyticsBucketsFromRows,
  sellerOrderAnalyticsSummaryFromRows,
  sellerOrderTopListingsFromRows,
  sellerRecentSalesFromRows,
} from "../src/lib/orderSellerAnalyticsState.ts";

describe("Order seller analytics strict result parsing", () => {
  it("accepts bounded fixed analytics projections", () => {
    assert.deepEqual(sellerOrderAnalyticsSummaryFromRows([{
      seller_profile_id: "seller-1",
      total_revenue_cents: 1500n,
      total_orders: 2n,
      total_buyers: 1n,
      repeat_buyers: 1n,
      avg_processing_hours: 24,
      cart_abandonment: 3n,
    }]), {
      sellerProfileId: "seller-1",
      totalRevenueCents: 1500,
      totalOrders: 2,
      totalBuyers: 1,
      repeatBuyers: 1,
      avgProcessingHours: 24,
      cartAbandonment: 3,
    });
    assert.equal(sellerCompletedOrderCountFromRows([{ value: 4n }]), 4);
    assert.equal(sellerOrderAnalyticsBucketsFromRows([{
      bucket_epoch_millis: 1000n,
      revenue_cents: 500n,
      order_count: 1n,
    }], 24)[0].bucket.getTime(), 1000);
    assert.equal(sellerOrderTopListingsFromRows([{
      listing_id: "listing-1",
      title: "Chair",
      image_url: null,
      total_revenue_cents: 500n,
      units_sold: 1n,
      avg_price_cents: 500n,
      view_count: 5n,
      click_count: 2n,
      favorite_count: 1n,
      stock_notification_count: 0n,
      listing_created_at_epoch_millis: 1000n,
    }])[0].title, "Chair");
    assert.equal(sellerRecentSalesFromRows([{
      order_id: "order-1",
      created_at_epoch_millis: 1000n,
      items_subtotal_cents: 500,
      shipping_amount_cents: 20,
      tax_amount_cents: 10,
      gift_wrapping_price_cents: null,
      currency: "usd",
      fulfillment_status: "DELIVERED",
      first_item_price_cents: 500,
      first_item_listing_snapshot: { title: "Chair" },
      buyer_name: null,
      buyer_email: null,
      buyer_data_purged_at_epoch_millis: 2000n,
      buyer_deleted_at_epoch_millis: null,
    }])[0].firstItemPriceCents, 500);
  });

  it("rejects over-broad, unordered, inconsistent or unsafe results", () => {
    assert.throws(() => sellerOrderAnalyticsSummaryFromRows([{
      seller_profile_id: "seller-1",
      total_revenue_cents: 0,
      total_orders: 0,
      total_buyers: 1,
      repeat_buyers: 2,
      avg_processing_hours: null,
      cart_abandonment: 0,
    }]), /repeat-buyer count is invalid/);
    assert.throws(() => sellerOrderAnalyticsBucketsFromRows([
      { bucket_epoch_millis: 2000, revenue_cents: 0, order_count: 0 },
      { bucket_epoch_millis: 1000, revenue_cents: 0, order_count: 0 },
    ], 2), /not strictly ordered/);
    assert.throws(() => sellerOrderTopListingsFromRows(Array.from({ length: 9 }, () => ({}))), /too large/);
    assert.throws(() => sellerRecentSalesFromRows([{
      order_id: "order-1",
      created_at_epoch_millis: 1000,
      items_subtotal_cents: 500,
      shipping_amount_cents: 20,
      tax_amount_cents: 10,
      gift_wrapping_price_cents: null,
      currency: "usd",
      fulfillment_status: "DELIVERED",
      first_item_price_cents: 500,
      first_item_listing_snapshot: {},
      buyer_name: "Retained Name",
      buyer_email: null,
      buyer_data_purged_at_epoch_millis: 2000,
      buyer_deleted_at_epoch_millis: null,
    }]), /privacy state is inconsistent/);
  });
});
