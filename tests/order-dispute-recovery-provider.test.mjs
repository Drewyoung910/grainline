import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadTypescriptModule(path, dependencies) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const localModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    if (name.startsWith("node:")) return require(name);
    assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
    return dependencies[name];
  }, localModule, localModule.exports);
  return localModule.exports;
}

const providerModule = loadTypescriptModule(
  "src/lib/orderDisputeRecoveryProvider.ts",
  {
    "@/lib/stripe": { stripe: {} },
    "@/lib/orderDisputeRecoveryAuthority": {
      finalizeOrderDisputeRecovery: async () => {
        throw new Error("unexpected default finalizer");
      },
    },
  },
);
const { settleOrderDisputeRecovery } = providerModule;

const reverseClaim = Object.freeze({
  recoveryId: "order-dispute-recovery:11111111-1111-4111-8111-111111111111",
  orderId: "order-one",
  disputeId: "du_one",
  action: "REVERSE",
  claimGeneration: 1,
  attemptCount: 1,
  stripeTransferId: "tr_seller",
  amountCents: 3_000,
  currency: "usd",
  reversalId: null,
  reversedAmountCents: null,
  sellerStripeAccountId: null,
});

function expectedMetadata(action) {
  return {
    grainline_order_id: "order-one",
    grainline_dispute_id: "du_one",
    grainline_dispute_action: action,
  };
}

function stripeClient(overrides = {}) {
  const calls = [];
  const client = {
    calls,
    transfers: {
      async retrieve(id, options) {
        calls.push(["retrieve", id, options]);
        return {
          id: "tr_seller",
          amount: 10_000,
          amount_reversed: 0,
          currency: "usd",
          destination: "acct_seller",
        };
      },
      async listReversals(id, params, options) {
        calls.push(["listReversals", id, params, options]);
        return { data: [], has_more: false };
      },
      async createReversal(id, params, options) {
        calls.push(["createReversal", id, params, options]);
        return {
          id: "trr_dispute",
          amount: params.amount,
          currency: "usd",
          transfer: id,
          source_refund: null,
          metadata: params.metadata,
        };
      },
      async list(params, options) {
        calls.push(["list", params, options]);
        return { data: [], has_more: false };
      },
      async create(params, options) {
        calls.push(["create", params, options]);
        return { id: "tr_restore", ...params };
      },
      ...overrides,
    },
  };
  return client;
}

async function settle(claim, client) {
  const finalized = [];
  const result = await settleOrderDisputeRecovery(
    claim,
    client,
    async (input) => {
      finalized.push(input);
      return { outcome: input.outcome === "FAILED" ? "recorded_failure" : "finalized" };
    },
  );
  return { result, finalized };
}

test("a partial dispute reverses only the disputed seller-transfer amount", async () => {
  const client = stripeClient();
  const { result, finalized } = await settle(reverseClaim, client);
  assert.equal(result.providerFailed, false);
  assert.deepEqual(finalized, [{
    recoveryId: reverseClaim.recoveryId,
    claimGeneration: 1,
    outcome: "SUCCESS",
    providerObjectId: "trr_dispute",
    amountCents: 3_000,
    sellerStripeAccountId: "acct_seller",
  }]);
  const create = client.calls.find(([kind]) => kind === "createReversal");
  assert.equal(create[2].amount, 3_000);
  assert.deepEqual(create[2].metadata, expectedMetadata("reversal"));
  assert.match(create[3].idempotencyKey, /^grainline-dispute:[0-9a-f]{40}:reverse$/);
});

test("other transfer reversals cap recovery at the remaining seller funds", async () => {
  const client = stripeClient({
    async retrieve() {
      return {
        id: "tr_seller",
        amount: 10_000,
        amount_reversed: 8_500,
        currency: "usd",
        destination: "acct_seller",
      };
    },
  });
  const { finalized } = await settle(reverseClaim, client);
  assert.equal(finalized[0].amountCents, 1_500);
  assert.equal(
    client.calls.find(([kind]) => kind === "createReversal")[2].amount,
    1_500,
  );
});

test("an exhausted transfer records no effect and never creates another reversal", async () => {
  const client = stripeClient({
    async retrieve() {
      return {
        id: "tr_seller",
        amount: 10_000,
        amount_reversed: 10_000,
        currency: "usd",
        destination: "acct_seller",
      };
    },
  });
  const { finalized } = await settle(reverseClaim, client);
  assert.equal(finalized[0].outcome, "NOOP");
  assert.equal(client.calls.some(([kind]) => kind === "createReversal"), false);
});

