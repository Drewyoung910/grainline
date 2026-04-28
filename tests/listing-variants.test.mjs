import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { resolveListingVariantSelection } = await import("../src/lib/listingVariants.ts");

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
});
