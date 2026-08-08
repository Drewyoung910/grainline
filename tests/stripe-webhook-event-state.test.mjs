import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  STRIPE_WEBHOOK_EVENT_LAST_ERROR_MAX_CHARS,
  STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS,
  isStripeSessionUniqueConstraintError,
  shouldReclaimStripeWebhookEvent,
  stripeWebhookCompletionFromRows,
  stripeWebhookEventReservationFromRows,
  stripeWebhookFailureFromRows,
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

  it("parses one exact generation-bound database lease row", () => {
    assert.deepEqual(
      stripeWebhookEventReservationFromRows([
        { action: "process", claim_generation: "7" },
      ]),
      { action: "process", claimGeneration: 7n },
    );
    assert.deepEqual(
      stripeWebhookEventReservationFromRows([
        { action: "processed", claim_generation: 0n },
      ]),
      { action: "processed", claimGeneration: 0n },
    );
    assert.throws(
      () => stripeWebhookEventReservationFromRows([]),
      /invalid row count/,
    );
    assert.throws(
      () => stripeWebhookEventReservationFromRows([
        { action: "process", claim_generation: 0n },
      ]),
      /generation zero/,
    );
    assert.throws(
      () => stripeWebhookEventReservationFromRows([
        { action: "unknown", claim_generation: 1n },
      ]),
      /invalid action/,
    );
    assert.throws(
      () => stripeWebhookEventReservationFromRows([
        { action: "process", claim_generation: Number.MAX_SAFE_INTEGER + 1 },
      ]),
      /invalid claim generation/,
    );
    assert.throws(
      () => stripeWebhookEventReservationFromRows([
        { action: "processed", claim_generation: -1n },
      ]),
      /invalid claim generation/,
    );
  });

  it("recognizes only the reviewed duplicate checkout-session constraint", () => {
    assert.equal(
      isStripeSessionUniqueConstraintError({
        code: "P2002",
        meta: { target: ["stripeSessionId"] },
      }),
      true,
    );
    assert.equal(
      isStripeSessionUniqueConstraintError({
        code: "P2002",
        meta: { target: "Order_stripeSessionId_key" },
      }),
      true,
    );
    assert.equal(
      isStripeSessionUniqueConstraintError({
        code: "P2002",
        meta: { target: ["stripeEventId"] },
      }),
      false,
    );
    assert.equal(
      isStripeSessionUniqueConstraintError({ code: "P2034" }),
      false,
    );
  });

  it("fails closed on superseded completion and preserves superseded failure", () => {
    assert.equal(
      stripeWebhookCompletionFromRows([{ result: "completed" }]),
      "completed",
    );
    assert.equal(
      stripeWebhookCompletionFromRows([{ result: "already_processed" }]),
      "already_processed",
    );
    assert.throws(
      () => stripeWebhookCompletionFromRows([{ result: "superseded" }]),
      /superseded before completion/,
    );
    assert.equal(
      stripeWebhookFailureFromRows([{ result: "superseded" }]),
      "superseded",
    );
    assert.throws(
      () => stripeWebhookFailureFromRows([{ result: "unknown" }]),
      /invalid result/,
    );
  });

  it("routes failed Stripe webhook idempotency rows through the sanitizer helper", () => {
    const source = fs.readFileSync("src/lib/stripeWebhookEvents.ts", "utf8");

    assert.match(source, /const sanitizedError = stripeWebhookEventLastError\(error\)/);
    assert.match(source, /grainline_stripe_webhook_fail/);
    assert.match(source, /\$\{sanitizedError\}/);
    assert.match(source, /stripeWebhookFailureFromRows\(rows\)/);
    assert.doesNotMatch(source, /prisma\.stripeWebhookEvent\.update/);
  });
});
