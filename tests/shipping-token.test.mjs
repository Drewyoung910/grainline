import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

process.env.SHIPPING_RATE_SECRET = "test-shipping-rate-secret";

const { shippingRateExpiresAtIsTooFarFuture, signRate, verifyRate } = await import("../src/lib/shipping-token.ts");

const fields = {
  objectId: "rate_123",
  amountCents: 1299,
  currency: "usd",
  displayName: "Ground",
  carrier: "USPS",
  estDays: 3,
  contextId: "seller_123",
  buyerId: "user_123",
  buyerPostal: "78701",
};

describe("shipping rate tokens", () => {
  it("verifies a token signed for the same buyer and rate fields", () => {
    const signed = signRate(fields, 60);

    assert.deepEqual(verifyRate(fields, signed.token, signed.expiresAt), { ok: true });
  });

  it("rejects replay by a different buyer", () => {
    const signed = signRate(fields, 60);

    assert.equal(
      verifyRate({ ...fields, buyerId: "user_456" }, signed.token, signed.expiresAt).ok,
      false,
    );
  });

  it("rejects tampered amount, currency, context, and postal-code fields", () => {
    const signed = signRate(fields, 60);

    assert.equal(
      verifyRate({ ...fields, amountCents: 1300 }, signed.token, signed.expiresAt).ok,
      false,
    );
    assert.equal(
      verifyRate({ ...fields, currency: "eur" }, signed.token, signed.expiresAt).ok,
      false,
    );
    assert.equal(
      verifyRate({ ...fields, contextId: "seller_456" }, signed.token, signed.expiresAt).ok,
      false,
    );
    assert.equal(
      verifyRate({ ...fields, buyerPostal: "10001" }, signed.token, signed.expiresAt).ok,
      false,
    );
  });

  it("uses unambiguous JSON-array canonicalization for display names with separators", () => {
    const source = readFileSync("src/lib/shipping-token.ts", "utf8");
    const signed = signRate({ ...fields, displayName: "Ground: Priority" }, 60);

    assert.deepEqual(verifyRate({ ...fields, displayName: "Ground: Priority" }, signed.token, signed.expiresAt), { ok: true });
    assert.equal(verifyRate({ ...fields, displayName: "Ground" }, signed.token, signed.expiresAt).ok, false);
    assert.match(source, /JSON\.stringify\(\[/);
    assert.match(source, /currency\.toLowerCase\(\)/);
    assert.doesNotMatch(source, /\.join\(":"\)/);
  });

  it("rejects expired or malformed tokens", () => {
    const expired = signRate(fields, -1);

    assert.deepEqual(verifyRate(fields, expired.token, expired.expiresAt), {
      ok: false,
      error: "Shipping rates have expired. Please go back and re-select a shipping option.",
      status: 422,
    });
    assert.deepEqual(verifyRate(fields, "not-hex", Math.floor(Date.now() / 1000) + 60), {
      ok: false,
      error: "Invalid shipping rate.",
      status: 400,
    });
  });

  it("rejects shipping rate expiries beyond the signed-rate lifetime", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    assert.equal(shippingRateExpiresAtIsTooFarFuture(nowSeconds + 60 * 60, nowSeconds), true);

    assert.deepEqual(
      verifyRate(fields, "0".repeat(64), nowSeconds + 60 * 60, nowSeconds),
      {
        ok: false,
        error: "Invalid shipping rate.",
        status: 400,
      },
    );
  });

  it("rejects excessive future shipping rate expiry at checkout schema boundaries", () => {
    const sellerCheckout = readFileSync("src/app/api/cart/checkout-seller/route.ts", "utf8");
    const singleCheckout = readFileSync("src/app/api/cart/checkout/single/route.ts", "utf8");

    for (const source of [sellerCheckout, singleCheckout]) {
      assert.match(source, /shippingRateExpiresAtIsTooFarFuture/);
      assert.match(source, /expiresAt: z\.number\(\)\.int\(\)\.min\(0\)\.refine/);
      assert.doesNotMatch(source, /expiresAt: z\.number\(\)\.int\(\)\.min\(0\),/);
    }
  });

  it("binds checkout shipping rates to the server-derived listing currency", () => {
    const sellerCheckout = readFileSync("src/app/api/cart/checkout-seller/route.ts", "utf8");
    const singleCheckout = readFileSync("src/app/api/cart/checkout/single/route.ts", "utf8");
    const quoteRoute = readFileSync("src/app/api/shipping/quote/route.ts", "utf8");
    const selector = readFileSync("src/components/ShippingRateSelector.tsx", "utf8");

    for (const source of [sellerCheckout, singleCheckout]) {
      assert.match(source, /currency: z\.string\(\)\.length\(3\)/);
      assert.match(source, /body\.selectedRate\.currency\.toLowerCase\(\) !== currency/);
      assert.match(source, /currency,/);
      assert.doesNotMatch(source, /body\.selectedRate\.currency,/);
    }

    assert.match(quoteRoute, /let currency = DEFAULT_CURRENCY/);
    assert.match(quoteRoute, /currency = \(cart\.items\[0\]\.listing\.currency \|\| DEFAULT_CURRENCY\)\.toLowerCase\(\)/);
    assert.match(quoteRoute, /currency = \(listing\.currency \|\| DEFAULT_CURRENCY\)\.toLowerCase\(\)/);
    assert.match(quoteRoute, /mixedCurrencyItem/);
    assert.doesNotMatch(quoteRoute, /const currency = \(body\.currency/);
    assert.match(selector, /currency: \(r\.currency \?\? DEFAULT_CURRENCY\)\.toLowerCase\(\)/);
  });

  it("rechecks local pickup availability at checkout after token verification", () => {
    const sellerCheckout = readFileSync("src/app/api/cart/checkout-seller/route.ts", "utf8");
    const singleCheckout = readFileSync("src/app/api/cart/checkout/single/route.ts", "utf8");
    const shippingState = readFileSync("src/lib/shippingQuoteState.ts", "utf8");

    assert.match(shippingState, /export const PICKUP_RATE_OBJECT_ID = "pickup"/);
    assert.match(shippingState, /export function isPickupRateObjectId/);

    for (const source of [sellerCheckout, singleCheckout]) {
      assert.match(source, /import \{ isPickupRateObjectId \} from "@\/lib\/shippingQuoteState"/);
      assert.match(source, /if \(isPickupRateObjectId\(body\.selectedRate\.objectId\) && !/);
      assert.match(source, /Local pickup is no longer available for this seller/);
    }

    assert.match(singleCheckout, /allowLocalPickup: true/);
    assert.match(sellerCheckout, /sellerItems\[0\]\.listing\.seller\.allowLocalPickup/);
  });
});
