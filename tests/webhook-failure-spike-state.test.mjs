import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  WEBHOOK_FAILURE_SPIKE_THRESHOLD,
  shouldEmitWebhookFailureSpike,
  webhookFailureAlertKey,
  webhookFailureCounterKey,
  webhookFailureCount,
  webhookFailureMinuteBucket,
  webhookFailureWindowBuckets,
} = await import("../src/lib/webhookFailureSpikeState.ts");

describe("webhook failure spike state", () => {
  it("builds stable minute buckets and sanitized Redis keys", () => {
    const now = new Date("2026-04-30T12:34:56.000Z");
    const bucket = webhookFailureMinuteBucket(now);

    assert.equal(bucket, Math.floor(now.getTime() / 60_000));
    assert.equal(
      webhookFailureCounterKey({ webhook: "Stripe", kind: "Signature Failure", bucket }),
      `webhook_failure:stripe:signature_failure:${bucket}`,
    );
    assert.equal(
      webhookFailureAlertKey({ webhook: "Stripe", kind: "Signature Failure" }),
      "webhook_failure_alert:stripe:signature_failure",
    );
  });

  it("returns the current rolling window buckets newest first", () => {
    const now = new Date("2026-04-30T12:34:00.000Z");
    const current = webhookFailureMinuteBucket(now);

    assert.deepEqual(webhookFailureWindowBuckets({ now, windowMinutes: 4 }), [
      current,
      current - 1,
      current - 2,
      current - 3,
    ]);
  });

  it("sums only positive numeric counter values and applies the threshold", () => {
    const count = webhookFailureCount([null, "2", 3, "bad", -4, 5]);
    assert.equal(count, 10);
    assert.equal(shouldEmitWebhookFailureSpike({ count, threshold: WEBHOOK_FAILURE_SPIKE_THRESHOLD }), true);
    assert.equal(shouldEmitWebhookFailureSpike({ count: 9, threshold: WEBHOOK_FAILURE_SPIKE_THRESHOLD }), false);
  });
});
