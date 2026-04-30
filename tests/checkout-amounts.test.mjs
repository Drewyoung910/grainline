import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { calculateCheckoutAmounts } = await import("../src/lib/checkoutAmounts.ts");

describe("checkout amount calculation", () => {
  it("transfers pre-tax seller proceeds minus the 5 percent platform fee", () => {
    assert.deepEqual(
      calculateCheckoutAmounts({
        itemsSubtotalCents: 10_000,
        shippingAmountCents: 1_500,
        giftWrapCents: 500,
      }),
      {
        platformFeeCents: 500,
        preTaxTotalCents: 12_000,
        sellerTransferBeforeMinimumCents: 11_500,
        sellerTransferAmountCents: 11_500,
        belowMinimumSellerTransfer: false,
      },
    );
  });

  it("excludes shipping and gift wrap from the platform fee base", () => {
    assert.equal(
      calculateCheckoutAmounts({
        itemsSubtotalCents: 101,
        shippingAmountCents: 10_000,
        giftWrapCents: 10_000,
      }).platformFeeCents,
      5,
    );
  });

  it("uses rounded cents for the platform fee", () => {
    assert.equal(
      calculateCheckoutAmounts({
        itemsSubtotalCents: 2_510,
        shippingAmountCents: 0,
        giftWrapCents: 0,
      }).platformFeeCents,
      126,
    );
  });

  it("flags orders whose seller transfer would be below one dollar", () => {
    assert.deepEqual(
      calculateCheckoutAmounts({
        itemsSubtotalCents: 50,
        shippingAmountCents: 0,
        giftWrapCents: 0,
      }),
      {
        platformFeeCents: 3,
        preTaxTotalCents: 50,
        sellerTransferBeforeMinimumCents: 47,
        sellerTransferAmountCents: 47,
        belowMinimumSellerTransfer: true,
      },
    );
  });

  it("does not clamp invalid negative transfer math to a one-cent payout", () => {
    assert.deepEqual(
      calculateCheckoutAmounts({
        itemsSubtotalCents: 100,
        shippingAmountCents: -150,
        giftWrapCents: 0,
      }),
      {
        platformFeeCents: 5,
        preTaxTotalCents: -50,
        sellerTransferBeforeMinimumCents: -55,
        sellerTransferAmountCents: -55,
        belowMinimumSellerTransfer: true,
      },
    );
  });
});
