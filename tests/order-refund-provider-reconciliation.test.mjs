import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { inspectOrderRefundProviderEffect } = await import(
  "../src/lib/orderRefundProviderReconciliation.ts"
);

function claim(overrides = {}) {
  return {
    claimId: "order_refund_claim_8b0d3dbf-58cc-4c38-9c7b-fbc1d35df79d",
    claimGeneration: 3n,
    source: "SELLER",
    sourceId: "seller-user",
    sourceGeneration: null,
    idempotencyScope:
      "seller-refund:order_refund_claim_8b0d3dbf-58cc-4c38-9c7b-fbc1d35df79d:FULL:1325",
    refundAmountCents: 1325,
    currency: "usd",
    paymentIntentId: "pi_claim",
    itemsSubtotalCents: 1000,
    shippingAmountCents: 200,
    giftWrappingPriceCents: 25,
    taxAmountCents: 100,
    canReverseTransfer: true,
    action: "replay",
    ...overrides,
  };
}

function metadata(input = claim()) {
  return {
    grainline_refund_claim_id: input.claimId,
    grainline_refund_claim_generation: input.claimGeneration.toString(),
    grainline_refund_claim_source: input.source,
    grainline_refund_idempotency_scope: input.idempotencyScope,
    grainline_refund_component: "full",
  };
}

function refund(overrides = {}) {
  return {
    id: "re_claim",
    object: "refund",
    amount: 1325,
    currency: "usd",
    payment_intent: "pi_claim",
    status: "succeeded",
    created: 1_777_046_400,
    metadata: metadata(),
    transfer_reversal: {
      id: "trr_claim",
      object: "transfer_reversal",
      amount: 1175,
      currency: "usd",
    },
    ...overrides,
  };
}

function client(pages, retrieved = refund()) {
  let pageIndex = 0;
  const calls = [];
  return {
    calls,
    async list(params) {
      calls.push({ operation: "list", params });
      return pages[pageIndex++];
    },
    async retrieve(id, params) {
      calls.push({ operation: "retrieve", id, params });
      return retrieved;
    },
  };
}

