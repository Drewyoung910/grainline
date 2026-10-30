import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  normalizeGiftWrappingProfilePrice,
  resolveGiftWrappingCharge,
  withExclusiveTaxBehavior,
} = await import("../src/lib/checkoutLineItemContract.ts");

describe("checkout line-item contract", () => {
  it("normalizes an enabled blank gift-wrap price to an explicit free price", () => {
    assert.equal(normalizeGiftWrappingProfilePrice(true, null), 0);
    assert.equal(normalizeGiftWrappingProfilePrice(true, 500), 500);
    assert.equal(normalizeGiftWrappingProfilePrice(false, 500), null);
  });

  it("fails closed when checkout sees enabled gift wrapping without a configured price", () => {
    assert.deepEqual(resolveGiftWrappingCharge({
      requested: true,
      offered: true,
      configuredPriceCents: null,
    }), {
      ok: false,
      error: "Gift wrapping is temporarily unavailable. Please continue without it.",
    });
    assert.deepEqual(resolveGiftWrappingCharge({
      requested: true,
      offered: true,
      configuredPriceCents: 0,
    }), { ok: true, amountCents: 0 });
    assert.deepEqual(resolveGiftWrappingCharge({
      requested: false,
      offered: true,
      configuredPriceCents: null,
    }), { ok: true, amountCents: 0 });
  });

  it("pins every generated product or gift-wrap price to exclusive tax", () => {
    const product = withExclusiveTaxBehavior({
      currency: "usd",
      unit_amount: 72500,
      product_data: { name: "Fixture" },
    });
    assert.deepEqual(product, {
      currency: "usd",
      unit_amount: 72500,
      product_data: { name: "Fixture" },
      tax_behavior: "exclusive",
    });
  });

  it("wires both checkout routes through the shared fail-closed and tax contract", () => {
    for (const path of [
      "src/app/api/cart/checkout-seller/route.ts",
      "src/app/api/cart/checkout/single/route.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /resolveGiftWrappingCharge\(/u);
      assert.equal(
        source.match(/price_data: withExclusiveTaxBehavior\(/gu)?.length,
        2,
        `${path} must construct both product and gift-wrap prices through the exclusive-tax helper`,
      );
      assert.doesNotMatch(source, /giftWrappingPriceCents \?\? 0/u);
    }
  });
});
