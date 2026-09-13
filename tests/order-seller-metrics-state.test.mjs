import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { orderSellerMetricsFactsFromRows } = await import(
  "../src/lib/orderSellerMetricsState.ts"
);

describe("Order seller metrics authority result validation", () => {
  it("normalizes the one aggregate row without exposing Order data", () => {
    assert.deepEqual(
      orderSellerMetricsFactsFromRows([{
        seller_profile_id: "seller_1",
        completed_order_count: 12n,
        total_sales_cents: "125000",
        shipped_count: 10n,
        on_time_count: 9n,
      }]),
      {
        sellerProfileId: "seller_1",
        completedOrderCount: 12,
        totalSalesCents: 125_000,
        shippedCount: 10,
        onTimeCount: 9,
      },
    );
    assert.equal(orderSellerMetricsFactsFromRows([]), null);
  });

  it("fails closed on cardinality, identity and unsafe counters", () => {
    const valid = {
      seller_profile_id: "seller_1",
      completed_order_count: 1n,
      total_sales_cents: 100n,
      shipped_count: 1n,
      on_time_count: 1n,
    };

    assert.throws(
      () => orderSellerMetricsFactsFromRows([valid, valid]),
      /cardinality is invalid/i,
    );
    assert.throws(
      () => orderSellerMetricsFactsFromRows([{ ...valid, seller_profile_id: " seller_1" }]),
      /seller id is invalid/i,
    );
    assert.throws(
      () => orderSellerMetricsFactsFromRows([{ ...valid, completed_order_count: -1n }]),
      /completed count is invalid/i,
    );
    assert.throws(
      () => orderSellerMetricsFactsFromRows([{ ...valid, total_sales_cents: "1.5" }]),
      /sales is invalid/i,
    );
    assert.throws(
      () => orderSellerMetricsFactsFromRows([{ ...valid, shipped_count: 1n, on_time_count: 2n }]),
      /shipping counts are inconsistent/i,
    );
  });
});
