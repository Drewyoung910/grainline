import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  LOW_STOCK_DEDUP_WINDOW_MS,
  cartItemExceedsLiveStock,
  lowStockNotificationLink,
  nextManualStockQuantity,
  stockAlertBody,
  stockStatusAfterManualUpdate,
} = await import("../src/lib/stockMutationState.ts");

describe("stock mutation state", () => {
  it("applies manual stock changes as deltas when the client sends its expected baseline", () => {
    assert.equal(
      nextManualStockQuantity({ currentQuantity: 2, expectedQuantity: 5, requestedQuantity: 10 }),
      7,
    );
    assert.equal(
      nextManualStockQuantity({ currentQuantity: 2, expectedQuantity: 5, requestedQuantity: 0 }),
      0,
    );
  });

  it("keeps legacy absolute stock semantics when no expected baseline is provided", () => {
    assert.equal(nextManualStockQuantity({ currentQuantity: 2, requestedQuantity: 10 }), 10);
  });

  it("derives listing status from actual post-update stock and prior visibility", () => {
    assert.equal(stockStatusAfterManualUpdate({ previousStatus: "ACTIVE", nextQuantity: 0 }), "SOLD_OUT");
    assert.equal(stockStatusAfterManualUpdate({ previousStatus: "SOLD_OUT", nextQuantity: 3 }), "ACTIVE");
    assert.equal(
      stockStatusAfterManualUpdate({ previousStatus: "SOLD_OUT", nextQuantity: 3, isPrivate: true }),
      "SOLD_OUT",
    );
    assert.equal(stockStatusAfterManualUpdate({ previousStatus: "HIDDEN", nextQuantity: 3 }), "HIDDEN");
  });

  it("keeps cart stock overage checks tied to live stock at render/checkout time", () => {
    assert.equal(cartItemExceedsLiveStock({ listingType: "IN_STOCK", quantity: 3, stockQuantity: 2 }), true);
    assert.equal(cartItemExceedsLiveStock({ listingType: "IN_STOCK", quantity: 2, stockQuantity: 2 }), false);
    assert.equal(cartItemExceedsLiveStock({ listingType: "MADE_TO_ORDER", quantity: 3, stockQuantity: 0 }), false);
  });

  it("includes current stock in back-in-stock notifications", () => {
    assert.match(stockAlertBody(4), /Current stock: 4/);
    assert.match(stockAlertBody(0), /Check the listing/);
  });

  it("dedupes low-stock notifications per listing over a rolling multi-day window", () => {
    assert.equal(LOW_STOCK_DEDUP_WINDOW_MS, 72 * 60 * 60 * 1000);
    assert.equal(lowStockNotificationLink("listing_123"), "/dashboard/listings/listing_123/edit");
  });
});