test("lost acknowledgements rediscover one exact reversal instead of posting again", async () => {
  const existing = {
    id: "trr_existing",
    amount: 3_000,
    currency: "usd",
    transfer: "tr_seller",
    source_refund: null,
    metadata: expectedMetadata("reversal"),
  };
  const client = stripeClient({
    async listReversals() {
      return { data: [existing], has_more: false };
    },
  });
  const { finalized } = await settle(reverseClaim, client);
  assert.equal(finalized[0].providerObjectId, "trr_existing");
  assert.equal(client.calls.some(([kind]) => kind === "createReversal"), false);
});

test("ambiguous duplicate provider evidence fails closed into durable retry state", async () => {
  const duplicate = {
    id: "trr_existing",
    amount: 3_000,
    currency: "usd",
    transfer: "tr_seller",
    source_refund: null,
    metadata: expectedMetadata("reversal"),
  };
  const client = stripeClient({
    async listReversals() {
      return { data: [duplicate, { ...duplicate, id: "trr_other" }], has_more: false };
    },
  });
  const { result, finalized } = await settle(reverseClaim, client);
  assert.equal(result.providerFailed, true);
  assert.equal(finalized[0].outcome, "FAILED");
  assert.match(finalized[0].errorSummary, /multiple matching reversals/);
});

test("funds reinstatement restores exactly the amount Grainline reversed", async () => {
  const claim = {
    ...reverseClaim,
    action: "RESTORE",
    claimGeneration: 2,
    attemptCount: 2,
    reversalId: "trr_dispute",
    reversedAmountCents: 1_500,
    sellerStripeAccountId: "acct_seller",
  };
  const client = stripeClient();
  const { finalized } = await settle(claim, client);
  const create = client.calls.find(([kind]) => kind === "create");
  assert.equal(create[1].amount, 1_500);
  assert.equal(create[1].destination, "acct_seller");
  assert.deepEqual(create[1].metadata, expectedMetadata("restoration"));
  assert.equal(finalized[0].amountCents, 1_500);
  assert.equal(finalized[0].providerObjectId, "tr_restore");
});

test("provider failure is recorded, but local acknowledgement failure remains retryable", async () => {
  const failedClient = stripeClient({
    async retrieve() {
      throw new Error("provider unavailable");
    },
  });
  const failed = await settle(reverseClaim, failedClient);
  assert.equal(failed.result.providerFailed, true);
  assert.equal(failed.finalized[0].outcome, "FAILED");

  const outcomes = [];
  await assert.rejects(
    settleOrderDisputeRecovery(reverseClaim, stripeClient(), async (input) => {
      outcomes.push(input.outcome);
      throw new Error("local acknowledgement lost");
    }),
    /local acknowledgement lost/,
  );
  assert.deepEqual(outcomes, ["SUCCESS"]);
});

test("retry worker claims near execution and stops before its provider budget expires", async () => {
  let current = 1_000_000;
  const claims = [reverseClaim, { ...reverseClaim, recoveryId:
    "order-dispute-recovery:22222222-2222-4222-8222-222222222222" }];
  const client = stripeClient({
    async createReversal(id, params) {
      current += 30_000;
      return {
        id: "trr_dispute",
        amount: params.amount,
        currency: "usd",
        transfer: id,
        source_refund: null,
        metadata: params.metadata,
      };
    },
  });
  const retry = loadTypescriptModule("src/lib/orderDisputeRecoveryRetry.ts", {
    "@sentry/nextjs": { captureMessage() {} },
    "@/lib/stripe": { stripe: client },
    "@/lib/orderDisputeRecoveryAuthority": {
      claimOrderDisputeRecoveryBatch: async () => claims.splice(0, 1),
      finalizeOrderDisputeRecovery: async (input) => ({
        outcome: input.outcome === "FAILED" ? "recorded_failure" : "finalized",
      }),
    },
    "@/lib/orderDisputeRecoveryProvider": providerModule,
  });
  const result = await retry.processOrderDisputeRecoveryBatch({
    take: 10,
    stripeClient: client,
    now: () => current,
  });
  assert.equal(result.scanned, 1);
  assert.equal(result.finalized, 1);
  assert.equal(claims.length, 1);
});
