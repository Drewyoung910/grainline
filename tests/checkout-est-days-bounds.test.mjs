import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";

const checkoutSellerRoute = fs.readFileSync("src/app/api/cart/checkout-seller/route.ts", "utf8");
const checkoutSingleRoute = fs.readFileSync("src/app/api/cart/checkout/single/route.ts", "utf8");
const stripeWebhookRoute = fs.readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

describe("checkout shipping estimated-days bounds", () => {
  for (const [name, source] of [
    ["cart checkout", checkoutSellerRoute],
    ["single checkout", checkoutSingleRoute],
  ]) {
    it(`${name} bounds selected shipping estimated days before creating Stripe Checkout`, () => {
      assert.match(source, /SHIPPING_ESTIMATED_DAYS_MAX/);
      assert.match(source, /estDays:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(SHIPPING_ESTIMATED_DAYS_MAX\)\.nullable\(\)/);
    });
  }

  it("webhook uses bounded shipping estimated days without changing quantity parsing", () => {
    assert.match(stripeWebhookRoute, /parseBoundedPositiveInt\(rawEstDays,\s*7,\s*SHIPPING_ESTIMATED_DAYS_MAX\)/);
    assert.match(stripeWebhookRoute, /parsePositiveInt\(sessionMeta\.quantity,\s*1\)/);
  });
});
