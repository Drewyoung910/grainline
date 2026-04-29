import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  configuredEmailOutboxDailySendLimit,
  emailOutboxDailyQuotaKey,
  emailOutboxDailyQuotaTtlSeconds,
  reserveEmailOutboxDailySendAllowance,
} = await import("../src/lib/emailOutboxQuota.ts");

describe("email outbox daily quota", () => {
  const now = new Date("2026-04-28T23:59:30.000Z");

  it("uses a UTC-day key and expires after the reset window", () => {
    assert.equal(emailOutboxDailyQuotaKey(now), "email-outbox:sent:2026-04-28");
    assert.equal(emailOutboxDailyQuotaTtlSeconds(now), 3630);
  });

  it("parses the configured daily send cap with a safe default", () => {
    assert.equal(configuredEmailOutboxDailySendLimit("2500"), 2500);
    assert.equal(configuredEmailOutboxDailySendLimit("0"), 3000);
    assert.equal(configuredEmailOutboxDailySendLimit("not-a-number"), 3000);
  });

  it("does not call Redis when no allowance is requested", async () => {
    let called = false;
    const quota = await reserveEmailOutboxDailySendAllowance({
      requested: 0,
      now,
      limit: 10,
      counter: async () => {
        called = true;
        return 1;
      },
    });

    assert.equal(called, false);
    assert.equal(quota.allowed, 0);
    assert.equal(quota.limit, 10);
    assert.equal(quota.resetAt.toISOString(), "2026-04-29T00:00:00.000Z");
  });

  it("reserves only the allowed count returned by the atomic counter", async () => {
    const quota = await reserveEmailOutboxDailySendAllowance({
      requested: 5,
      now,
      limit: 10,
      counter: async ({ key, requested, limit, ttlSeconds }) => {
        assert.equal(key, "email-outbox:sent:2026-04-28");
        assert.equal(requested, 5);
        assert.equal(limit, 10);
        assert.equal(ttlSeconds, 3630);
        return 2;
      },
    });

    assert.equal(quota.allowed, 2);
  });

  it("clamps unexpected counter responses", async () => {
    assert.equal(
      (
        await reserveEmailOutboxDailySendAllowance({
          requested: 3,
          now,
          limit: 10,
          counter: async () => 99,
        })
      ).allowed,
      3,
    );
    assert.equal(
      (
        await reserveEmailOutboxDailySendAllowance({
          requested: 3,
          now,
          limit: 10,
          counter: async () => -4,
        })
      ).allowed,
      0,
    );
  });

  it("fails open when the quota counter is unavailable and reports the error", async () => {
    const seen = [];
    const quota = await reserveEmailOutboxDailySendAllowance({
      requested: 4,
      now,
      limit: 10,
      counter: async () => {
        throw new Error("redis down");
      },
      onCounterError: (error) => seen.push(String(error)),
    });

    assert.equal(quota.allowed, 4);
    assert.equal(seen.length, 1);
    assert.match(seen[0], /redis down/);
  });
});
