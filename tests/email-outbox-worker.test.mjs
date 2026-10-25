import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { processClaimedEmailOutboxJob } = await import(
  "../src/lib/emailOutboxWorker.ts"
);

const checkedAt = new Date("2026-10-25T12:00:00.000Z");

function claim(overrides = {}) {
  return {
    jobId: "job-1",
    claimGeneration: 1n,
    claimToken: "11111111-1111-4111-8111-111111111111",
    recipientEmail: "buyer@example.com",
    recipientUserId: "user-1",
    preferenceKey: null,
    templateName: "order_shipped",
    templateVersion: 1,
    payloadVersion: null,
    payload: null,
    dedupKey: "order-shipped:one",
    createdAt: new Date("2026-10-25T11:00:00.000Z"),
    legacySubject: "Your order shipped",
    legacyHtml: "<p>Shipped</p>",
    lane: "TRANSACTIONAL",
    ...overrides,
  };
}

function harness(overrides = {}) {
  const calls = [];
  const dependencies = {
    providerConfigured: true,
    now: () => checkedAt,
    reserveRecipient: async (...args) => {
      calls.push(["reserveRecipient", ...args]);
      return { allowed: 1, counterAvailable: true };
    },
    reserveGlobal: async (...args) => {
      calls.push(["reserveGlobal", ...args]);
      return { allowed: 1, counterAvailable: true };
    },
    rollbackRecipient: async (...args) => {
      calls.push(["rollbackRecipient", ...args]);
    },
    rollbackGlobal: async (...args) => {
      calls.push(["rollbackGlobal", ...args]);
    },
    defer: async (...args) => {
      calls.push(["defer", ...args]);
      return "applied";
    },
    beginProviderAttempt: async (...args) => {
      calls.push(["begin", ...args]);
      return "ready";
    },
    sendLegacy: async (...args) => {
      calls.push(["send", ...args]);
      return "provider-message-1";
    },
    renderStructured: (...args) => {
      calls.push(["renderStructured", ...args]);
      return { subject: "Rendered subject", html: "<p>Rendered body</p>" };
    },
    sendStructured: async (...args) => {
      calls.push(["sendStructured", ...args]);
      return "provider-message-1";
    },
    complete: async (...args) => {
      calls.push(["complete", ...args]);
      return "applied";
    },
    fail: async (...args) => {
      calls.push(["fail", ...args]);
      return "applied";
    },
    classifyFailure: () => "unexpected_internal",
    sanitizeFailure: (error) => String(error),
    ...overrides,
  };
  return { calls, dependencies };
}

function callNames(calls) {
  return calls.map(([name]) => name);
}

