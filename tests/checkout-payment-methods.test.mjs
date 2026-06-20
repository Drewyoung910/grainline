import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("checkout payment method guardrails", () => {
  it("keeps Checkout sessions card-only unless webhook failure handling is expanded", () => {
    for (const path of [
      "src/app/api/cart/checkout-seller/route.ts",
      "src/app/api/cart/checkout/single/route.ts",
    ]) {
      const route = source(path);

      assert.match(route, /payment_method_types:\s*\["card"\]/, `${path} should stay card-only`);
      assert.doesNotMatch(route, /automatic_payment_methods/);
    }
  });

  it("restores checkout stock on supported Checkout async failure events", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");

    assert.match(webhook, /checkout\.session\.async_payment_failed/);
    assert.match(webhook, /checkout\.session\.expired/);
    assert.match(webhook, /restoreUnorderedCheckoutStockOnce\(/);
  });

  it("derives gift-wrap price server-side in checkout routes", () => {
    const sellerCheckout = source("src/app/api/cart/checkout-seller/route.ts");
    const singleCheckout = source("src/app/api/cart/checkout/single/route.ts");
    const sellerSchema = sellerCheckout.slice(
      sellerCheckout.indexOf("const CheckoutSellerSchema"),
      sellerCheckout.indexOf("export const runtime"),
    );
    const singleSchema = singleCheckout.slice(
      singleCheckout.indexOf("const CheckoutSingleSchema"),
      singleCheckout.indexOf("export const runtime"),
    );

    assert.doesNotMatch(sellerSchema, /giftWrappingPriceCents/);
    assert.doesNotMatch(singleSchema, /giftWrappingPriceCents/);
    assert.doesNotMatch(sellerCheckout, /body\.giftWrappingPriceCents/);
    assert.doesNotMatch(singleCheckout, /body\.giftWrappingPriceCents/);
    assert.match(sellerCheckout, /sellerItems\[0\]\.listing\.seller\.giftWrappingPriceCents \?\? 0/);
    assert.match(singleCheckout, /listing\.seller\.giftWrappingPriceCents \?\? 0/);
  });

  it("sends server-computed item subtotal metadata for webhook refund totals", () => {
    for (const path of [
      "src/app/api/cart/checkout-seller/route.ts",
      "src/app/api/cart/checkout/single/route.ts",
    ]) {
      const route = source(path);

      assert.match(route, /const itemsSubtotalCents =/);
      assert.match(route, /itemsSubtotalCents: String\(itemsSubtotalCents\)/);
    }
  });
});
