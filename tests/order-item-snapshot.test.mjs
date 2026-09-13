import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkoutShippingPackageMetadata,
  historicalProcessingTimeDays,
  readCheckoutShippingPackageMetadata,
  readHistoricalOrderItemSnapshot,
} from "../src/lib/orderItemSnapshot.ts";

describe("historical OrderItem snapshots", () => {
  it("round-trips only a complete bounded checkout package through provider metadata", () => {
    const metadata = checkoutShippingPackageMetadata({
      shippingWeightGrams: 2500,
      shippingLengthCm: 80.5,
      shippingWidthCm: 50,
      shippingHeightCm: 20,
    });
    assert.deepEqual(readCheckoutShippingPackageMetadata(metadata), {
      shippingWeightGrams: 2500,
      shippingLengthCm: 80.5,
      shippingWidthCm: 50,
      shippingHeightCm: 20,
      shippingPackageComplete: true,
    });
    assert.deepEqual(
      checkoutShippingPackageMetadata({ shippingWeightGrams: 2500 }),
      { shippingPackageComplete: "false" },
    );
    assert.deepEqual(readCheckoutShippingPackageMetadata({
      ...metadata,
      shippingLengthCm: "1001",
    }), {
      shippingWeightGrams: null,
      shippingLengthCm: null,
      shippingWidthCm: null,
      shippingHeightCm: null,
      shippingPackageComplete: false,
    });
  });

  it("returns bounded checkout-time facts without consulting a live Listing", () => {
    const snapshot = readHistoricalOrderItemSnapshot({
      title: "Walnut desk",
      description: "Built to order",
      priceCents: 125000,
      imageUrls: ["https://cdn.example.test/desk.jpg"],
      category: "FURNITURE",
      tags: ["walnut"],
      sellerName: "Grain & Co.",
      capturedAt: "2026-08-31T20:00:00.000Z",
      listingType: "MADE_TO_ORDER",
      processingTimeMinDays: 14,
      processingTimeMaxDays: 21,
      shipsWithinDays: null,
      shippingWeightGrams: 2500,
      shippingLengthCm: 80,
      shippingWidthCm: 50,
      shippingHeightCm: 20,
    }, 1);

    assert.equal(snapshot.complete, true);
    assert.equal(snapshot.title, "Walnut desk");
    assert.equal(snapshot.priceCents, 125000);
    assert.equal(snapshot.shippingPackageComplete, true);
    assert.equal(snapshot.shippingWeightGrams, 2500);
    assert.deepEqual(historicalProcessingTimeDays(snapshot), { min: 14, max: 21 });
  });

  it("uses same-day processing bounds for an in-stock snapshot", () => {
    const snapshot = readHistoricalOrderItemSnapshot({
      title: "Bowl",
      description: "",
      priceCents: 9000,
      imageUrls: [],
      category: null,
      tags: [],
      sellerName: "Maker",
      capturedAt: null,
      listingType: "IN_STOCK",
      processingTimeMinDays: null,
      processingTimeMaxDays: null,
      shipsWithinDays: 2,
    }, 1);

    assert.deepEqual(historicalProcessingTimeDays(snapshot), { min: 2, max: 2 });
  });

  it("fails closed to generic retained facts for malformed snapshots", () => {
    const snapshot = readHistoricalOrderItemSnapshot({
      title: "",
      priceCents: -1,
      imageUrls: [7],
      tags: [],
      sellerName: "Maker",
    }, 4200);

    assert.deepEqual(snapshot, {
      title: "Purchased item",
      description: null,
      priceCents: 4200,
      imageUrls: [],
      category: null,
      tags: [],
      sellerName: "Maker",
      capturedAt: null,
      listingType: null,
      processingTimeMinDays: null,
      processingTimeMaxDays: null,
      shipsWithinDays: null,
      shippingWeightGrams: null,
      shippingLengthCm: null,
      shippingWidthCm: null,
      shippingHeightCm: null,
      shippingPackageComplete: false,
      complete: false,
    });
  });

  it("rejects oversized arrays and does not partially trust them", () => {
    const snapshot = readHistoricalOrderItemSnapshot({
      title: "Chair",
      priceCents: 100,
      imageUrls: Array.from({ length: 25 }, (_, index) => `https://x.test/${index}`),
      tags: [],
      sellerName: "Maker",
    }, 100);
    assert.equal(snapshot.complete, false);
    assert.deepEqual(snapshot.imageUrls, []);
  });
});
