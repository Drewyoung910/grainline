import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  EMAIL_OUTBOX_MAX_ATTEMPTS,
  EMAIL_OUTBOX_PROCESSING_STALE_MS,
  emailOutboxProcessingStaleCutoff,
  emailOutboxRetryDelayMs,
  isEmailOutboxProcessingStale,
  isTerminalEmailOutboxAttempt,
} = await import("../src/lib/emailOutboxState.ts");

describe("email outbox state helpers", () => {
  const now = new Date("2026-04-28T12:00:00.000Z");

  it("calculates the stale processing cutoff from the configured window", () => {
    assert.equal(
      emailOutboxProcessingStaleCutoff(now).toISOString(),
      new Date(now.getTime() - EMAIL_OUTBOX_PROCESSING_STALE_MS).toISOString(),
    );
  });

  it("reclaims only stale processing jobs", () => {
    const stale = new Date(now.getTime() - EMAIL_OUTBOX_PROCESSING_STALE_MS - 1);
    const recent = new Date(now.getTime() - EMAIL_OUTBOX_PROCESSING_STALE_MS + 1);

    assert.equal(isEmailOutboxProcessingStale({ status: "PROCESSING", updatedAt: stale }, now), true);
    assert.equal(isEmailOutboxProcessingStale({ status: "PROCESSING", updatedAt: recent }, now), false);
    assert.equal(isEmailOutboxProcessingStale({ status: "PENDING", updatedAt: stale }, now), false);
    assert.equal(isEmailOutboxProcessingStale({ status: "PROCESSING", updatedAt: null }, now), false);
  });

  it("uses capped exponential retry delays", () => {
    assert.equal(emailOutboxRetryDelayMs(1), 60_000);
    assert.equal(emailOutboxRetryDelayMs(2), 120_000);
    assert.equal(emailOutboxRetryDelayMs(9), 15_360_000);
    assert.equal(emailOutboxRetryDelayMs(10), 6 * 60 * 60 * 1000);
    assert.equal(emailOutboxRetryDelayMs(50), 6 * 60 * 60 * 1000);
  });

  it("marks only max-attempt jobs terminal", () => {
    assert.equal(isTerminalEmailOutboxAttempt(EMAIL_OUTBOX_MAX_ATTEMPTS - 1), false);
    assert.equal(isTerminalEmailOutboxAttempt(EMAIL_OUTBOX_MAX_ATTEMPTS), true);
    assert.equal(isTerminalEmailOutboxAttempt(EMAIL_OUTBOX_MAX_ATTEMPTS + 1), true);
  });
});
