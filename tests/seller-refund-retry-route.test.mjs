import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";

const require = createRequire(import.meta.url);

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
}

class ReconciliationRequired extends Error {}
class TerminalStatus extends Error {}

const claim = { claimId: "order_refund_claim_1", claimGeneration: 1n, refundAmountCents: 5000, action: "replay" };
const refund = { primaryRefundId: "re_1", refundIds: ["re_1"] };

// The real route, with the database and Stripe replaced. Which state the order
// is in comes from these answers, as it would from the fixed SQL functions.
function fixture({ decisions, claimResult = claim, provider = async () => refund }) {
  const path = "src/app/api/orders/[id]/refund/route.ts";
  const state = { claims: 0, providerCalls: 0, finalized: 0, ambiguous: [] };
  const queue = [...decisions];
  const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => undefined });
  const dependencies = {
    zod: require("zod"),
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk" }) },
    "@/lib/ensureUser": { ensureUserByClerkId: async () => ({ id: "maker" }) },
    "@/lib/apiAccountAccess": { accountAccessErrorResponse: () => null },
    "@/lib/ratelimit": {
      refundRatelimit: {},
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => Response.json({}, { status: 429 }),
    },
    "@/lib/refundRouteState": {
      sellerRefundPreflightConflictResponse: (decision) => (
        decision === "READY" ? null : { status: 409, error: decision }
      ),
    },
    "@/lib/requestBody": {
      readBoundedJson: (request) => request.json(),
      isRequestBodyTooLargeError: () => false,
      isInvalidJsonBodyError: () => false,
    },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/privateResponse": {
      privateJson: (body, init) => Response.json(body, init),
      privateResponse: (response) => response,
    },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/orderSellerRefundPreflightAuthority": { sellerRefundPreflight: async () => queue.shift() },
    "@/lib/orderRefundClaimAuthority": {
      claimSellerOrderRefund: async () => {
        state.claims += 1;
        return claimResult;
      },
    },
    "@/lib/orderRefundRecordAuthority": { orderRefundProviderEvidence: () => ({ evidence: true }) },
    "@/lib/orderRefundFinalization": {
      finalizeSellerOrderRefund: async () => {
        state.finalized += 1;
        return { restoredActiveListingCount: 0 };
      },
    },
    "@/lib/marketplaceRefunds": { StripeRefundTerminalStatusError: TerminalStatus },
    "@/lib/orderRefundProviderReconciliation": {
      isOrderRefundProviderReconciliationRequiredError: (error) => error instanceof ReconciliationRequired,
      resolveOrderRefundProviderOutcome: async () => {
        state.providerCalls += 1;
        return provider();
      },
    },
    "@/lib/orderRefundReconciliationAuthority": {
      markOrderRefundClaimAmbiguous: async (input) => state.ambiguous.push(input.reason),
    },
  };
  const exports = {};
  vm.runInNewContext(compile(readFileSync(path, "utf8")), {
    exports, Response, String, console,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return {
    state,
    post: () => exports.POST(
      new Request("https://example.test/api/orders/order/refund", {
        method: "POST",
        body: JSON.stringify({ type: "FULL" }),
      }),
      { params: Promise.resolve({ id: "order" }) },
    ),
  };
}

test("retrying an unconfirmed refund finishes it, as the 503 promises", async () => {
  const subject = fixture({ decisions: ["PROCESSING"] });
  const response = await subject.post();
  assert.equal(response.status, 200);
  assert.equal(subject.state.providerCalls, 1);
  assert.equal(subject.state.finalized, 1);
});

test("a refund someone else is running gets the conflict and no Stripe call", async () => {
  const subject = fixture({ decisions: ["PROCESSING", "PROCESSING"], claimResult: null });
  const response = await subject.post();
  assert.equal(response.status, 409);
  assert.equal(subject.state.providerCalls, 0);
});

test("a recorded refund is still refused before any claim", async () => {
  const subject = fixture({ decisions: ["RECORDED"] });
  const response = await subject.post();
  assert.equal(response.status, 409);
  assert.equal(subject.state.claims, 0);
});

test("a refund Stripe says failed goes to staff at once, not back to the maker", async () => {
  const subject = fixture({
    decisions: ["READY"],
    provider: async () => {
      throw new TerminalStatus("Stripe refund re_1 returned failed status.");
    },
  });
  const response = await subject.post();
  assert.equal(response.status, 409);
  assert.deepEqual(subject.state.ambiguous, ["SELLER_PROVIDER_AMBIGUOUS"]);
});

test("a dropped connection stays retryable and does not bother staff", async () => {
  const subject = fixture({
    decisions: ["READY"],
    provider: async () => {
      throw new Error("connection dropped");
    },
  });
  const response = await subject.post();
  assert.equal(response.status, 503);
  assert.deepEqual(subject.state.ambiguous, []);
});