describe("Order refund provider reconciliation", () => {
  it("classifies a complete bounded scan with no exact claim metadata as absent", async () => {
    const fake = client([{
      data: [refund({ id: "re_other", amount: 100, metadata: {} })],
      has_more: false,
    }]);
    const result = await inspectOrderRefundProviderEffect(claim(), {
      client: fake,
      now: new Date("2026-08-24T12:00:00.000Z"),
      providerAuthorizedAtSeconds: 1_777_046_000,
    });

    assert.equal(result.disposition, "ABSENT");
    assert.equal(result.providerResult, null);
    assert.match(result.providerEvidenceSha256, /^[0-9a-f]{64}$/);
    assert.equal(fake.calls.length, 1);
  });

  it("retrieves and returns one exact usable provider effect", async () => {
    const fake = client([{ data: [refund()], has_more: false }]);
    const result = await inspectOrderRefundProviderEffect(claim(), {
      client: fake,
      now: new Date("2026-08-24T12:00:00.000Z"),
      providerAuthorizedAtSeconds: 1_777_046_000,
    });

    assert.equal(result.disposition, "USABLE_REFUND");
    assert.deepEqual(result.providerResult, {
      primaryRefundId: "re_claim",
      refundIds: ["re_claim"],
      refundStatuses: ["succeeded"],
      accountingEvidence: {
        transferReversalId: "trr_claim",
        transferReversalAmountCents: 1175,
      },
    });
    assert.deepEqual(fake.calls[1], {
      operation: "retrieve",
      id: "re_claim",
      params: { expand: ["transfer_reversal"] },
    });
  });

  it("digests the retrieved status and transfer-reversal evidence, not the list snapshot", async () => {
    const listed = refund({ status: "pending", transfer_reversal: null });
    const first = await inspectOrderRefundProviderEffect(claim(), {
      client: client(
        [{ data: [listed], has_more: false }],
        refund({ status: "succeeded" }),
      ),
      now: new Date("2026-08-24T12:00:00.000Z"),
      providerAuthorizedAtSeconds: 1_777_046_000,
    });
    const second = await inspectOrderRefundProviderEffect(claim(), {
      client: client(
        [{ data: [listed], has_more: false }],
        refund({
          status: "pending",
          transfer_reversal: {
            id: "trr_other",
            object: "transfer_reversal",
            amount: 1100,
            currency: "usd",
          },
        }),
      ),
      now: new Date("2026-08-24T12:00:00.000Z"),
      providerAuthorizedAtSeconds: 1_777_046_000,
    });
    assert.notEqual(
      first.providerEvidenceSha256,
      second.providerEvidenceSha256,
    );
  });

  it("classifies a failed exact refund as terminal no-effect evidence", async () => {
    const exact = refund({ status: "failed", transfer_reversal: null });
    const fake = client([{ data: [exact], has_more: false }], exact);
    const result = await inspectOrderRefundProviderEffect(claim(), {
      client: fake,
      providerAuthorizedAtSeconds: 1_777_046_000,
    });
    assert.equal(result.disposition, "TERMINAL_NO_EFFECT");
    assert.equal(result.providerResult, null);
  });

  it("fails closed when a terminal refund retains Connect reversal evidence", async () => {
    const exact = refund({ status: "failed" });
    await assert.rejects(
      inspectOrderRefundProviderEffect(claim(), {
        client: client([{ data: [exact], has_more: false }], exact),
        providerAuthorizedAtSeconds: 1_777_046_000,
      }),
      /retains transfer-reversal evidence/,
    );
  });

  it("binds absence evidence to every scanned refund identity", async () => {
    const first = await inspectOrderRefundProviderEffect(claim(), {
      providerAuthorizedAtSeconds: 1_700_000_000,
      now: new Date(1_700_000_100_000),
      client: client([{
          data: [refund({
            id: "re_unrelated_a",
            amount: 100,
            created: 1_699_000_000,
            metadata: {},
          })],
          has_more: false,
      }]),
    });
    const second = await inspectOrderRefundProviderEffect(claim(), {
      providerAuthorizedAtSeconds: 1_700_000_000,
      now: new Date(1_700_000_100_000),
      client: client([{
          data: [refund({
            id: "re_unrelated_b",
            amount: 100,
            created: 1_699_000_000,
            metadata: {},
          })],
          has_more: false,
      }]),
    });

    assert.equal(first.disposition, "ABSENT");
    assert.equal(second.disposition, "ABSENT");
    assert.notEqual(
      first.providerEvidenceSha256,
      second.providerEvidenceSha256,
    );
  });

  it("fails closed on duplicate claim metadata or canonical drift", async () => {
    const first = refund();
    await assert.rejects(
      inspectOrderRefundProviderEffect(claim(), {
        client: client([{
          data: [first, refund({ id: "re_duplicate" })],
          has_more: false,
        }]),
        providerAuthorizedAtSeconds: 1_777_046_000,
      }),
      /multiple refunds/,
    );
    await assert.rejects(
      inspectOrderRefundProviderEffect(claim(), {
        client: client(
          [{ data: [first], has_more: false }],
          refund({ amount: 1324 }),
        ),
        providerAuthorizedAtSeconds: 1_777_046_000,
      }),
      /evidence drifted/,
    );
    await assert.rejects(
      inspectOrderRefundProviderEffect(claim(), {
        client: client(
          [{ data: [first], has_more: false }],
          refund({
            metadata: {
              ...metadata(),
              grainline_refund_component: "caller-selected",
            },
          }),
        ),
        providerAuthorizedAtSeconds: 1_777_046_000,
      }),
      /evidence drifted/,
    );
  });

  it("fails closed on a plausible pre-metadata refund in the provider window", async () => {
    const plausibleLegacy = refund({
      id: "re_legacy",
      metadata: {},
      created: 1_777_046_100,
    });
    await assert.rejects(
      inspectOrderRefundProviderEffect(claim(), {
        client: client([{ data: [plausibleLegacy], has_more: false }]),
        providerAuthorizedAtSeconds: 1_777_046_000,
      }),
      /plausible untagged refund/,
    );
    const oldLegacy = refund({
      id: "re_old",
      metadata: {},
      created: 1_777_000_000,
    });
    const oldResult = await inspectOrderRefundProviderEffect(claim(), {
      client: client([{ data: [oldLegacy], has_more: false }]),
      providerAuthorizedAtSeconds: 1_777_046_000,
    });
    assert.equal(oldResult.disposition, "ABSENT");
  });

  it("paginates by provider cursor and fails closed at the scan bound", async () => {
    const fake = client([
      { data: [refund({ id: "re_page_1", amount: 100, metadata: {} })], has_more: true },
      { data: [], has_more: false },
    ]);
    const result = await inspectOrderRefundProviderEffect(claim(), {
      client: fake,
      providerAuthorizedAtSeconds: 1_777_046_000,
    });
    assert.equal(result.disposition, "ABSENT");
    assert.equal(fake.calls[1].params.starting_after, "re_page_1");

    const endless = client(Array.from({ length: 20 }, (_, index) => ({
      data: [refund({ id: `re_page_${index}`, amount: 100, metadata: {} })],
      has_more: true,
    })));
    await assert.rejects(
      inspectOrderRefundProviderEffect(claim(), {
        client: endless,
        providerAuthorizedAtSeconds: 1_777_046_000,
      }),
      /exceeded its bounded scan/,
    );
  });
});
