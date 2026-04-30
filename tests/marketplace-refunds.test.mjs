import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  StripeRefundPartialFailure,
  createMarketplaceRefundWithCreator,
  isStripeRefundPartialFailure,
} = await import("../src/lib/marketplaceRefunds.ts");

function baseOpts(overrides = {}) {
  return {
    paymentIntentId: "pi_test",
    resolution: "FULL",
    amountCents: 11_325,
    itemsSubtotalCents: 10_000,
    shippingAmountCents: 500,
    giftWrappingPriceCents: 0,
    taxAmountCents: 825,
    canReverseTransfer: true,
    idempotencyKeyBase: "refund:order_1",
    ...overrides,
  };
}

describe("marketplace refunds", () => {
  it("splits full refunds so tax is not reverse-transferred from the seller", async () => {
    const calls = [];
    const result = await createMarketplaceRefundWithCreator(baseOpts(), async (params, requestOptions) => {
      calls.push({ params, requestOptions });
      return { id: calls.length === 1 ? "re_seller" : "re_tax" };
    });

    assert.deepEqual(result, {
      primaryRefundId: "re_seller",
      refundIds: ["re_seller", "re_tax"],
      sellerPortionCents: 10_500,
      taxAmountCents: 825,
      usedPlatformOnly: false,
      usedSplitTaxRefund: true,
    });
    assert.deepEqual(calls, [
      {
        params: {
          payment_intent: "pi_test",
          amount: 10_500,
          refund_application_fee: true,
          reverse_transfer: true,
        },
        requestOptions: { idempotencyKey: "refund:order_1:seller" },
      },
      {
        params: {
          payment_intent: "pi_test",
          amount: 825,
        },
        requestOptions: { idempotencyKey: "refund:order_1:tax" },
      },
    ]);
  });

  it("includes gift wrapping in the seller-reversible portion of full refunds", async () => {
    const calls = [];
    const result = await createMarketplaceRefundWithCreator(
      baseOpts({ amountCents: 11_825, giftWrappingPriceCents: 500 }),
      async (params, requestOptions) => {
        calls.push({ params, requestOptions });
        return { id: calls.length === 1 ? "re_seller" : "re_tax" };
      },
    );

    assert.deepEqual(result, {
      primaryRefundId: "re_seller",
      refundIds: ["re_seller", "re_tax"],
      sellerPortionCents: 11_000,
      taxAmountCents: 825,
      usedPlatformOnly: false,
      usedSplitTaxRefund: true,
    });
    assert.deepEqual(calls.map((call) => call.params.amount), [11_000, 825]);
  });

  it("uses a platform-only refund when the seller transfer cannot be reversed", async () => {
    const calls = [];
    const result = await createMarketplaceRefundWithCreator(
      baseOpts({ canReverseTransfer: false, reason: "requested_by_customer" }),
      async (params, requestOptions) => {
        calls.push({ params, requestOptions });
        return { id: "re_platform" };
      },
    );

    assert.deepEqual(result, {
      primaryRefundId: "re_platform",
      refundIds: ["re_platform"],
      sellerPortionCents: 0,
      taxAmountCents: 825,
      usedPlatformOnly: true,
      usedSplitTaxRefund: false,
    });
    assert.deepEqual(calls, [
      {
        params: {
          payment_intent: "pi_test",
          amount: 11_325,
          reason: "requested_by_customer",
        },
        requestOptions: { idempotencyKey: "refund:order_1:platform" },
      },
    ]);
  });

  it("does not split partial refunds even when the original order included tax", async () => {
    const calls = [];
    const result = await createMarketplaceRefundWithCreator(
      baseOpts({
        resolution: "PARTIAL",
        amountCents: 1_200,
        reason: "requested_by_customer",
      }),
      async (params, requestOptions) => {
        calls.push({ params, requestOptions });
        return { id: "re_partial" };
      },
    );

    assert.deepEqual(result, {
      primaryRefundId: "re_partial",
      refundIds: ["re_partial"],
      sellerPortionCents: 1_200,
      taxAmountCents: 0,
      usedPlatformOnly: false,
      usedSplitTaxRefund: false,
    });
    assert.deepEqual(calls, [
      {
        params: {
          payment_intent: "pi_test",
          amount: 1_200,
          refund_application_fee: true,
          reverse_transfer: true,
          reason: "requested_by_customer",
        },
        requestOptions: { idempotencyKey: "refund:order_1:seller" },
      },
    ]);
  });

  it("uses a single platform refund for full tax-only refunds", async () => {
    const calls = [];
    const result = await createMarketplaceRefundWithCreator(
      baseOpts({
        amountCents: 825,
        itemsSubtotalCents: 0,
        shippingAmountCents: 0,
      }),
      async (params, requestOptions) => {
        calls.push({ params, requestOptions });
        return { id: "re_tax_only" };
      },
    );

    assert.deepEqual(result, {
      primaryRefundId: "re_tax_only",
      refundIds: ["re_tax_only"],
      sellerPortionCents: 0,
      taxAmountCents: 825,
      usedPlatformOnly: false,
      usedSplitTaxRefund: false,
    });
    assert.deepEqual(calls, [
      {
        params: {
          payment_intent: "pi_test",
          amount: 825,
        },
        requestOptions: { idempotencyKey: "refund:order_1:tax-only" },
      },
    ]);
  });

  it("preserves succeeded refund IDs when a later split-refund step fails", async () => {
    const failure = new Error("stripe unavailable");

    await assert.rejects(
      () =>
        createMarketplaceRefundWithCreator(baseOpts(), async (_params, _requestOptions) => {
          if (_requestOptions.idempotencyKey.endsWith(":tax")) throw failure;
          return { id: "re_seller" };
        }),
      (error) => {
        assert.equal(error instanceof StripeRefundPartialFailure, true);
        assert.equal(isStripeRefundPartialFailure(error), true);
        assert.deepEqual(error.refundIds, ["re_seller"]);
        assert.equal(error.primaryRefundId, "re_seller");
        assert.equal(error.cause, failure);
        return true;
      },
    );
  });

  it("rejects zero or negative refund amounts before calling Stripe", async () => {
    let calls = 0;

    await assert.rejects(
      () =>
        createMarketplaceRefundWithCreator(baseOpts({ amountCents: 0 }), async () => {
          calls += 1;
          return { id: "never" };
        }),
      /Refund amount must be positive/,
    );
    assert.equal(calls, 0);
  });
});
