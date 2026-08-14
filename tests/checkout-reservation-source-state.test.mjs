import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cartCheckoutReservationSourceSignature,
  cartCheckoutReservationSourceWitness,
  checkoutReservationInventorySourceMatches,
  CheckoutReservationSourceChangedError,
  singleCheckoutReservationSourceSignature,
  singleCheckoutReservationSourceWitness,
} from "../src/lib/checkoutReservationSourceState.ts";

function seller(overrides = {}) {
  return {
    id: "seller-a",
    userId: "seller-user",
    displayName: "Oak Shop",
    stripeAccountId: "acct_123",
    stripeAccountVersion: "v2",
    chargesEnabled: true,
    vacationMode: false,
    acceptingNewOrders: true,
    allowLocalPickup: true,
    offersGiftWrapping: true,
    giftWrappingPriceCents: 500,
    defaultPkgWeightGrams: 1000,
    defaultPkgLengthCm: 30,
    defaultPkgWidthCm: 20,
    defaultPkgHeightCm: 10,
    user: { banned: false, deletedAt: null },
    ...overrides,
  };
}

function listing(id, overrides = {}) {
  return {
    id,
    sellerId: "seller-a",
    title: `Listing ${id}`,
    priceCents: 10_000,
    priceVersion: 3,
    currency: "USD",
    status: "ACTIVE",
    listingType: "IN_STOCK",
    isPrivate: false,
    reservedForUserId: null,
    packagedWeightGrams: 900,
    packagedLengthCm: 25,
    packagedWidthCm: 15,
    packagedHeightCm: 5,
    photos: [{ url: `https://cdn.example/${id}.jpg` }],
    seller: seller(),
    variantGroups: [{
      id: `${id}-wood`,
      name: "Wood",
      options: [
        { id: `${id}-oak`, label: "Oak", priceAdjustCents: 0, inStock: true },
        { id: `${id}-walnut`, label: "Walnut", priceAdjustCents: 1200, inStock: true },
      ],
    }],
    ...overrides,
  };
}

function cartItem(id, listingId, overrides = {}) {
  const sourceListing = listing(listingId);
  return {
    id,
    listingId,
    quantity: 2,
    priceCents: 11_200,
    priceVersion: 3,
    selectedVariantOptionIds: [`${listingId}-walnut`],
    listing: sourceListing,
    ...overrides,
  };
}

