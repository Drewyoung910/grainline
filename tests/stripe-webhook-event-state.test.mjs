import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS,
  shouldReclaimStripeWebhookEvent,
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
});
