import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fulfilledOrderCountFromRows,
  publicListingOrderCountsFromRows,
  publicMarketplaceListingMetricsFromRows,
  publicSellerOrderStatsFromRows,
} from "../src/lib/orderPublicAggregateState.ts";

describe("Order public aggregate authority state", () => {
  it("parses exact public count, seller, listing and marketplace aggregates", () => {
    assert.equal(fulfilledOrderCountFromRows([{ value: 12n }]), 12);
    assert.deepEqual(
      publicSellerOrderStatsFromRows([{
        sold_count: 9n,
        shipped_count: 4n,
        avg_ship_days: 2.75,
      }]),
      { soldCount: 9, shippedCount: 4, avgShipDays: 2.75 },
    );
    assert.deepEqual(
      [...publicListingOrderCountsFromRows([
        { listing_id: "listing-a", order_count: 3n },
        { listing_id: "listing-b", order_count: 0n },
      ])],
      [["listing-a", 3n], ["listing-b", 0n]],
    );
    assert.deepEqual(
      publicMarketplaceListingMetricsFromRows([{
        total_views: 100n,
        total_clicks: 25n,
        total_orders: 4n,
      }]),
      { totalViews: 100, totalClicks: 25, totalOrders: 4 },
    );
  });

  it("distinguishes hidden sellers and rejects malformed or duplicated rows", () => {
    assert.equal(publicSellerOrderStatsFromRows([]), null);
    assert.throws(() => fulfilledOrderCountFromRows([]), /invalid/i);
    assert.throws(
      () => publicSellerOrderStatsFromRows([{
        sold_count: -1n,
        shipped_count: 0n,
        avg_ship_days: null,
      }]),
      /invalid/i,
    );
    assert.throws(
      () => publicListingOrderCountsFromRows([
        { listing_id: "listing-a", order_count: 1n },
        { listing_id: "listing-a", order_count: 2n },
      ]),
      /invalid/i,
    );
    assert.throws(
      () => publicMarketplaceListingMetricsFromRows([{
        total_views: Number.POSITIVE_INFINITY,
        total_clicks: 0,
        total_orders: 0,
      }]),
      /invalid/i,
    );
  });
});
