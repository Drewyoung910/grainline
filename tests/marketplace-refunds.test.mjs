import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { createMarketplaceRefundWithCreator } = await import("../src/lib/marketplaceRefunds.ts");

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
  it("uses one full reverse-transfer refund when the original order included tax", async () => {
    const calls = [];
    const result = await createMarketplaceRefundWithCreator(baseOpts(), async (params, requestOptions) => {
      calls.push({ params, requestOptions });
      return { id: "re_full" };
    });

    assert.deepEqual(result, {
      primaryRefundId: "re_full",
      refundIds: ["re_full"],
      refundStatuses: [null],
      requiresManualFollowUp: false,
      sellerPortionCents: 10_500,
      taxAmountCents: 825,
      usedPlatformOnly: false,
    });
    assert.deepEqual(calls, [
      {
        params: {
          payment_intent: "pi_test",
          amount: 11_325,
          reverse_transfer: true,
        },
        requestOptions: { idempotencyKey: "refund:order_1:full" },
      },
    ]);
  });

  it("includes gift wrapping in the full reverse-transfer refund amount", async () => {
    const calls = [];
    const result = await createMarketplaceRefundWithCreator(
      baseOpts({ amountCents: 11_825, giftWrappingPriceCents: 500 }),
      async (params, requestOptions) => {
        calls.push({ params, requestOptions });
        return { id: "re_full" };
      },
    );

    assert.deepEqual(result, {
      primaryRefundId: "re_full",
      refundIds: ["re_full"],
      refundStatuses: [null],
      requiresManualFollowUp: false,
      sellerPortionCents: 11_000,
      taxAmountCents: 825,
      usedPlatformOnly: false,
    });
    assert.deepEqual(calls, [
      {
        params: {
          payment_intent: "pi_test",
          amount: 11_825,
          reverse_transfer: true,
        },
        requestOptions: { idempotencyKey: "refund:order_1:full" },
      },
    ]);
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
      refundStatuses: [null],
      requiresManualFollowUp: false,
      sellerPortionCents: 0,
      taxAmountCents: 825,
      usedPlatformOnly: true,
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
      refundStatuses: [null],
      requiresManualFollowUp: false,
      sellerPortionCents: 1_200,
      taxAmountCents: 0,
      usedPlatformOnly: false,
    });
    assert.deepEqual(calls, [
      {
        params: {
          payment_intent: "pi_test",
          amount: 1_200,
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
      refundStatuses: [null],
      requiresManualFollowUp: false,
      sellerPortionCents: 0,
      taxAmountCents: 825,
      usedPlatformOnly: false,
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

  it("rejects refund amounts above the order total before calling Stripe", async () => {
    let calls = 0;

    await assert.rejects(
      () =>
        createMarketplaceRefundWithCreator(baseOpts({ amountCents: 11_326 }), async () => {
          calls += 1;
          return { id: "never" };
        }),
      /Refund amount exceeds order total/,
    );
    assert.equal(calls, 0);
  });

  it("does not treat immediately failed Stripe refund responses as issued refunds", async () => {
    await assert.rejects(
      () =>
        createMarketplaceRefundWithCreator(baseOpts(), async () => {
          return { id: "re_failed", status: "failed" };
        }),
      /returned failed status/,
    );

    await assert.rejects(
      () =>
        createMarketplaceRefundWithCreator(baseOpts(), async () => {
          return { id: "re_canceled", status: "canceled" };
        }),
      /returned canceled status/,
    );
  });

  it("surfaces pending Stripe refund statuses for manual follow-up without dropping the refund id", async () => {
    const result = await createMarketplaceRefundWithCreator(baseOpts(), async () => {
      return { id: "re_pending", status: "pending" };
    });

    assert.equal(result.primaryRefundId, "re_pending");
    assert.deepEqual(result.refundStatuses, ["pending"]);
    assert.equal(result.requiresManualFollowUp, true);
  });
});
