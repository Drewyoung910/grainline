import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  MAX_VARIANT_PRICE_ADJUST_CENTS,
  MIN_VARIANT_PRICE_ADJUST_CENTS,
  normalizeVariantPriceAdjustCents,
  resolveListingVariantSelection,
  validateVariantGroupsForBasePrice,
  validateVariantPriceAdjustCents,
} = await import("../src/lib/listingVariants.ts");

const variantGroups = [
  {
    id: "size",
    name: "Size",
    options: [
      { id: "small", label: "Small", priceAdjustCents: 0, inStock: true },
      { id: "large", label: "Large", priceAdjustCents: 500, inStock: true },
    ],
  },
  {
    id: "finish",
    name: "Finish",
    options: [
      { id: "raw", label: "Raw", priceAdjustCents: 0, inStock: true },
      { id: "waxed", label: "Waxed", priceAdjustCents: 250, inStock: false },
    ],
  },
];

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("listing variant selection", () => {
  it("resolves selected variants with stable key, total adjustment, and snapshot", () => {
    assert.deepEqual(resolveListingVariantSelection(variantGroups, ["large", "raw"]), {
      ok: true,
      variantAdjustCents: 500,
      variantKey: "large,raw",
      selectedVariantLabels: ["Large", "Raw"],
      selectedVariantsSnapshot: [
        { groupName: "Size", optionLabel: "Large", priceAdjustCents: 500 },
        { groupName: "Finish", optionLabel: "Raw", priceAdjustCents: 0 },
      ],
    });

    assert.equal(resolveListingVariantSelection(variantGroups, ["raw", "large"]).variantKey, "large,raw");
  });

  it("requires exactly one option from each group", () => {
    assert.deepEqual(resolveListingVariantSelection(variantGroups, ["large"]), {
      ok: false,
      error: "Please select exactly one option from each variant group.",
    });
    assert.deepEqual(resolveListingVariantSelection(variantGroups, ["small", "large"]), {
      ok: false,
      error: "Please select only one option from each variant group.",
    });
  });

  it("rejects duplicate, invalid, and out-of-stock options", () => {
    assert.deepEqual(resolveListingVariantSelection(variantGroups, ["large", "large"]), {
      ok: false,
      error: "Please select each variant option only once.",
    });
    assert.deepEqual(resolveListingVariantSelection(variantGroups, ["large", "missing"]), {
      ok: false,
      error: "Invalid variant option selected.",
    });
    assert.deepEqual(resolveListingVariantSelection(variantGroups, ["large", "waxed"]), {
      ok: false,
      error: 'Option "Waxed" is out of stock.',
    });
  });

  it("bounds variant adjustments and possible final prices", () => {
    assert.equal(normalizeVariantPriceAdjustCents("12.6"), 13);
    assert.equal(
      validateVariantPriceAdjustCents(MIN_VARIANT_PRICE_ADJUST_CENTS - 1),
      "Variant price adjustments cannot exceed $100,000.",
    );
    assert.equal(
      validateVariantPriceAdjustCents(MAX_VARIANT_PRICE_ADJUST_CENTS + 1),
      "Variant price adjustments cannot exceed $100,000.",
    );
    assert.equal(validateVariantPriceAdjustCents(500), null);

    assert.equal(
      validateVariantGroupsForBasePrice([
        { options: [{ label: "Free", priceAdjustCents: -5000 }] },
      ], 5000),
      "Variant price adjustments cannot reduce the final price below $0.01.",
    );
    assert.equal(
      validateVariantGroupsForBasePrice([
        { options: [{ label: "Premium", priceAdjustCents: 10_000_000 }] },
      ], 1),
      "Variant price adjustments cannot raise the final price above $100,000.",
    );
    assert.equal(
      validateVariantGroupsForBasePrice([
        { options: [{ label: "Small", priceAdjustCents: -100 }, { label: "Large", priceAdjustCents: 500 }] },
        { options: [{ label: "Raw", priceAdjustCents: 0 }, { label: "Waxed", priceAdjustCents: 250 }] },
      ], 1000),
      null,
    );
  });

  it("checks invalid recalculated variant prices before persisting cart snapshots", () => {
    const cartUpdate = source("src/app/api/cart/update/route.ts");
    assert.ok(
      cartUpdate.indexOf("if (livePriceCents < 1)") > cartUpdate.indexOf("livePriceCents = listing.priceCents + variantResolution.variantAdjustCents"),
    );
    assert.ok(
      cartUpdate.indexOf("if (livePriceCents < 1)") < cartUpdate.indexOf("prisma.cartItem.updateMany"),
    );

    const checkoutSeller = source("src/app/api/cart/checkout-seller/route.ts");
    assert.ok(
      checkoutSeller.indexOf("if (unitPriceCents < 1)") > checkoutSeller.indexOf("const unitPriceCents = item.listing.priceCents + variantResolution.variantAdjustCents"),
    );
    assert.ok(
      checkoutSeller.indexOf("if (unitPriceCents < 1)") < checkoutSeller.indexOf("prisma.cartItem.update({"),
    );
  });
});
