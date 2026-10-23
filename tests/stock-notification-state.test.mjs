import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  stockNotificationAvailable,
  stockNotificationSubscribedFromResponse,
} = await import("../src/lib/stockNotificationState.ts");

function listing(overrides = {}) {
  return {
    status: "ACTIVE",
    listingType: "IN_STOCK",
    stockQuantity: 0,
    isPrivate: false,
    publicListingDetail: true,
    ...overrides,
  };
}

describe("stock notification response state", () => {
  it("offers a listing-level alert for a public sold-out in-stock listing", () => {
    assert.equal(stockNotificationAvailable(listing({ status: "SOLD_OUT" })), true);
    assert.equal(stockNotificationAvailable(listing()), true);
  });

  it("refuses alerts for private, draft, hidden, made-to-order, and stock-positive listings", () => {
    assert.equal(stockNotificationAvailable(listing({ isPrivate: true, publicListingDetail: false })), false);
    assert.equal(stockNotificationAvailable(listing({ status: "DRAFT", publicListingDetail: false })), false);
    assert.equal(stockNotificationAvailable(listing({ status: "HIDDEN", publicListingDetail: false })), false);
    assert.equal(stockNotificationAvailable(listing({ listingType: "MADE_TO_ORDER", stockQuantity: null })), false);
    assert.equal(stockNotificationAvailable(listing({ stockQuantity: 1 })), false);
    assert.equal(stockNotificationAvailable(listing({ status: "SOLD_OUT", stockQuantity: 1 })), false);
  });

  it("trusts the server subscription state when present", () => {
    assert.equal(stockNotificationSubscribedFromResponse({ subscribed: true }, false), true);
    assert.equal(stockNotificationSubscribedFromResponse({ subscribed: false }, true), false);
  });

  it("falls back to the optimistic state for malformed legacy responses", () => {
    assert.equal(stockNotificationSubscribedFromResponse({}, true), true);
    assert.equal(stockNotificationSubscribedFromResponse(null, false), false);
  });
});
