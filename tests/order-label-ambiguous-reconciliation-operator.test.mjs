import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ORDER_LABEL_AMBIGUOUS_RECONCILIATION_CONFIRMATION,
  assertOrderLabelAmbiguousReconciliationGitState,
  parseOrderLabelAmbiguousReconciliationConfig,
  runOrderLabelAmbiguousReconciliation,
  sanitizeOrderLabelReconciliationError,
  scanOrderLabelProviderTransactions,
  validateOrderLabelProviderTransaction,
  writeOrderLabelAmbiguousEvidence,
} from "../scripts/order-label-ambiguous-reconciliation-operator.mjs";

const COMMIT = "a".repeat(40);
const CLAIM_ID = `order-label-claim:${randomUUID()}`;
const RATE_ID = "shippo-rate-1";
const OWNER_URL = "postgresql://neondb_owner:owner-password@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full";
const RUNTIME_URL = "postgresql://grainline_app_runtime:runtime-password@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function baseEnv(directory) {
  return {
    DATABASE_URL: RUNTIME_URL,
    DIRECT_URL: OWNER_URL,
    MIGRATION_DB_ROLE: "neondb_owner",
    ORDER_LABEL_AMBIGUOUS_RECONCILIATION_CLAIM_GENERATION: "7",
    ORDER_LABEL_AMBIGUOUS_RECONCILIATION_CLAIM_ID: CLAIM_ID,
    ORDER_LABEL_AMBIGUOUS_RECONCILIATION_CONFIRM:
      ORDER_LABEL_AMBIGUOUS_RECONCILIATION_CONFIRMATION,
    ORDER_LABEL_AMBIGUOUS_RECONCILIATION_EVIDENCE_PATH: path.join(
      directory,
      `order-label-ambiguous-reconciliation-${COMMIT}-7.json`,
    ),
    ORDER_LABEL_AMBIGUOUS_RECONCILIATION_EXPECTED_COMMIT: COMMIT,
    ORDER_LABEL_AMBIGUOUS_RECONCILIATION_ORDER_ID: "order-1",
    ORDER_LABEL_AMBIGUOUS_RECONCILIATION_STAFF_USER_ID: "staff-1",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256: sha256(OWNER_URL),
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    SHIPPO_API_KEY: "shippo_live_secret",
    STRIPE_SECRET_KEY: "sk_live_secret",
  };
}

function config(directory, overrides = {}) {
  return parseOrderLabelAmbiguousReconciliationConfig(
    { ...baseEnv(directory), ...overrides },
    { evidenceDirectory: directory, evidenceExists: () => false },
  );
}

