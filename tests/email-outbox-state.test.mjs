import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  EMAIL_OUTBOX_MAX_ATTEMPTS,
  EMAIL_OUTBOX_PROCESSING_STALE_MS,
  EMAIL_OUTBOX_STATUSES,
  emailOutboxDedupKey,
  emailOutboxFailureState,
  emailOutboxProcessingStaleCutoff,
  emailOutboxQuotaDeferralState,
  emailOutboxRetryDelayMs,
  isEmailOutboxProcessingStale,
  isTerminalEmailOutboxAttempt,
} = await import("../src/lib/emailOutboxState.ts");

describe("email outbox state helpers", () => {
  const now = new Date("2026-04-28T12:00:00.000Z");

  it("keeps the supported status set aligned with the raw DB constraint", () => {
    assert.deepEqual(EMAIL_OUTBOX_STATUSES, [
      "PENDING",
      "PROCESSING",
      "SENT",
      "FAILED",
      "SKIPPED",
      "DEAD",
    ]);

    const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
    const migration = fs.readFileSync(
      "prisma/migrations/20260529200000_email_outbox_status_constraint/migration.sql",
      "utf8",
    );

    assert.match(
      schema,
      /Raw CHECK-constrained to PENDING\/PROCESSING\/SENT\/FAILED\/SKIPPED\/DEAD/,
    );
    assert.match(migration, /"EmailOutbox_status_chk"/);
    for (const status of EMAIL_OUTBOX_STATUSES) {
      assert.match(migration, new RegExp(`'${status}'`));
    }
  });

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

  it("defers true daily quota exhaustion until the UTC reset", () => {
    const resetAt = new Date("2026-04-29T00:00:00.000Z");
    const state = emailOutboxQuotaDeferralState({
      counterAvailable: true,
      resetAt,
      attempts: 3,
      now,
    });

    assert.deepEqual(state.attempts, { decrement: 1 });
    assert.equal(state.nextAttemptAt.toISOString(), resetAt.toISOString());
    assert.equal(state.lastError, "Daily email outbox send cap reached");
  });

  it("uses retry cadence instead of UTC reset when the quota counter is unavailable", () => {
    const resetAt = new Date("2026-04-29T00:00:00.000Z");
    const state = emailOutboxQuotaDeferralState({
      counterAvailable: false,
      resetAt,
      attempts: 2,
      now,
    });

    assert.deepEqual(state.attempts, { decrement: 1 });
    assert.equal(state.nextAttemptAt.toISOString(), new Date(now.getTime() + 120_000).toISOString());
    assert.equal(state.lastError, "Daily email outbox send cap unavailable");
  });
});
