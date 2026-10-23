import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  EMAIL_SEND_MAX_ATTEMPTS,
  emailSendErrorStatus,
  emailSendRetryDelayMs,
  isRetryableEmailSendError,
  requireEmailProviderSuccess,
  sendEmailProviderRequestWithRetry,
  sendEmailWithRetry,
} = await import("../src/lib/emailRetry.ts");

describe("email send retry helpers", () => {
  it("extracts status codes from common SDK error shapes", () => {
    assert.equal(emailSendErrorStatus({ statusCode: 429 }), 429);
    assert.equal(emailSendErrorStatus({ response: { status: "503" } }), 503);
    assert.equal(emailSendErrorStatus({ status: "bad" }), null);
  });

  it("retries only transient provider and network failures", () => {
    assert.equal(isRetryableEmailSendError({ statusCode: 429 }), true);
    assert.equal(isRetryableEmailSendError({ response: { status: 500 } }), true);
    assert.equal(isRetryableEmailSendError({ code: "ECONNRESET" }), true);
    assert.equal(isRetryableEmailSendError({ name: "application_error", statusCode: null }), true);
    assert.equal(isRetryableEmailSendError(new TypeError("fetch failed")), true);
    assert.equal(isRetryableEmailSendError({ statusCode: 401 }), false);
    assert.equal(isRetryableEmailSendError({ statusCode: 422 }), false);
  });

  it("retries errors returned by the provider before accepting a message id", async () => {
    let attempts = 0;
    const delays = [];
    const idempotencyKeys = [];

    const result = await sendEmailProviderRequestWithRetry(
      async (idempotencyKey) => {
        idempotencyKeys.push(idempotencyKey);
        attempts += 1;
        if (attempts === 1) {
          return {
            data: null,
            error: { name: "application_error", message: "Unable to reach provider", statusCode: null },
          };
        }
        if (attempts < EMAIL_SEND_MAX_ATTEMPTS) {
          return {
            data: null,
            error: { name: "rate_limit_exceeded", message: "Too many requests", statusCode: 429 },
          };
        }
        return { data: { id: "email_123" }, error: null };
      },
      { sleep: async (delayMs) => delays.push(delayMs) },
    );

    assert.deepEqual(result, { id: "email_123" });
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [500, 1_000]);
    assert.equal(new Set(idempotencyKeys).size, 1);
    assert.match(idempotencyKeys[0], /^grainline-email-[0-9a-f-]{36}$/);
  });

  it("retries malformed success envelopes with the same caller-supplied key", async () => {
    const attempts = [];

    const result = await sendEmailProviderRequestWithRetry(
      async (idempotencyKey, attempt) => {
        attempts.push({ idempotencyKey, attempt });
        return attempt === 1
          ? { data: null, error: null }
          : { data: { id: "email_456" }, error: null };
      },
      {
        idempotencyKey: "outbox-job-123",
        sleep: async () => {},
      },
    );

    assert.deepEqual(result, { id: "email_456" });
    assert.deepEqual(attempts, [
      { idempotencyKey: "outbox-job-123", attempt: 1 },
      { idempotencyKey: "outbox-job-123", attempt: 2 },
    ]);
  });

  it("rejects permanent returned errors and accepts an omitted error field", async () => {
    await assert.rejects(
      () =>
        sendEmailProviderRequestWithRetry(
          async () => ({
            data: null,
            error: { name: "validation_error", message: "Invalid recipient", statusCode: 422 },
          }),
          { sleep: async () => {} },
        ),
      (error) => error instanceof Error && error.message === "Invalid recipient" && error.statusCode === 422,
    );

    assert.deepEqual(
      requireEmailProviderSuccess({ data: { id: "email_without_error_field" } }),
      { id: "email_without_error_field" },
    );
  });

  it("uses bounded exponential retry delays", () => {
    assert.equal(emailSendRetryDelayMs(1), 500);
    assert.equal(emailSendRetryDelayMs(2), 1_000);
    assert.equal(emailSendRetryDelayMs(20), 5_000);
  });

  it("retries transient failures before returning success", async () => {
    let attempts = 0;
    const delays = [];

    const result = await sendEmailWithRetry(
      async () => {
        attempts += 1;
        if (attempts < EMAIL_SEND_MAX_ATTEMPTS) throw { statusCode: 503 };
        return "sent";
      },
      { sleep: async (delayMs) => delays.push(delayMs) },
    );

    assert.equal(result, "sent");
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [500, 1_000]);
  });

  it("does not retry permanent provider errors", async () => {
    let attempts = 0;

    await assert.rejects(
      () =>
        sendEmailWithRetry(
          async () => {
            attempts += 1;
            throw { statusCode: 422 };
          },
          { sleep: async () => {} },
        ),
      { statusCode: 422 },
    );

    assert.equal(attempts, 1);
  });
});
