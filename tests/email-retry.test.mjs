import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  EMAIL_SEND_MAX_ATTEMPTS,
  emailSendErrorStatus,
  emailSendRetryDelayMs,
  isRetryableEmailSendError,
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
    assert.equal(isRetryableEmailSendError(new TypeError("fetch failed")), true);
    assert.equal(isRetryableEmailSendError({ statusCode: 401 }), false);
    assert.equal(isRetryableEmailSendError({ statusCode: 422 }), false);
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
