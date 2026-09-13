import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  ANONYMOUS_CART_KEY,
  addAnonymousCartItem,
  anonymousCartCount,
  anonymousCartLineKey,
  readAnonymousCartItems,
  updateAnonymousCartItem,
} = await import("../src/lib/anonymousCart.ts");

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

const snapshot = {
  title: "Linen jacket",
  sellerId: "seller_1",
  sellerName: "North Thread",
  priceCents: 12000,
  imageUrl: "https://example.com/jacket.jpg",
  variantLabels: ["Size: M"],
  listingType: "IN_STOCK",
  currency: "usd",
};

describe("anonymous cart", () => {
  it("merges repeated adds by listing and normalized variant key", () => {
    const storage = memoryStorage();
    addAnonymousCartItem({
      listingId: "listing_1",
      quantity: 2,
      selectedVariantOptionIds: ["b", "a", "a"],
      snapshot,
    }, storage);
    addAnonymousCartItem({
      listingId: "listing_1",
      quantity: 3,
      selectedVariantOptionIds: ["a", "b"],
      snapshot,
    }, storage);

    const items = readAnonymousCartItems(storage);
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 5);
    assert.equal(items[0].lineKey, anonymousCartLineKey("listing_1", ["a", "b"]));
    assert.deepEqual(items[0].selectedVariantOptionIds, ["a", "b"]);
    assert.equal(anonymousCartCount(storage), 5);
  });

  it("caps quantity and keeps made-to-order items at one", () => {
    const storage = memoryStorage();
    addAnonymousCartItem({ listingId: "listing_1", quantity: 200, snapshot }, storage);
    addAnonymousCartItem({
      listingId: "listing_2",
      quantity: 4,
      snapshot: { ...snapshot, listingType: "MADE_TO_ORDER" },
    }, storage);

    const items = readAnonymousCartItems(storage);
    assert.equal(items.find((item) => item.listingId === "listing_1")?.quantity, 99);
    assert.equal(items.find((item) => item.listingId === "listing_2")?.quantity, 1);
  });

  it("drops malformed stored rows instead of crashing", () => {
    const storage = memoryStorage();
    storage.setItem(ANONYMOUS_CART_KEY, JSON.stringify([
      { listingId: "listing_1", quantity: 1, snapshot },
      { listingId: "", quantity: 1, snapshot },
      { listingId: "listing_2", quantity: 1, snapshot: { title: "Missing seller" } },
    ]));

    const items = readAnonymousCartItems(storage);
    assert.equal(items.length, 1);
    assert.equal(items[0].listingId, "listing_1");
  });

  it("updates and removes stored lines", () => {
    const storage = memoryStorage();
    const result = addAnonymousCartItem({ listingId: "listing_1", quantity: 2, snapshot }, storage);
    assert.equal(result.ok, true);

    const updated = updateAnonymousCartItem(result.item.lineKey, 7, storage);
    assert.equal(updated.items[0].quantity, 7);

    const removed = updateAnonymousCartItem(result.item.lineKey, 0, storage);
    assert.deepEqual(removed.items, []);
  });
});
