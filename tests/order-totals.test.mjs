import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { orderItemsSubtotalCents, orderTotalCents } = await import("../src/lib/orderTotals.ts");

describe("order total helpers", () => {
  it("includes gift wrapping in displayed order totals", () => {
    assert.equal(
      orderTotalCents({
        itemsSubtotalCents: 10_000,
        shippingAmountCents: 1_500,
        taxAmountCents: 825,
        giftWrappingPriceCents: 500,
      }),
      12_825,
    );
  });

  it("falls back to persisted items when the stored subtotal is absent or zero", () => {
    const order = {
      itemsSubtotalCents: 0,
      shippingAmountCents: 700,
      taxAmountCents: 140,
      giftWrappingPriceCents: 300,
      items: [
        { priceCents: 2_000, quantity: 2 },
        { priceCents: 1_500, quantity: 1 },
      ],
    };

    assert.equal(orderItemsSubtotalCents(order), 5_500);
    assert.equal(orderTotalCents(order), 6_640);
  });

  it("supports seller-scoped item subtotal overrides without dropping gift wrap", () => {
    assert.equal(
      orderTotalCents(
        {
          itemsSubtotalCents: 20_000,
          shippingAmountCents: 1_000,
          taxAmountCents: 900,
          giftWrappingPriceCents: 400,
        },
        { itemsSubtotalCents: 8_000 },
      ),
      10_300,
    );
  });
});
