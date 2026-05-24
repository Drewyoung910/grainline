import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  ANONYMOUS_CART_KEY,
  addAnonymousCartItem,
} = await import("../src/lib/anonymousCart.ts");
const {
  CART_ADDRESS_KEY,
  CART_CHECKOUTS_KEY,
  CART_RATES_KEY,
  clearCartCheckoutSecrets,
  clearCartSessionStorage,
  readCartSessionJson,
  writeCartSessionJson,
} = await import("../src/lib/cartSessionStorage.ts");
const {
  clearSignedOutLocalAccountState,
} = await import("../src/lib/localAccountState.ts");

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
  title: "Walnut board",
  sellerId: "seller_1",
  sellerName: "North Thread",
  priceCents: 12000,
  listingType: "IN_STOCK",
  currency: "usd",
};

describe("local account state cleanup", () => {
  it("clears legacy checkout session state and address by default", () => {
    const storage = memoryStorage();
    writeCartSessionJson(CART_ADDRESS_KEY, { line1: "1 Main" }, storage);
    writeCartSessionJson(CART_CHECKOUTS_KEY, [{ secret: "cs_test_secret_x" }], storage);
    writeCartSessionJson(CART_RATES_KEY, { seller_1: { objectId: "rate_1" } }, storage);

    assert.equal(clearCartSessionStorage({ storage }), true);

    assert.equal(storage.getItem(CART_ADDRESS_KEY), null);
    assert.equal(storage.getItem(CART_CHECKOUTS_KEY), null);
    assert.equal(storage.getItem(CART_RATES_KEY), null);
  });

  it("clears anonymous cart and all cart session PII on sign-out cleanup", () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    addAnonymousCartItem({ listingId: "listing_1", snapshot }, localStorage);
    writeCartSessionJson(CART_ADDRESS_KEY, { name: "Buyer", line1: "1 Main", phone: "555-0100" }, sessionStorage);
    writeCartSessionJson(CART_CHECKOUTS_KEY, [{ secret: "cs_test_secret_x", sessionId: "cs_test" }], sessionStorage);
    writeCartSessionJson(CART_RATES_KEY, { seller_1: { objectId: "rate_1" } }, sessionStorage);

    clearSignedOutLocalAccountState({
      anonymousCartStorage: localStorage,
      cartSessionStorage: sessionStorage,
    });

    assert.equal(localStorage.getItem(ANONYMOUS_CART_KEY), null);
    assert.equal(sessionStorage.getItem(CART_ADDRESS_KEY), null);
    assert.equal(sessionStorage.getItem(CART_CHECKOUTS_KEY), null);
    assert.equal(sessionStorage.getItem(CART_RATES_KEY), null);
  });

  it("does not persist Stripe client secrets from the cart page", () => {
    const cartPage = readFileSync(new URL("../src/app/cart/page.tsx", import.meta.url), "utf8");

    assert.doesNotMatch(cartPage, /readCartSessionJson<ClientSecretEntry/);
    assert.doesNotMatch(cartPage, /writeCartSessionJson\(CART_CHECKOUTS_KEY/);
    assert.doesNotMatch(cartPage, /sessionStorage\.setItem\(CART_CHECKOUTS_KEY/);
    assert.match(cartPage, /clearCartSessionStorage\(\{ includeAddress: true \}\)/);
  });

  it("does not persist checkout address or selected rates from the cart page", () => {
    const cartPage = readFileSync(new URL("../src/app/cart/page.tsx", import.meta.url), "utf8");

    assert.doesNotMatch(cartPage, /writeCartSessionJson\(CART_ADDRESS_KEY/);
    assert.doesNotMatch(cartPage, /writeCartSessionJson\(CART_RATES_KEY/);
    assert.doesNotMatch(cartPage, /readCartSessionJson<ShippingAddress/);
    assert.doesNotMatch(cartPage, /readCartSessionJson<Record<string, SelectedShippingRate>>/);
    assert.match(cartPage, /LOCAL_ACCOUNT_STATE_CLEARED_EVENT/);
    assert.match(cartPage, /setShippingAddress\(null\)/);
  });

  it("clears cart session state when the authenticated browser user changes", () => {
    const boundary = readFileSync(new URL("../src/components/RecentlyViewedAuthBoundary.tsx", import.meta.url), "utf8");

    assert.match(boundary, /recentlyViewedAuthTransition/);
    assert.match(boundary, /if \(transition\.shouldClear\) clearSignedOutLocalAccountState\(\)/);
    assert.doesNotMatch(boundary, /if \(transition\.shouldClear\) clearRecentlyViewed\(\)/);
  });

  it("can clear legacy persisted checkout secrets without dropping address or rates", () => {
    const storage = memoryStorage();
    writeCartSessionJson(CART_ADDRESS_KEY, { line1: "1 Main" }, storage);
    writeCartSessionJson(CART_CHECKOUTS_KEY, [{ secret: "cs_test_secret_x" }], storage);
    writeCartSessionJson(CART_RATES_KEY, { seller_1: { objectId: "rate_1" } }, storage);

    assert.equal(clearCartCheckoutSecrets(storage), true);

    assert.deepEqual(readCartSessionJson(CART_ADDRESS_KEY, null, storage), { line1: "1 Main" });
    assert.deepEqual(readCartSessionJson(CART_RATES_KEY, null, storage), { seller_1: { objectId: "rate_1" } });
    assert.equal(storage.getItem(CART_CHECKOUTS_KEY), null);
  });
});
