import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  buyNowListingProductMetadata,
  readCheckoutShippingPackageMetadata,
} = await import("../src/lib/orderItemSnapshot.ts");
const { resolveListingVariantSelection } = await import("../src/lib/listingVariants.ts");

const groups = [
  {
    id: "size",
    name: "Size",
    options: [
      { id: "large", label: "Large", priceAdjustCents: 500, inStock: true },
    ],
  },
  {
    id: "finish",
    name: "Finish",
    options: [
      { id: "raw", label: "Raw", priceAdjustCents: 0, inStock: true },
    ],
  },
];

describe("Buy Now variant line-item metadata", () => {
  it("carries the resolved variant key into Stripe product metadata", () => {
    const resolution = resolveListingVariantSelection(groups, ["large", "raw"]);
    assert.equal(resolution.ok, true);
    if (!resolution.ok) return;

    const metadata = buyNowListingProductMetadata({
      listingId: "listing-variant",
      variantKey: resolution.variantKey,
      shippingWeightGrams: 100,
      shippingLengthCm: 10,
      shippingWidthCm: 8,
      shippingHeightCm: 4,
    });

    assert.equal(metadata.listingId, "listing-variant");
    assert.equal(metadata.variantKey, "large,raw");
    assert.deepEqual(readCheckoutShippingPackageMetadata(metadata), {
      shippingWeightGrams: 100,
      shippingLengthCm: 10,
      shippingWidthCm: 8,
      shippingHeightCm: 4,
      shippingPackageComplete: true,
    });
  });

  it("keeps the live Buy Now route wired to the executed metadata builder", () => {
    const route = fs.readFileSync("src/app/api/cart/checkout/single/route.ts", "utf8");
    assert.match(
      route,
      /metadata:\s*buyNowListingProductMetadata\(\{[\s\S]*?variantKey:\s*variantResolution\.variantKey/u,
    );
  });
});
