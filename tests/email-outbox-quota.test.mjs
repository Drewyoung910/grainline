import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  configuredEmailOutboxDailyRecipientSendLimit,
  configuredEmailOutboxDailySendLimit,
  emailOutboxDailyQuotaKey,
  emailOutboxDailyQuotaTtlSeconds,
  emailOutboxRecipientDailyQuotaKey,
  reserveEmailOutboxDailySendAllowance,
  reserveEmailOutboxRecipientDailySendAllowance,
} = await import("../src/lib/emailOutboxQuota.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

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
    assert.equal(configuredEmailOutboxDailyRecipientSendLimit("25"), 25);
    assert.equal(configuredEmailOutboxDailyRecipientSendLimit("0"), 20);
    assert.equal(configuredEmailOutboxDailyRecipientSendLimit("not-a-number"), 20);
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

  it("fails closed when the quota counter is unavailable and reports the error", async () => {
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

    assert.equal(quota.allowed, 0);
    assert.equal(quota.counterAvailable, false);
    assert.equal(seen.length, 1);
    assert.match(seen[0], /redis down/);
  });

  it("uses a hashed recipient quota key without raw email addresses", async () => {
    const key = emailOutboxRecipientDailyQuotaKey("sha256:abc123", now);

    assert.equal(key, "email-outbox:sent:2026-04-28:recipient:sha256:abc123");
    assert.doesNotMatch(key, /@/);
  });

  it("reserves per-recipient allowance through the same atomic counter", async () => {
    const quota = await reserveEmailOutboxRecipientDailySendAllowance({
      recipientHash: "sha256:abc123",
      requested: 2,
      now,
      limit: 3,
      counter: async ({ key, requested, limit, ttlSeconds }) => {
        assert.equal(key, "email-outbox:sent:2026-04-28:recipient:sha256:abc123");
        assert.equal(requested, 2);
        assert.equal(limit, 3);
        assert.equal(ttlSeconds, 3630);
        return 1;
      },
    });

    assert.equal(quota.allowed, 1);
    assert.equal(quota.limit, 3);
  });

  it("checks hashed recipient quota before the global outbox quota in the drain path", () => {
    const outbox = source("src/lib/emailOutbox.ts");

    assert.match(outbox, /recipientDailySendAllowanceScript/);
    assert.match(outbox, /hashEmailForTelemetry\(recipientEmail\) \?\? "unknown"/);
    assert.match(outbox, /reserveRecipientDailySendAllowance\(job\.recipientEmail, 1, quotaCheckedAt\)[\s\S]*reserveDailySendAllowance\(1, quotaCheckedAt\)/);
    assert.match(outbox, /email_outbox_recipient_quota/);
    assert.match(outbox, /Daily per-recipient email outbox send cap reached/);
  });
});
