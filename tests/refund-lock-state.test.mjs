import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  REFUND_AMBIGUOUS_SENTINEL,
  REFUND_LOCK_SENTINEL,
  REFUND_LOCK_STALE_MS,
  isAmbiguousRefundState,
  isRecordedRefundId,
  isRefundProcessingState,
  isStaleRefundLock,
  refundLockCutoff,
} = await import("../src/lib/refundLockState.ts");

describe("refund lock state", () => {
  it("keeps the stale lock window longer than normal Stripe refund latency", () => {
    assert.equal(REFUND_LOCK_STALE_MS, 15 * 60 * 1000);
  });

  it("calculates the cleanup cutoff from the configured stale window", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");

    assert.equal(
      refundLockCutoff(now).toISOString(),
      new Date(now.getTime() - REFUND_LOCK_STALE_MS).toISOString(),
    );
  });

  it("only considers pending refund sentinels stale", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");
    const stale = new Date(now.getTime() - REFUND_LOCK_STALE_MS - 1);

    assert.equal(isStaleRefundLock({ sellerRefundId: REFUND_AMBIGUOUS_SENTINEL, sellerRefundLockedAt: stale }, now), false);
    assert.equal(isStaleRefundLock({ sellerRefundId: "re_123", sellerRefundLockedAt: stale }, now), false);
    assert.equal(isStaleRefundLock({ sellerRefundId: null, sellerRefundLockedAt: stale }, now), false);
  });

  it("classifies pending, ambiguous, and recorded refund states", () => {
    assert.equal(isAmbiguousRefundState(REFUND_AMBIGUOUS_SENTINEL), true);
    assert.equal(isRefundProcessingState(REFUND_LOCK_SENTINEL), true);
    assert.equal(isRefundProcessingState(REFUND_AMBIGUOUS_SENTINEL), true);
    assert.equal(isRecordedRefundId(REFUND_AMBIGUOUS_SENTINEL), false);
    assert.equal(isRecordedRefundId(REFUND_LOCK_SENTINEL), false);
    assert.equal(isRecordedRefundId("re_123"), true);
  });

  it("reclaims pending locks with missing, invalid, or old timestamps", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");
    const stale = new Date(now.getTime() - REFUND_LOCK_STALE_MS - 1);

    assert.equal(isStaleRefundLock({ sellerRefundId: REFUND_LOCK_SENTINEL, sellerRefundLockedAt: null }, now), true);
    assert.equal(
      isStaleRefundLock({ sellerRefundId: REFUND_LOCK_SENTINEL, sellerRefundLockedAt: new Date(Number.NaN) }, now),
      true,
    );
    assert.equal(isStaleRefundLock({ sellerRefundId: REFUND_LOCK_SENTINEL, sellerRefundLockedAt: stale }, now), true);
  });

  it("does not reclaim recent pending locks", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");
    const recent = new Date(now.getTime() - REFUND_LOCK_STALE_MS + 1);

    assert.equal(isStaleRefundLock({ sellerRefundId: REFUND_LOCK_SENTINEL, sellerRefundLockedAt: recent }, now), false);
  });
});
