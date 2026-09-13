import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const currentSecret = "test-shipping-rate-secret";
process.env.SHIPPING_RATE_SECRET = currentSecret;
delete process.env.SHIPPING_RATE_SECRET_PREVIOUS;

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
  buyerCity: "Austin",
  buyerState: "TX",
  buyerPostal: "78701",
  buyerCountry: "US",
};

function legacyToken(secret, value, expiresAt) {
  const input = JSON.stringify([
    value.objectId,
    value.amountCents,
    value.currency.toLowerCase(),
    value.displayName,
    value.carrier,
    value.estDays,
    value.contextId,
    value.buyerId,
    value.buyerPostal,
    value.subjectHash ?? "",
    expiresAt,
  ]);
  return createHmac("sha256", secret).update(input).digest("hex");
}

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

  it("rejects tampered amount, currency, context, and destination fields", () => {
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
    assert.equal(
      verifyRate({ ...fields, buyerCity: "Dallas" }, signed.token, signed.expiresAt).ok,
      false,
    );
    assert.equal(
      verifyRate({ ...fields, buyerState: "NY" }, signed.token, signed.expiresAt).ok,
      false,
    );
    assert.equal(
      verifyRate({ ...fields, buyerCountry: "CA" }, signed.token, signed.expiresAt).ok,
      false,
    );
  });

  it("normalizes non-semantic destination casing and whitespace", () => {
    const signed = signRate(fields, 60);

    assert.deepEqual(
      verifyRate(
        {
          ...fields,
          buyerCity: "  AUSTIN  ",
          buyerState: "tx",
          buyerPostal: "78701",
          buyerCountry: "us",
        },
        signed.token,
        signed.expiresAt,
      ),
      { ok: true },
    );
  });

  it("accepts legacy v1 tokens only for the bounded compatibility window", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const token = legacyToken(currentSecret, fields, expiresAt);

    assert.deepEqual(verifyRate(fields, token, expiresAt), { ok: true });
  });

  it("accepts previous-secret v1 and v2 tokens only while the previous key is configured", () => {
    const previousSecret = "previous-test-shipping-rate-secret";
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const previousV1 = legacyToken(previousSecret, fields, expiresAt);

    process.env.SHIPPING_RATE_SECRET_PREVIOUS = previousSecret;
    assert.deepEqual(verifyRate(fields, previousV1, expiresAt), { ok: true });

    process.env.SHIPPING_RATE_SECRET = previousSecret;
    const previousV2 = signRate(fields, 60);
    process.env.SHIPPING_RATE_SECRET = currentSecret;
    assert.deepEqual(
      verifyRate(fields, previousV2.token, previousV2.expiresAt),
      { ok: true },
    );

    delete process.env.SHIPPING_RATE_SECRET_PREVIOUS;
    assert.equal(verifyRate(fields, previousV1, expiresAt).ok, false);
    assert.equal(verifyRate(fields, previousV2.token, previousV2.expiresAt).ok, false);
  });

  it("always signs with the current secret, never the previous secret", () => {
    process.env.SHIPPING_RATE_SECRET_PREVIOUS = "previous-test-shipping-rate-secret";
    const signed = signRate(fields, 60);
    delete process.env.SHIPPING_RATE_SECRET_PREVIOUS;

    assert.deepEqual(verifyRate(fields, signed.token, signed.expiresAt), { ok: true });
  });

  it("binds signed rates to the quoted cart or package subject", () => {
    const signed = signRate({ ...fields, subjectHash: "cart-package-v1" }, 60);

    assert.deepEqual(
      verifyRate({ ...fields, subjectHash: "cart-package-v1" }, signed.token, signed.expiresAt),
      { ok: true },
    );
    assert.equal(
      verifyRate({ ...fields, subjectHash: "cart-package-v2" }, signed.token, signed.expiresAt).ok,
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

  it("binds checkout shipping rates to server-derived package and quantity state", () => {
    const sellerCheckout = readFileSync("src/app/api/cart/checkout-seller/route.ts", "utf8");
    const singleCheckout = readFileSync("src/app/api/cart/checkout/single/route.ts", "utf8");
    const quoteRoute = readFileSync("src/app/api/shipping/quote/route.ts", "utf8");
    const selector = readFileSync("src/components/ShippingRateSelector.tsx", "utf8");
    const buyNowModal = readFileSync("src/components/BuyNowCheckoutModal.tsx", "utf8");
    const tokenSource = readFileSync("src/lib/shipping-token.ts", "utf8");

    assert.match(tokenSource, /export function shippingRateSubjectHash/);
    assert.match(tokenSource, /fields\.subjectHash/);
    assert.match(quoteRoute, /subjectHash = shippingRateSubjectHash\(\{/);
    assert.match(quoteRoute, /subjectHash,/);
    assert.match(quoteRoute, /token,\s*expiresAt,\s*subjectHash,/s);
    assert.match(selector, /quoteBodyExtra\?: Record<string, string \| number \| string\[\]>/);
    assert.match(
      buyNowModal,
      /quoteBodyExtra=\{\{\s*mode: "single",\s*listingId,\s*quantity,\s*selectedVariantOptionIds,\s*\}\}/s,
    );

    for (const source of [quoteRoute, sellerCheckout, singleCheckout]) {
      assert.match(source, /unitPriceCents/);
      assert.match(source, /priceVersion/);
      assert.match(source, /variantKey/);
    }
    assert.match(quoteRoute, /selectedVariantOptionIds: z\.array/);

    for (const source of [sellerCheckout, singleCheckout]) {
      assert.match(source, /subjectHash: z\.string\(\)\.min\(1\)\.max\(64\)/);
      assert.match(source, /const subjectHash = shippingRateSubjectHash\(\{/);
      assert.match(source, /subjectHash,/);
      assert.doesNotMatch(source, /subjectHash: body\.selectedRate\.subjectHash/);
    }
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

  it("binds quote and checkout validation to a supported US destination", () => {
    const sellerCheckout = readFileSync("src/app/api/cart/checkout-seller/route.ts", "utf8");
    const singleCheckout = readFileSync("src/app/api/cart/checkout/single/route.ts", "utf8");
    const quoteRoute = readFileSync("src/app/api/shipping/quote/route.ts", "utf8");

    assert.match(quoteRoute, /Only US shipping addresses are supported/);
    assert.match(quoteRoute, /toPostal: z\.string\(\)\.trim\(\)\.regex/);
    assert.match(quoteRoute, /buyerCity: shipTo\.city/);
    assert.match(quoteRoute, /buyerState: shipTo\.state/);
    assert.match(quoteRoute, /buyerCountry: shipTo\.country/);

    for (const source of [sellerCheckout, singleCheckout]) {
      assert.match(source, /normalizeUsState\(value\) !== ""/);
      assert.match(source, /buyerCity: shippingAddress\.city/);
      assert.match(source, /buyerState: shippingAddress\.state/);
      assert.match(source, /buyerCountry: "US"/);
    }
  });

  it("returns the explicit pickup-only warning when Shippo fails", () => {
    const quoteRoute = readFileSync("src/app/api/shipping/quote/route.ts", "utf8");
    const catchBranch = quoteRoute.slice(
      quoteRoute.indexOf('source: "shipping_quote_shippo_fallback"'),
      quoteRoute.indexOf("let fallbackShippingCents", quoteRoute.indexOf('source: "shipping_quote_shippo_fallback"')),
    );

    assert.match(catchBranch, /sellerShippingPolicy\.configuredRate === null && sellerAllowsPickup/);
    assert.match(catchBranch, /return pickupOnlyResponse/);
  });

  it("refreshes visible shipping rates before their signed tokens expire", () => {
    const selector = readFileSync("src/components/ShippingRateSelector.tsx", "utf8");

    assert.match(selector, /const earliestExpiry = Math\.min/);
    assert.match(selector, /earliestExpiry - Math\.floor\(Date\.now\(\) \/ 1000\) - 60/);
    assert.match(selector, /setRequestRevision\(\(revision\) => revision \+ 1\)/);
    assert.match(selector, /if \(refreshTimer\) clearTimeout\(refreshTimer\)/);
  });
});
