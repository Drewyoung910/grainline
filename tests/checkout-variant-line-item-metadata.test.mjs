import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  checkoutListingProductMetadata,
} = await import("../src/lib/orderItemSnapshot.ts");
const {
  paidCheckoutLineItemIdentity,
} = await import("../src/lib/stripeWebhookMetadata.ts");
const {
  resolveListingVariantSelection,
} = await import("../src/lib/listingVariants.ts");

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

describe("checkout variant line-item metadata", () => {
  it("carries the resolved Buy Now variant key through Stripe to the paid-order identity", () => {
    const resolution = resolveListingVariantSelection(groups, ["large", "raw"]);
    assert.equal(resolution.ok, true);
    if (!resolution.ok) return;

    const productMetadata = checkoutListingProductMetadata({
      listingId: "listing-variant",
      variantKey: resolution.variantKey,
      shippingWeightGrams: 100,
      shippingLengthCm: 10,
      shippingWidthCm: 8,
      shippingHeightCm: 4,
    });

    assert.deepEqual(
      paidCheckoutLineItemIdentity(productMetadata, "single", "listing-variant"),
      {
        sourceKey: "single:listing-variant",
        listingId: "listing-variant",
        variantKey: "large,raw",
      },
    );
  });

  it("keeps cart checkout on the same producer-consumer variant contract", () => {
    const productMetadata = checkoutListingProductMetadata({
      listingId: "listing-cart-variant",
      cartItemId: "cart-item-variant",
      variantKey: "large,raw",
    });

    assert.deepEqual(
      paidCheckoutLineItemIdentity(productMetadata, "cart", null),
      {
        sourceKey: "cart-item-variant",
        listingId: "listing-cart-variant",
        variantKey: "large,raw",
      },
    );
  });

  it("preserves empty predecessor keys and rejects incomplete listing identity", () => {
    const plain = checkoutListingProductMetadata({
      listingId: "listing-plain",
      variantKey: "",
    });
    assert.equal(
      paidCheckoutLineItemIdentity(plain, "single", "listing-plain")?.variantKey,
      "",
    );
    assert.equal(paidCheckoutLineItemIdentity({}, "single", "listing-plain"), null);
    assert.throws(
      () => paidCheckoutLineItemIdentity(
        { listingId: "listing-cart-variant", variantKey: "large" },
        "cart",
        null,
      ),
      /authority is incomplete/u,
    );
  });
});
