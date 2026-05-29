import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  STRIPE_WEBHOOK_EVENT_LAST_ERROR_MAX_CHARS,
  STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS,
  shouldReclaimStripeWebhookEvent,
  stripeWebhookEventLastError,
} = await import("../src/lib/stripeWebhookEventState.ts");

describe("Stripe webhook event idempotency state", () => {
  it("does not reclaim processed webhook events", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");
    const stale = new Date(now.getTime() - STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS - 1);

    assert.equal(
      shouldReclaimStripeWebhookEvent({ processedAt: now, processingStartedAt: stale }, now),
      false,
    );
  });

  it("reclaims unprocessed events with missing or stale processing timestamps", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");
    const stale = new Date(now.getTime() - STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS - 1);
    const recent = new Date(now.getTime() - STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS + 1);

    assert.equal(shouldReclaimStripeWebhookEvent({ processedAt: null, processingStartedAt: null }, now), true);
    assert.equal(shouldReclaimStripeWebhookEvent({ processedAt: null, processingStartedAt: stale }, now), true);
    assert.equal(shouldReclaimStripeWebhookEvent({ processedAt: null, processingStartedAt: recent }, now), false);
  });

  it("sanitizes failed webhook event errors before persistence", () => {
    const sanitized = stripeWebhookEventLastError(
      new Error(
        `Stripe failed for buyer@example.com at https://api.stripe.com/v1/payment_intents/pi_1234567890abcdef?client_secret=pi_1234567890abcdef_secret_1234567890abcdef with ch_1234567890abcdef, c123456789012345678901234, last4=4242, ending in 1881, and ${"x".repeat(800)}`,
      ),
    );

    assert.ok(sanitized.length <= STRIPE_WEBHOOK_EVENT_LAST_ERROR_MAX_CHARS);
    assert.match(sanitized, /\[email\]/);
    assert.match(sanitized, /\[url\]/);
    assert.match(sanitized, /\[token\]/);
    assert.match(sanitized, /\[card_detail\]/);
    assert.doesNotMatch(sanitized, /buyer@example\.com|https:\/\/api\.stripe\.com|pi_1234567890abcdef|ch_1234567890abcdef|c123456789012345678901234|4242|1881/);
  });

  it("routes failed Stripe webhook idempotency rows through the sanitizer helper", () => {
    const source = fs.readFileSync("src/lib/stripeWebhookEvents.ts", "utf8");

    assert.match(source, /lastError: stripeWebhookEventLastError\(error\)/);
    assert.doesNotMatch(source, /lastError: truncateText\(error instanceof Error \? error\.message : String\(error\)/);
  });
});
