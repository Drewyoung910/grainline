import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkoutReservationSourceMatches,
} from "../src/lib/checkoutReservationSourceState.ts";

describe("checkout reservation source matching", () => {
  it("accepts the same source independent of order", () => {
    assert.equal(checkoutReservationSourceMatches(
      [
        { listingId: "listing-b", sellerId: "seller-a", quantity: 1 },
        { listingId: "listing-a", sellerId: "seller-a", quantity: 2 },
      ],
      [
        { listingId: "listing-a", sellerId: "seller-a", quantity: 2 },
        { listingId: "listing-b", sellerId: "seller-a", quantity: 1 },
      ],
    ), true);
  });

  it("collapses variant cart lines to listing-level inventory", () => {
    assert.equal(checkoutReservationSourceMatches(
      [{ listingId: "listing-a", sellerId: "seller-a", quantity: 3 }],
      [
        { listingId: "listing-a", sellerId: "seller-a", quantity: 1 },
        { listingId: "listing-a", sellerId: "seller-a", quantity: 2 },
      ],
    ), true);
  });

  it("rejects quantity, listing, seller and inventory-type drift", () => {
    const source = [{ listingId: "listing-a", sellerId: "seller-a", quantity: 2 }];
    assert.equal(checkoutReservationSourceMatches(source, [
      { listingId: "listing-a", sellerId: "seller-a", quantity: 1 },
    ]), false);
    assert.equal(checkoutReservationSourceMatches(source, [
      { listingId: "listing-b", sellerId: "seller-a", quantity: 2 },
    ]), false);
    assert.equal(checkoutReservationSourceMatches(source, [
      { listingId: "listing-a", sellerId: "seller-b", quantity: 2 },
    ]), false);
    assert.equal(checkoutReservationSourceMatches([], source), false);
    assert.equal(checkoutReservationSourceMatches(source, []), false);
  });

  it("accepts the intentional made-to-order empty source only on both sides", () => {
    assert.equal(checkoutReservationSourceMatches([], []), true);
  });

  it("fails closed on malformed or overflowing inputs", () => {
    assert.equal(checkoutReservationSourceMatches(
      [{ listingId: "", sellerId: "seller-a", quantity: 1 }],
      [],
    ), false);
    assert.equal(checkoutReservationSourceMatches(
      [{ listingId: "listing-a", sellerId: "seller-a", quantity: 0 }],
      [],
    ), false);
    assert.equal(checkoutReservationSourceMatches(
      [
        { listingId: "listing-a", sellerId: "seller-a", quantity: Number.MAX_SAFE_INTEGER },
        { listingId: "listing-a", sellerId: "seller-a", quantity: 1 },
      ],
      [],
    ), false);
  });
});