describe("checkout reservation source state", () => {
  it("produces one stable cart signature independent of item query order", () => {
    const first = cartItem("cart-b", "listing-b");
    const second = cartItem("cart-a", "listing-a");
    assert.equal(
      cartCheckoutReservationSourceSignature("buyer", "seller-a", [first, second]),
      cartCheckoutReservationSourceSignature("buyer", "seller-a", [second, first]),
    );
  });

  it("produces a stable raw witness with canonical full variant ordering", () => {
    const first = cartItem("cart-b", "listing-b");
    const second = cartItem("cart-a", "listing-a");
    assert.equal(
      cartCheckoutReservationSourceWitness("buyer", "seller-a", [first, second]),
      cartCheckoutReservationSourceWitness("buyer", "seller-a", [second, first]),
    );

    const sourceListing = listing("listing-a");
    const baseline = singleCheckoutReservationSourceWitness(
      "buyer",
      sourceListing,
      1,
      ["listing-a-walnut"],
    );
    const reordered = {
      ...sourceListing,
      variantGroups: sourceListing.variantGroups.map((group) => ({
        ...group,
        options: [...group.options].reverse(),
      })),
    };
    assert.equal(
      singleCheckoutReservationSourceWitness("buyer", reordered, 1, ["listing-a-walnut"]),
      baseline,
    );
    assert.notEqual(
      singleCheckoutReservationSourceWitness("buyer", {
        ...sourceListing,
        variantGroups: sourceListing.variantGroups.map((group) => ({
          ...group,
          options: [...group.options, {
            id: "listing-a-maple",
            label: "Maple",
            priceAdjustCents: 500,
            inStock: true,
          }],
        })),
      }, 1, ["listing-a-walnut"]),
      baseline,
    );
  });

  it("keeps the legitimate 50-item maximum below the bounded database witness size", () => {
    const fixedId = (prefix, index) => `${prefix}-${index}`.padEnd(191, "x");
    const items = Array.from({ length: 50 }, (_, itemIndex) => {
      const listingId = fixedId("listing", itemIndex);
      const groups = Array.from({ length: 3 }, (_, groupIndex) => {
        const groupId = fixedId(`group-${itemIndex}`, groupIndex);
        return {
          id: groupId,
          name: "G".repeat(100),
          options: Array.from({ length: 10 }, (_, optionIndex) => ({
            id: fixedId(`option-${itemIndex}-${groupIndex}`, optionIndex),
            label: "O".repeat(100),
            priceAdjustCents: 0,
            inStock: true,
          })),
        };
      });
      const sourceListing = listing(listingId, {
        title: "T".repeat(150),
        photos: [{ url: `https://cdn.example/${"p".repeat(2028)}` }],
        variantGroups: groups,
      });
      return {
        id: fixedId("cart-item", itemIndex),
        listingId,
        quantity: 1,
        priceCents: 10_000,
        priceVersion: 3,
        selectedVariantOptionIds: groups.map((group) => group.options[0].id),
        listing: sourceListing,
      };
    });
    const witness = cartCheckoutReservationSourceWitness("buyer", "seller-a", items);
    assert.ok(witness);
    const bytes = Buffer.byteLength(witness, "utf8");
    assert.ok(bytes > 262_144, "the old 256 KiB bound must remain recognized as too small");
    assert.ok(bytes < 1_048_576, "the maximum legitimate cart must fit the 1 MiB bound");
  });

  it("binds price, version, variant, quantity, currency, media and shipping source", () => {
    const source = cartItem("cart-a", "listing-a");
    const baseline = cartCheckoutReservationSourceSignature("buyer", "seller-a", [source]);
    assert.ok(baseline);

    for (const changed of [
      { ...source, quantity: 1 },
      { ...source, selectedVariantOptionIds: ["listing-a-oak"], priceCents: 10_000 },
      { ...source, listing: { ...source.listing, priceVersion: 4 }, priceVersion: 4 },
      { ...source, listing: { ...source.listing, currency: "cad" } },
      { ...source, listing: { ...source.listing, title: "Changed title" } },
      { ...source, listing: { ...source.listing, photos: [{ url: "https://cdn.example/new.jpg" }] } },
      { ...source, listing: { ...source.listing, packagedWeightGrams: 901 } },
    ]) {
      assert.notEqual(
        cartCheckoutReservationSourceSignature("buyer", "seller-a", [changed]),
        baseline,
      );
    }
  });

  it("binds payout and seller-provided checkout settings", () => {
    const source = cartItem("cart-a", "listing-a");
    const baseline = cartCheckoutReservationSourceSignature("buyer", "seller-a", [source]);
    for (const sellerChange of [
      { stripeAccountId: "acct_other" },
      { giftWrappingPriceCents: 700 },
      { allowLocalPickup: false },
      { displayName: "Renamed Shop" },
    ]) {
      const changedListing = {
        ...source.listing,
        seller: seller(sellerChange),
      };
      assert.notEqual(
        cartCheckoutReservationSourceSignature("buyer", "seller-a", [{ ...source, listing: changedListing }]),
        baseline,
      );
    }
    const fallbackListing = { ...source.listing, packagedLengthCm: null };
    assert.notEqual(
      cartCheckoutReservationSourceSignature("buyer", "seller-a", [{
        ...source,
        listing: { ...fallbackListing, seller: seller({ defaultPkgLengthCm: 31 }) },
      }]),
      cartCheckoutReservationSourceSignature("buyer", "seller-a", [{ ...source, listing: fallbackListing }]),
    );
  });

  it("fails closed for stale price rows and unavailable actors or listings", () => {
    const source = cartItem("cart-a", "listing-a");
    assert.equal(
      cartCheckoutReservationSourceSignature("buyer", "seller-a", [{ ...source, priceCents: 99 }]),
      null,
    );
    assert.equal(
      cartCheckoutReservationSourceSignature("buyer", "seller-a", [{
        ...source,
        listing: { ...source.listing, status: "HIDDEN" },
      }]),
      null,
    );
    assert.equal(
      cartCheckoutReservationSourceSignature("seller-user", "seller-a", [source]),
      null,
    );
    assert.equal(
      cartCheckoutReservationSourceSignature("buyer", "seller-a", [{
        ...source,
        listing: { ...source.listing, seller: seller({ chargesEnabled: false }) },
      }]),
      null,
    );
  });

  it("derives and binds the Buy Now variant price", () => {
    const sourceListing = listing("listing-a");
    const walnut = singleCheckoutReservationSourceSignature(
      "buyer",
      sourceListing,
      1,
      ["listing-a-walnut"],
    );
    const oak = singleCheckoutReservationSourceSignature(
      "buyer",
      sourceListing,
      1,
      ["listing-a-oak"],
    );
    assert.ok(walnut);
    assert.ok(oak);
    assert.notEqual(walnut, oak);
    assert.equal(
      singleCheckoutReservationSourceSignature("buyer", sourceListing, 1, ["unknown"]),
      null,
    );
  });

  it("checks the exact inventory set independently of pricing", () => {
    assert.equal(checkoutReservationInventorySourceMatches(
      [{ listingId: "listing-a", sellerId: "seller-a", quantity: 3 }],
      [
        { listingId: "listing-a", sellerId: "seller-a", quantity: 1 },
        { listingId: "listing-a", sellerId: "seller-a", quantity: 2 },
      ],
    ), true);
    assert.equal(checkoutReservationInventorySourceMatches(
      [{ listingId: "listing-a", sellerId: "seller-a", quantity: 2 }],
      [{ listingId: "listing-a", sellerId: "seller-a", quantity: 1 }],
    ), false);
    assert.equal(checkoutReservationInventorySourceMatches([], []), true);
  });

  it("uses a specific rollback sentinel for source drift", () => {
    const error = new CheckoutReservationSourceChangedError();
    assert.equal(error.name, "CheckoutReservationSourceChangedError");
  });
});
