import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  EMAIL_OUTBOX_MAX_ATTEMPTS,
  EMAIL_OUTBOX_PROCESSING_STALE_MS,
  emailOutboxDedupKey,
  emailOutboxFailureState,
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

  it("keeps short dedup keys stable and hashes long keys instead of truncating", () => {
    const shortKey = "order:123";
    const longKeyA = `${"x".repeat(128)}:A`;
    const longKeyB = `${"x".repeat(128)}:B`;

    assert.equal(emailOutboxDedupKey(shortKey), shortKey);
    assert.match(emailOutboxDedupKey(longKeyA), /^sha256:[a-f0-9]{64}$/);
    assert.notEqual(emailOutboxDedupKey(longKeyA), emailOutboxDedupKey(longKeyB));
  });

  it("uses null next-attempt timestamps for terminal jobs", () => {
    const retryState = emailOutboxFailureState(2, now);
    assert.equal(retryState.terminal, false);
    assert.equal(retryState.status, "FAILED");
    assert.equal(retryState.nextAttemptAt?.toISOString(), new Date(now.getTime() + 120_000).toISOString());

    const terminalState = emailOutboxFailureState(EMAIL_OUTBOX_MAX_ATTEMPTS, now);
    assert.equal(terminalState.terminal, true);
    assert.equal(terminalState.status, "DEAD");
    assert.equal(terminalState.nextAttemptAt, null);
  });
});