describe("email outbox worker", () => {
  it("defers an optional job at the recipient cap before global quota or provider work", async () => {
    const { calls, dependencies } = harness({
      reserveRecipient: async (...args) => {
        calls.push(["reserveRecipient", ...args]);
        return { allowed: 0, counterAvailable: true };
      },
    });

    const result = await processClaimedEmailOutboxJob(
      claim({ lane: "OPTIONAL" }),
      dependencies,
    );

    assert.equal(result, "capped");
    assert.deepEqual(callNames(calls), ["reserveRecipient", "defer"]);
    assert.equal(calls[1][2], "recipient_optional_quota");
  });

  it("rolls back an optional recipient reservation when the global optional pool is full", async () => {
    const { calls, dependencies } = harness({
      reserveGlobal: async (...args) => {
        calls.push(["reserveGlobal", ...args]);
        return { allowed: 0, counterAvailable: true };
      },
    });

    const result = await processClaimedEmailOutboxJob(
      claim({ lane: "OPTIONAL" }),
      dependencies,
    );

    assert.equal(result, "capped");
    assert.deepEqual(callNames(calls), [
      "reserveRecipient",
      "reserveGlobal",
      "rollbackRecipient",
      "rollbackGlobal",
      "defer",
    ]);
    assert.equal(calls.at(-1)[2], "optional_global_quota");
  });

  it("reserves transactional capacity without applying the optional recipient cap", async () => {
    const { calls, dependencies } = harness();

    const result = await processClaimedEmailOutboxJob(claim(), dependencies);

    assert.equal(result, "sent");
    assert.deepEqual(callNames(calls), ["reserveGlobal", "begin", "send", "complete"]);
    assert.equal(calls[0][1], "TRANSACTIONAL");
    assert.equal(calls[3][2], "provider-message-1");
  });

  it("uses the transactional quota deferral when the shared daily limit is full", async () => {
    const { calls, dependencies } = harness({
      reserveGlobal: async (...args) => {
        calls.push(["reserveGlobal", ...args]);
        return { allowed: 0, counterAvailable: true };
      },
    });

    const result = await processClaimedEmailOutboxJob(claim(), dependencies);

    assert.equal(result, "capped");
    assert.deepEqual(callNames(calls), [
      "reserveGlobal",
      "rollbackRecipient",
      "rollbackGlobal",
      "defer",
    ]);
    assert.equal(calls.at(-1)[2], "transactional_global_quota");
  });

  it("defers and rolls back reservations when the global quota service is unavailable", async () => {
    const { calls, dependencies } = harness({
      reserveGlobal: async (...args) => {
        calls.push(["reserveGlobal", ...args]);
        return { allowed: 0, counterAvailable: false };
      },
    });

    const result = await processClaimedEmailOutboxJob(
      claim({ lane: "OPTIONAL" }),
      dependencies,
    );

    assert.equal(result, "deferred");
    assert.deepEqual(callNames(calls), [
      "reserveRecipient",
      "reserveGlobal",
      "rollbackRecipient",
      "rollbackGlobal",
      "defer",
    ]);
    assert.equal(calls.at(-1)[2], "quota_unavailable");
  });

  it("does not release an optional recipient reservation twice when quota deferral fails", async () => {
    let recipientReservations = 0;
    const { dependencies } = harness({
      reserveRecipient: async () => {
        recipientReservations += 1;
        return { allowed: 1, counterAvailable: true };
      },
      reserveGlobal: async () => ({ allowed: 0, counterAvailable: true }),
      rollbackRecipient: async (_recipientEmail, requested) => {
        recipientReservations -= requested;
      },
      defer: async () => {
        throw new Error("deferral write failed");
      },
    });

    const result = await processClaimedEmailOutboxJob(
      claim({ lane: "OPTIONAL" }),
      dependencies,
    );

    assert.equal(result, "failed");
    assert.equal(recipientReservations, 0);
  });

  it("rolls back both reservations when its generation-fenced provider start is stale", async () => {
    const { calls, dependencies } = harness({
      beginProviderAttempt: async (...args) => {
        calls.push(["begin", ...args]);
        return "stale_claim";
      },
    });

    const result = await processClaimedEmailOutboxJob(
      claim({ lane: "OPTIONAL" }),
      dependencies,
    );

    assert.equal(result, "unclaimed");
    assert.deepEqual(callNames(calls), [
      "reserveRecipient",
      "reserveGlobal",
      "begin",
      "rollbackRecipient",
      "rollbackGlobal",
    ]);
  });

  it("rolls back quota when the provider boundary finds the recipient newly ineligible", async () => {
    const { calls, dependencies } = harness({
      beginProviderAttempt: async (...args) => {
        calls.push(["begin", ...args]);
        return "ineligible";
      },
    });

    const result = await processClaimedEmailOutboxJob(
      claim({ lane: "OPTIONAL" }),
      dependencies,
    );

    assert.equal(result, "unclaimed");
    assert.deepEqual(callNames(calls), [
      "reserveRecipient",
      "reserveGlobal",
      "begin",
      "rollbackRecipient",
      "rollbackGlobal",
    ]);
    assert.equal(callNames(calls).includes("send"), false);
  });

  it("records a retryable provider failure without releasing consumed quota", async () => {
    const providerError = Object.assign(new Error("provider unavailable"), { status: 503 });
    const seenFailures = [];
    const { calls, dependencies } = harness({
      sendLegacy: async (...args) => {
        calls.push(["send", ...args]);
        throw providerError;
      },
      classifyFailure: () => "provider_retryable",
      sanitizeFailure: () => "provider unavailable",
      onFailure: (...args) => seenFailures.push(args),
    });

    const job = claim();
    const result = await processClaimedEmailOutboxJob(job, dependencies);

    assert.equal(result, "failed");
    assert.deepEqual(callNames(calls), ["reserveGlobal", "begin", "send", "fail"]);
    assert.equal(calls.at(-1)[2], "provider_retryable");
    assert.equal(calls.at(-1)[3], "provider unavailable");
    assert.deepEqual(seenFailures, [[providerError, "provider_retryable", job]]);
  });

  it("renders a supported structured payload before quota and sends it after the provider fence", async () => {
    const { calls, dependencies } = harness();

    const result = await processClaimedEmailOutboxJob(
      claim({
        templateName: "case_message",
        legacySubject: null,
        legacyHtml: null,
        payloadVersion: 1,
        payload: {
          recipientName: "Buyer",
          senderDisplayName: "Maker",
          caseId: "case-1",
          orderId: "order-1",
          recipientSide: "BUYER",
        },
      }),
      dependencies,
    );

    assert.equal(result, "sent");
    assert.deepEqual(callNames(calls), [
      "renderStructured",
      "reserveGlobal",
      "begin",
      "sendStructured",
      "complete",
    ]);
    assert.deepEqual(calls[3][2], {
      subject: "Rendered subject",
      html: "<p>Rendered body</p>",
    });
  });

  it("marks an invalid structured payload invalid before quotas or provider work", async () => {
    const { calls, dependencies } = harness({
      renderStructured: (...args) => {
        calls.push(["renderStructured", ...args]);
        throw new TypeError("invalid structured payload");
      },
    });

    const result = await processClaimedEmailOutboxJob(
      claim({
        templateName: "case_message",
        legacySubject: null,
        legacyHtml: null,
        payloadVersion: 1,
        payload: { recipientSide: "ARBITRARY_URL" },
      }),
      dependencies,
    );

    assert.equal(result, "failed");
    assert.deepEqual(callNames(calls), ["renderStructured", "fail"]);
    assert.equal(calls[1][2], "invalid_payload");
    assert.equal(calls[1][3], "Structured email payload is invalid");
  });

  it("defers before quota reservations when the provider is not configured", async () => {
    const { calls, dependencies } = harness({ providerConfigured: false });

    const result = await processClaimedEmailOutboxJob(claim(), dependencies);

    assert.equal(result, "deferred");
    assert.deepEqual(callNames(calls), ["defer"]);
    assert.equal(calls[0][2], "provider_unavailable");
  });
});