function claim(startedAt = Date.now() - 2 * 60 * 60 * 1000) {
  return {
    amountCents: 475,
    claimGeneration: 7,
    claimId: CLAIM_ID,
    claimStartedAtEpochMillis: startedAt,
    currency: "usd",
    orderId: "order-1",
    rateObjectId: RATE_ID,
    sellerActorUserId: "seller-user-1",
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function transaction(overrides = {}) {
  return {
    label_url: "https://labels.example.test/label.pdf",
    metadata: CLAIM_ID,
    object_id: "shippo-transaction-1",
    rate: {
      amount: "4.75",
      currency: "USD",
      object_id: RATE_ID,
      provider: "UPS",
    },
    status: "SUCCESS",
    test: false,
    tracking_number: "tracking-1",
    ...overrides,
  };
}

function fakeOwnerClient(claimValue, calls) {
  return {
    async query(sql, params) {
      if (sql.includes("ambiguous_claim_read")) {
        return { rows: [{ result: { ...claimValue, outcome: "ready" } }] };
      }
      if (sql.includes("ambiguous_release")) {
        calls.push({ params, sql });
        return { rows: [{ result: { outcome: "released", orderId: "order-1" } }] };
      }
      throw new Error("unexpected owner query");
    },
  };
}

function appDependencies(recorded, events) {
  return {
    async finalizeLabelClawback(input) {
      events.push({ input, type: "clawback" });
      return input.outcome === "SUCCESS"
        ? { outcome: "finalized" }
        : { clawbackStatus: "RETRY_PENDING", outcome: "recorded_failure" };
    },
    async finalizeSellerLabelProviderResult(input) {
      events.push({ input, type: "provider" });
      return recorded;
    },
    labelClawbackErrorMessage(error) {
      return error instanceof Error ? error.message : String(error);
    },
    labelClawbackIdempotencyKey(input) {
      events.push({ input, type: "idempotency" });
      return "label-cost:fixed";
    },
  };
}

describe("Order label ambiguous reconciliation operator", () => {
  it("pins exact production identities, modes, evidence and git state", () => {
    const directory = path.join(os.tmpdir(), "order-label-evidence");
    const parsed = config(directory);
    assert.equal(parsed.shippoTestMode, false);
    assert.equal(parsed.claimGeneration, 7);
    assert.deepEqual(
      assertOrderLabelAmbiguousReconciliationGitState(
        { head: COMMIT, status: "" },
        COMMIT,
      ),
      { clean: true, head: COMMIT },
    );
    assert.throws(
      () => config(directory, { STRIPE_SECRET_KEY: "sk_test_secret" }),
      /credential modes do not match/,
    );
    assert.throws(
      () => config(directory, { DATABASE_URL: OWNER_URL }),
      /database roles or production target drifted/,
    );
    assert.throws(
      () => assertOrderLabelAmbiguousReconciliationGitState(
        { head: COMMIT, status: " M file" },
        COMMIT,
      ),
      /exact clean reviewed commit/,
    );
  });

  it("validates source-derived provider identity, mode, money and artifacts", () => {
    const accepted = validateOrderLabelProviderTransaction(
      transaction(),
      transaction().rate,
      claim(),
      false,
    );
    assert.equal(accepted.amountCents, 475);
    assert.equal(accepted.kind, "provider_success");
    assert.equal(
      validateOrderLabelProviderTransaction(
        transaction({ status: "ERROR", label_url: null }),
        null,
        claim(),
        false,
      ).kind,
      "provider_error",
    );
    for (const [overrides, pattern] of [
      [{ metadata: "wrong" }, /metadata/],
      [{ test: true }, /mode/],
      [{ rate: { ...transaction().rate, object_id: "wrong" } }, /rate/],
      [{ status: "QUEUED" }, /terminal/],
      [{ label_url: "http://unsafe.test/label" }, /success evidence/],
    ]) {
      assert.throws(
        () => validateOrderLabelProviderTransaction(
          transaction(overrides),
          transaction(overrides).rate,
          claim(),
          false,
        ),
        pattern,
      );
    }
    assert.throws(
      () => validateOrderLabelProviderTransaction(
        transaction(),
        { ...transaction().rate, amount: "47.50" },
        claim(),
        false,
      ),
      /success evidence/,
    );
  });

  it("exhaustively paginates only the exact rate scope and rejects duplicate matches", async () => {
    const directory = path.join(os.tmpdir(), "order-label-evidence");
    const parsed = config(directory);
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (calls.length === 1) {
        return jsonResponse({
          count: 2,
          next: `${"https://api.goshippo.com/transactions/"}?rate=${RATE_ID}&results=100&page=2`,
          results: [transaction({ metadata: "other-claim", object_id: "tx-other" })],
        });
      }
      return jsonResponse({
        count: 2,
        next: null,
        results: [transaction()],
      });
    };
    const result = await scanOrderLabelProviderTransactions(claim(), parsed, fetchImpl);
    assert.equal(result.kind, "provider_success");
    assert.equal(calls.length, 2);

    const duplicateFetch = async () => jsonResponse({
      count: 2,
      next: null,
      results: [transaction(), transaction({ object_id: "shippo-transaction-2" })],
    });
    await assert.rejects(
      scanOrderLabelProviderTransactions(claim(), parsed, duplicateFetch),
      /multiple transactions/,
    );

    const requested = config(directory, {
      ORDER_LABEL_AMBIGUOUS_RECONCILIATION_TRANSACTION_ID: "shippo-transaction-1",
    });
    await assert.rejects(
      scanOrderLabelProviderTransactions(claim(), requested, duplicateFetch),
      /multiple transactions/,
    );
    await assert.rejects(
      scanOrderLabelProviderTransactions(
        claim(),
        requested,
        async () => jsonResponse({
          count: 1,
          next: null,
          results: [transaction({ object_id: "shippo-transaction-other" })],
        }),
      ),
      /not the unique exact-claim match/,
    );

    const escapedFetch = async () => jsonResponse({
      count: 1,
      next: "https://evil.example/transactions/?rate=shippo-rate-1&results=100&page=2",
      results: [],
    });
    await assert.rejects(
      scanOrderLabelProviderTransactions(claim(), parsed, escapedFetch),
      /escaped the exact reviewed scope/,
    );

    const truncatedFetch = async () => jsonResponse({
      count: 2,
      next: null,
      results: [transaction({ metadata: "other-claim" })],
    });
    await assert.rejects(
      scanOrderLabelProviderTransactions(claim(), parsed, truncatedFetch),
      /incomplete or overlong/,
    );

    const repeatedFetch = async () => jsonResponse({
      count: 2,
      next: null,
      results: [
        transaction({ metadata: "other-1" }),
        transaction({ metadata: "other-2" }),
      ],
    });
    await assert.rejects(
      scanOrderLabelProviderTransactions(claim(), parsed, repeatedFetch),
      /repeated a transaction identity/,
    );
  });

  it("keeps absent provider evidence fenced and releases only exact ERROR", async () => {
    const directory = path.join(os.tmpdir(), "order-label-evidence");
    const releaseCalls = [];
    const parsed = config(directory);
    const noMatchFetch = async () => jsonResponse({ count: 0, next: null, results: [] });
    const oldClaim = claim();
    const noMatch = await runOrderLabelAmbiguousReconciliation(parsed, {
      appDependencies: {},
      fetchImpl: noMatchFetch,
      ownerClient: fakeOwnerClient(oldClaim, releaseCalls),
      stripeClient: {},
    });
    assert.equal(noMatch.outcome.status, "provider-escalation-required");
    assert.equal(noMatch.outcome.productionChanged, false);
    assert.equal(noMatch.outcome.databaseOutcome, "not_released");
    assert.equal(releaseCalls.length, 0);

    const errorReleaseCalls = [];
    const exactConfig = config(directory, {
      ORDER_LABEL_AMBIGUOUS_RECONCILIATION_TRANSACTION_ID: "shippo-transaction-1",
    });
    const errorResult = await runOrderLabelAmbiguousReconciliation(exactConfig, {
      appDependencies: {},
      fetchImpl: async () => jsonResponse({
        count: 1,
        next: null,
        results: [transaction({ status: "ERROR" })],
      }),
      ownerClient: fakeOwnerClient(oldClaim, errorReleaseCalls),
      stripeClient: {},
    });
    assert.equal(errorResult.outcome.status, "released-provider-error");
    assert.equal(errorReleaseCalls[0].params[4], "PROVIDER_ERROR");

    const recovered = await runOrderLabelAmbiguousReconciliation(exactConfig, {
      appDependencies: {},
      fetchImpl: async () => { throw new Error("provider must not be called"); },
      ownerClient: {
        async query() {
          return { rows: [{ result: {
            auditLogId: "order-label-ambiguous-release-1",
            claimGeneration: 7,
            claimId: CLAIM_ID,
            orderId: "order-1",
            outcome: "released",
            providerScanSha256: "b".repeat(64),
            resolution: "PROVIDER_ERROR",
          } }] };
        },
      },
      stripeClient: {},
    });
    assert.equal(recovered.outcome.status, "already-released");
    assert.equal(recovered.outcome.productionChanged, false);
  });

  it("records one exact success and converges or defers its Stripe clawback", async () => {
    const directory = path.join(os.tmpdir(), "order-label-evidence");
    const parsed = config(directory, {
      ORDER_LABEL_AMBIGUOUS_RECONCILIATION_TRANSACTION_ID: "shippo-transaction-1",
    });
    const baseRecorded = {
      amountCents: 475,
      auditLogId: "audit-1",
      buyerEmail: null,
      buyerName: null,
      buyerUserId: "buyer-1",
      carrier: "UPS",
      claimGeneration: 7,
      claimId: CLAIM_ID,
      clawbackGeneration: 2,
      clawbackStatus: "RETRYING",
      currency: "usd",
      estimatedDeliveryDate: null,
      labelPurchasedAt: new Date().toISOString(),
      orderId: "order-1",
      outcome: "recorded",
      rateObjectId: RATE_ID,
      stripeTransferId: "transfer-1",
      trackingNumber: "tracking-1",
      transactionId: "shippo-transaction-1",
    };
    const successEvents = [];
    const success = await runOrderLabelAmbiguousReconciliation(parsed, {
      appDependencies: appDependencies(baseRecorded, successEvents),
      fetchImpl: async () => jsonResponse({
        count: 1,
        next: null,
        results: [transaction()],
      }),
      ownerClient: fakeOwnerClient(claim(), []),
      stripeClient: {
        transfers: {
          async createReversal(_transfer, _input, options) {
            assert.equal(options.idempotencyKey, "label-cost:fixed");
            return { id: "reversal-1" };
          },
        },
      },
    });
    assert.equal(success.outcome.status, "recorded-and-finalized");
    assert.equal(success.outcome.clawbackStatus, "REVERSED");
    assert.equal(successEvents.filter((event) => event.type === "provider").length, 1);
    assert.equal(successEvents.at(-1).input.outcome, "SUCCESS");

    const failureEvents = [];
    const deferred = await runOrderLabelAmbiguousReconciliation(parsed, {
      appDependencies: appDependencies(baseRecorded, failureEvents),
      fetchImpl: async () => jsonResponse({
        count: 1,
        next: null,
        results: [transaction()],
      }),
      ownerClient: fakeOwnerClient(claim(), []),
      stripeClient: {
        transfers: { async createReversal() { throw new Error("bounded Stripe failure"); } },
      },
    });
    assert.equal(deferred.outcome.status, "recorded-with-clawback-follow-up");
    assert.equal(deferred.outcome.clawbackStatus, "RETRY_PENDING");
    assert.equal(failureEvents.at(-1).input.outcome, "FAILED");

    const restartEvents = [];
    const restarted = await runOrderLabelAmbiguousReconciliation(
      config(directory),
      {
        appDependencies: appDependencies(
          { ...baseRecorded, clawbackStatus: "RETRY_PENDING" },
          restartEvents,
        ),
        fetchImpl: async (url) => {
          assert.match(url, /transactions\/\?rate=shippo-rate-1/);
          return jsonResponse({ count: 1, next: null, results: [transaction()] });
        },
        ownerClient: {
          async query() {
            return { rows: [{ result: {
              ...claim(),
              claimStartedAtEpochMillis: undefined,
              clawbackGeneration: 2,
              clawbackStatus: "RETRY_PENDING",
              outcome: "recorded",
              stripeTransferId: "transfer-1",
              transactionId: "shippo-transaction-1",
            } }] };
          },
        },
        stripeClient: { transfers: { async createReversal() {
          throw new Error("retry-pending rows must stay with the batch worker");
        } } },
      },
    );
    assert.equal(restarted.outcome.status, "recorded-with-clawback-follow-up");
    assert.equal(restarted.outcome.clawbackStatus, "RETRY_PENDING");
    assert.equal(restartEvents.filter((event) => event.type === "provider").length, 1);
  });

  it("writes only private sanitized evidence", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "order-label-reconciliation-"));
    try {
      const evidencePath = path.join(directory, "evidence.json");
      writeOrderLabelAmbiguousEvidence(evidencePath, {
        claimIdSha256: sha256(CLAIM_ID),
        status: "provider-escalation-required",
      });
      assert.equal(lstatSync(evidencePath).mode & 0o077, 0);
      assert.doesNotMatch(readFileSync(evidencePath, "utf8"), /order-label-claim:/);
      assert.throws(
        () => writeOrderLabelAmbiguousEvidence(path.join(directory, "unsafe.json"), {
          claimId: CLAIM_ID,
        }),
        /sensitive raw identity/,
      );
      assert.equal(
        sanitizeOrderLabelReconciliationError(
          new Error(`failed ${OWNER_URL} ${CLAIM_ID} shippo_live_secret`),
        ),
        "failed [redacted-database-url] [redacted-claim-id] [redacted-provider-secret]",
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
