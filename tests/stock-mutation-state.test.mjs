import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  LOW_STOCK_DEDUP_WINDOW_MS,
  MAX_MANUAL_STOCK_QUANTITY,
  cartItemExceedsLiveStock,
  lowStockNotificationLink,
  nextManualStockQuantity,
  normalizeManualStockQuantity,
  stockAlertBody,
  stockStatusAfterManualUpdate,
} = await import("../src/lib/stockMutationState.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

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

  it("caps manual stock values before they reach Prisma Int writes", () => {
    assert.equal(normalizeManualStockQuantity(1_000_001), MAX_MANUAL_STOCK_QUANTITY);
    assert.equal(normalizeManualStockQuantity(Number.POSITIVE_INFINITY), 0);
    assert.equal(
      nextManualStockQuantity({
        currentQuantity: MAX_MANUAL_STOCK_QUANTITY,
        expectedQuantity: 0,
        requestedQuantity: 50,
      }),
      MAX_MANUAL_STOCK_QUANTITY,
    );
  });

  it("keeps manual stock caps on API and listing form inputs", () => {
    const stockRoute = source("src/app/api/listings/[id]/stock/route.ts");
    const listingTypeFields = source("src/components/ListingTypeFields.tsx");
    const createListing = source("src/app/dashboard/listings/new/page.tsx");
    const editListing = source("src/app/dashboard/listings/[id]/edit/page.tsx");
    const customListing = source("src/app/dashboard/listings/custom/page.tsx");

    assert.match(stockRoute, /quantity: z\.number\(\)\.int\(\)\.min\(0\)\.max\(MAX_MANUAL_STOCK_QUANTITY\)/);
    assert.match(stockRoute, /expectedQuantity: z\.number\(\)\.int\(\)\.min\(0\)\.max\(MAX_MANUAL_STOCK_QUANTITY\)/);
    assert.match(listingTypeFields, /name="stockQuantity"[\s\S]*?max=\{MAX_MANUAL_STOCK_QUANTITY\}/);
    for (const text of [createListing, editListing, customListing]) {
      assert.match(text, /stockQuantity !== null && stockQuantity > MAX_MANUAL_STOCK_QUANTITY/);
    }
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

  it("rechecks public seller state before claiming back-in-stock subscribers", () => {
    const stockRoute = source("src/app/api/listings/[id]/stock/route.ts");
    const fanoutSql = stockRoute.slice(
      stockRoute.indexOf("WITH available_listing AS"),
      stockRoute.indexOf("next_subscribers AS"),
    );

    assert.match(fanoutSql, /INNER JOIN "SellerProfile" sp ON sp\.id = l\."sellerId"/);
    assert.match(fanoutSql, /INNER JOIN "User" u ON u\.id = sp\."userId"/);
    assert.match(fanoutSql, /l\.status = 'ACTIVE'::"ListingStatus"/);
    assert.match(fanoutSql, /l\."isPrivate" = false/);
    assert.match(fanoutSql, /COALESCE\(l\."stockQuantity", 0\) > 0/);
    assert.match(fanoutSql, /sp\."chargesEnabled" = true/);
    assert.match(fanoutSql, /sp\."stripeAccountVersion" IS NULL OR sp\."stripeAccountVersion" = 'v2'/);
    assert.match(fanoutSql, /sp\."vacationMode" = false/);
    assert.match(fanoutSql, /u\.banned = false/);
    assert.match(fanoutSql, /u\."deletedAt" IS NULL/);
  });

  it("dedupes low-stock notifications per listing over a rolling multi-day window", () => {
    assert.equal(LOW_STOCK_DEDUP_WINDOW_MS, 72 * 60 * 60 * 1000);
    assert.equal(lowStockNotificationLink("listing_123"), "/dashboard/listings/listing_123/edit");
  });
});
