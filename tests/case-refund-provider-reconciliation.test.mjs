import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  inspectCaseRefundProviderEffect,
  isCaseRefundProviderReconciliationRequiredError,
} = await import("../src/lib/caseRefundProviderReconciliation.ts");

const claimId =
  "case_resolution_claim_8b0d3dbf-58cc-4c38-9c7b-fbc1d35df79d";

function prepared(overrides = {}) {
  return {
    claimId,
    caseId: "case_1",
    orderId: "order_1",
    buyerUserId: "buyer_1",
    sellerUserId: "seller_1",
    resolution: "REFUND_FULL",
    refundAmountCents: 1325,
    currency: "usd",
    stockRestorePlan: [],
    status: "RECONCILIATION_REQUIRED",
    idempotencyScope:
      `case-resolve:${claimId}:REFUND_FULL:1325`,
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

function metadata(input = prepared()) {
  return {
    grainline_refund_claim_id: input.claimId,
    grainline_refund_claim_generation: "1",
    grainline_refund_claim_source: "CASE",
    grainline_refund_idempotency_scope: input.idempotencyScope,
    grainline_refund_component: "full",
  };
}

function refund(overrides = {}) {
  return {
    id: "re_case_claim",
    object: "refund",
    amount: 1325,
    currency: "usd",
    payment_intent: "pi_claim",
    status: "succeeded",
    created: 1_777_046_400,
    metadata: metadata(),
    transfer_reversal: {
      id: "trr_case_claim",
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

async function rejectsReconciliationRequired(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.equal(
      isCaseRefundProviderReconciliationRequiredError(error),
      true,
    );
    assert.match(error.message, pattern);
    return true;
  });
}

describe("Case refund provider reconciliation", () => {
  it("classifies a complete scan with no exact claim metadata as absent", async () => {
    const fake = client([{
      data: [refund({ id: "re_other", amount: 100, metadata: {} })],
      has_more: false,
    }]);
    const result = await inspectCaseRefundProviderEffect(prepared(), {
      client: fake,
      now: new Date("2026-08-24T12:00:00.000Z"),
      providerAuthorizedAtSeconds: 1_777_046_000,
    });
    assert.equal(result.disposition, "ABSENT");
    assert.equal(result.providerResult, null);
    assert.match(result.providerEvidenceSha256, /^[0-9a-f]{64}$/);
  });

  it("retrieves one exact usable Case refund", async () => {
    const fake = client([{ data: [refund()], has_more: false }]);
    const result = await inspectCaseRefundProviderEffect(prepared(), {
      client: fake,
      providerAuthorizedAtSeconds: 1_777_046_000,
    });
    assert.equal(result.disposition, "USABLE_REFUND");
    assert.deepEqual(result.providerResult, {
      primaryRefundId: "re_case_claim",
      refundIds: ["re_case_claim"],
      refundStatuses: ["succeeded"],
      accountingEvidence: {
        transferReversalId: "trr_case_claim",
        transferReversalAmountCents: 1175,
      },
      requiresManualTransferReconciliation: false,
      requiresManualFollowUp: false,
    });
    assert.deepEqual(fake.calls[1], {
      operation: "retrieve",
      id: "re_case_claim",
      params: { expand: ["transfer_reversal"] },
    });
  });

  it("fails closed on duplicate, drifted, or plausible untagged evidence", async () => {
    await rejectsReconciliationRequired(
      inspectCaseRefundProviderEffect(prepared(), {
        client: client([{
          data: [refund(), refund({ id: "re_duplicate" })],
          has_more: false,
        }]),
        providerAuthorizedAtSeconds: 1_777_046_000,
      }),
      /multiple refunds/,
    );
    await rejectsReconciliationRequired(
      inspectCaseRefundProviderEffect(prepared(), {
        client: client(
          [{ data: [refund()], has_more: false }],
          refund({ amount: 1324 }),
        ),
        providerAuthorizedAtSeconds: 1_777_046_000,
      }),
      /evidence drifted/,
    );
    await rejectsReconciliationRequired(
      inspectCaseRefundProviderEffect(prepared(), {
        client: client([{
          data: [refund({ id: "re_legacy", metadata: {} })],
          has_more: false,
        }]),
        providerAuthorizedAtSeconds: 1_777_046_000,
      }),
      /plausible untagged Case refund/,
    );
  });

  it("classifies terminal no-effect and rejects terminal reversal evidence", async () => {
    const terminal = refund({ status: "failed", transfer_reversal: null });
    const result = await inspectCaseRefundProviderEffect(prepared(), {
      client: client([{ data: [terminal], has_more: false }], terminal),
      providerAuthorizedAtSeconds: 1_777_046_000,
    });
    assert.equal(result.disposition, "TERMINAL_NO_EFFECT");

    const terminalWithReversal = refund({ status: "failed" });
    await rejectsReconciliationRequired(
      inspectCaseRefundProviderEffect(prepared(), {
        client: client(
          [{ data: [terminalWithReversal], has_more: false }],
          terminalWithReversal,
        ),
        providerAuthorizedAtSeconds: 1_777_046_000,
      }),
      /retains transfer-reversal evidence/,
    );
  });

  it("paginates by cursor and preserves raw provider failures", async () => {
    const fake = client([
      {
        data: [refund({ id: "re_page_1", amount: 100, metadata: {} })],
        has_more: true,
      },
      { data: [], has_more: false },
    ]);
    const result = await inspectCaseRefundProviderEffect(prepared(), {
      client: fake,
      providerAuthorizedAtSeconds: 1_777_046_000,
    });
    assert.equal(result.disposition, "ABSENT");
    assert.equal(fake.calls[1].params.starting_after, "re_page_1");

    const providerError = new Error("Stripe connection reset");
    await assert.rejects(
      inspectCaseRefundProviderEffect(prepared(), {
        client: {
          async list() {
            throw providerError;
          },
          async retrieve() {
            throw new Error("retrieve should not run");
          },
        },
        providerAuthorizedAtSeconds: 1_777_046_000,
      }),
      (error) => {
        assert.equal(error, providerError);
        assert.equal(
          isCaseRefundProviderReconciliationRequiredError(error),
          false,
        );
        return true;
      },
    );
  });
});
