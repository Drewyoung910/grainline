import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { labelClawbackErrorMessage, labelClawbackIdempotencyKey } from "../src/lib/labelClawbackState.ts";
import { labelClawbackRequest, recoverOrCreateLabelClawback, settleLabelClawback,
  LABEL_CLAWBACK_SAFE_REPLAY_MS } from "../src/lib/labelClawbackProvider.ts";

const now = Date.parse("2026-09-07T12:00:00.000Z");
const intent = { orderId: "order1", stripeTransferId: "tr_one", transactionId: "shippo1",
  rateObjectId: "rate1", amountCents: 475, currency: "usd", labelPurchasedAt: "2026-09-07T11:00:00.000Z" };
const claim = { ...intent, claimId: "order-label-claim:test", claimGeneration: 1, clawbackGeneration: 2, attemptCount: 2 };
const reversal = { id: "trr_one", amount: 475, currency: "usd", created: now / 1000,
  transfer: "tr_one", metadata: { orderId: "order1", reason: "label_cost_deduction" }, source_refund: null };
const timing = { now: () => now };
function provider() {
  const calls = [];
  return { calls, transfers: {
    async createReversal(...args) { calls.push(["create", ...args]); return reversal; },
  } };
}
function retrySubject(claims, client, finalize, clock = () => now, take = 1) {
  const { outputText } = ts.transpileModule(readFileSync("src/lib/labelClawbackRetry.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const localModule = { exports: {} };
  const dependencies = {
    "@sentry/nextjs": { captureException() {} }, "@/lib/stripe": { stripe: client },
    "@/lib/labelClawbackState": { labelClawbackErrorMessage, labelClawbackIdempotencyKey },
    "@/lib/labelClawbackProvider": { settleLabelClawback },
    "@/lib/orderLabelAuthority": { claimLabelClawbackBatch: async () => claims.splice(0, 1), finalizeLabelClawback: finalize },
  };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, localModule, localModule.exports);
  return localModule.exports.processLabelClawbackRetryBatch({ take, stripeClient: client, now: clock });
}

test("worker exactly replays the initial provider request", async () => {
  const client = provider();
  client.transfers.createReversal = async (_id, params) => {
    assert.deepEqual(params, labelClawbackRequest(intent).params);
    return reversal;
  };
  const result = await retrySubject([claim], client, async (input) => ({ outcome: input.outcome === "SUCCESS" ? "finalized" : "recorded_failure" }));
  assert.equal(result.reversed, 1);
});

test("worker never downgrades accepted provider success after a failed local write", async () => {
  const outcomes = [];
  await assert.rejects(retrySubject([claim], provider(), async (input) => {
    outcomes.push(input.outcome);
    if (input.outcome === "SUCCESS") throw new Error("local acknowledgement lost");
    return { outcome: "recorded_failure" };
  }), /local acknowledgement lost/);
  assert.deepEqual(outcomes, ["SUCCESS"]);
});

test("a fresh purchase permits only the canonical bounded request", async () => {
  const client = provider();
  assert.equal((await recoverOrCreateLabelClawback(intent, client, timing)).id, reversal.id);
  assert.deepEqual(client.calls.map(([kind]) => kind), ["create"]);
  assert.deepEqual(client.calls[0], ["create", "tr_one", { amount: 475,
    metadata: { orderId: "order1", reason: "label_cost_deduction" } },
  { timeout: 5000, maxNetworkRetries: 0, idempotencyKey: "label-cost:order1:shippo1:475" }]);
});

test("lost response and lost local acknowledgement recover one existing deduction", async () => {
  const stored = new Map();
  let creates = 0;
  const client = { transfers: {
    async createReversal(_id, params, options) {
      if (stored.has(options.idempotencyKey)) {
        assert.deepEqual(params, stored.get(options.idempotencyKey).params);
        return stored.get(options.idempotencyKey).result;
      }
      creates++; stored.set(options.idempotencyKey, { params, result: reversal });
      throw new Error("response lost");
    },
  } };
  const outcomes = [];
  await settleLabelClawback(claim, client, async (value) => {
    outcomes.push(value.outcome); return { outcome: "recorded_failure" };
  }, timing);
  await assert.rejects(settleLabelClawback(claim, client, async (value) => {
    outcomes.push(value.outcome); throw new Error("database unavailable");
  }, timing), /database unavailable/);
  const result = await settleLabelClawback(claim, client, async (value) => {
    outcomes.push(value.outcome); assert.equal(value.reversalId, reversal.id); return { outcome: "finalized" };
  }, timing);
  assert.equal(result.finalized.outcome, "finalized");
  assert.deepEqual(outcomes, ["FAILED", "SUCCESS", "SUCCESS"]);
  assert.equal(creates, 1);
});

test("late or missing clocks never issue another POST", async () => {
  for (const labelPurchasedAt of [undefined, null, "bad", "2026-09-08T00:00:00Z", "2026-02-30T11:00:00Z",
    new Date(now - LABEL_CLAWBACK_SAFE_REPLAY_MS).toISOString(), "2026-09-01T00:00:00Z"]) {
    const client = provider();
    await assert.rejects(recoverOrCreateLabelClawback({ ...intent, labelPurchasedAt }, client, timing), /window/);
    assert.equal(client.calls.filter(([kind]) => kind === "create").length, 0);
  }
});

test("UTC naive clocks are interpreted explicitly and equivalent offsets keep their age", async () => {
  const client = provider();
  await recoverOrCreateLabelClawback({ ...intent, labelPurchasedAt: "2026-09-07T11:00:00" }, client, timing);
  const zoned = provider();
  await recoverOrCreateLabelClawback({ ...intent, labelPurchasedAt: "2026-09-07T04:00:00-07:00" }, zoned, timing);
  assert.deepEqual(client.calls, zoned.calls);
});

test("returned money and identity must match the exact requested deduction", async () => {
  for (const patch of [{ amount: 476 }, { currency: "eur" }, { transfer: "tr_wrong" },
    { source_refund: "re_unrelated" }, { created: 1 }, { id: "bad" }]) {
    const bad = provider();
    bad.transfers.createReversal = async (...args) => {
      bad.calls.push(args); return { ...reversal, ...patch };
    };
    await assert.rejects(recoverOrCreateLabelClawback(intent, bad, timing));
    assert.equal(bad.calls.length, 1);
  }
});

test("exhausted provider budgets cannot issue another POST", async () => {
  const client = provider();
  await assert.rejects(recoverOrCreateLabelClawback(intent, client, { ...timing, deadline: now + 4999 }), /budget/);
  assert.equal(client.calls.length, 0);
  await assert.rejects(recoverOrCreateLabelClawback(intent, client, { now: () => NaN, deadline: now + 5000 }), /window/);
});

test("invalid source inputs and wrong returned reversal identities never finalize success", async () => {
  for (const patch of [{ orderId: " " }, { transactionId: null }, { amountCents: NaN },
    { amountCents: 0 }, { amountCents: 1.5 }, { currency: "USD" }]) {
    const client = provider();
    await assert.rejects(recoverOrCreateLabelClawback({ ...intent, ...patch }, client, timing));
    assert.equal(client.calls.length, 0);
  }
  const client = provider();
  client.transfers.createReversal = async () => ({ ...reversal, metadata: { orderId: "wrong" } });
  const outcomes = [];
  await settleLabelClawback(claim, client, async (input) => { outcomes.push(input.outcome); return {}; }, timing);
  assert.deepEqual(outcomes, ["FAILED"]);
});

test("worker stops claiming before its remaining provider budget is exhausted", async () => {
  let current = now;
  const claims = [claim, { ...claim, orderId: "untouched" }];
  const client = provider();
  client.transfers.createReversal = async () => {
    current += 36_000; return reversal;
  };
  const result = await retrySubject(claims, client, async () => ({ outcome: "finalized" }), () => current, 10);
  assert.equal(result.scanned, 1);
  assert.equal(claims.length, 1);
  assert.equal(result.reversed, 1);
  for (const take of [NaN, 1.5]) {
    const untouched = [claim];
    await assert.rejects(retrySubject(untouched, provider(), async () => ({}), () => now, take), /limit is invalid/);
    assert.equal(untouched.length, 1);
  }
});

test("provider failure retains durable retry state", async () => {
  const client = provider();
  client.transfers.createReversal = async () => { throw new Error("provider request failed"); };
  const outcomes = [];
  await settleLabelClawback(claim, client, async (input) => {
    outcomes.push(input.outcome); return { outcome: "recorded_failure" };
  }, timing);
  assert.deepEqual(outcomes, ["FAILED"]);
  assert.equal(client.calls.length, 0);
});

test("non-Error falsy throws are failures, never successful settlement", async () => {
  for (const error of [undefined, null, false, ""]) {
    const client = provider();
    client.transfers.createReversal = async () => { throw error; };
    const result = await retrySubject([claim], client, async () => ({ outcome: "recorded_failure" }));
    assert.equal(result.failed, 1);
    assert.equal(result.reversed, 0);
  }
});

test("a replacement label does not inherit a similar older label's identity", async () => {
  const client = provider();
  // No discovery API is used: historical Order/amount metadata cannot bind a label.
  client.transfers.listReversals = async () => { throw new Error("unsafe metadata recovery"); };
  const replacement = { ...intent, transactionId: "replacementLabel" };
  await recoverOrCreateLabelClawback(replacement, client, timing);
  assert.equal(client.calls[0][3].idempotencyKey, "label-cost:order1:replacementLabel:475");
  assert.notEqual(labelClawbackRequest(replacement).idempotencyKey, labelClawbackRequest(intent).idempotencyKey);
});

test("provider retention expiry cannot turn a lost-response retry into a second debit", async () => {
  let current = now;
  let debits = 0;
  const client = provider();
  client.transfers.createReversal = async () => { debits++; throw new Error("response lost"); };
  await assert.rejects(recoverOrCreateLabelClawback(intent, client, { now: () => current }), /response lost/);
  current += 25 * 60 * 60 * 1000;
  await assert.rejects(recoverOrCreateLabelClawback(intent, client, { now: () => current }), /window/);
  assert.equal(debits, 1);
});
