import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  it("never reclaims a pending sentinel held by a durable Case claim", () => {
    const cleanup = readFileSync("src/lib/refundLocks.ts", "utf8");

    assert.match(
      cleanup,
      /sellerRefundId: REFUND_LOCK_SENTINEL,[\s\S]*caseResolutionClaimId: null,[\s\S]*refundClaimId: null,[\s\S]*sellerRefundLockedAt/,
    );
  });

  it("timestamps contended refund reservations after the database lock wait", () => {
    const refundAuthority = readFileSync(
      "prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql",
      "utf8",
    );
    const staffAuthority = readFileSync(
      "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
      "utf8",
    );
    const prepareBody = staffAuthority.slice(
      staffAuthority.indexOf(
        "CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_prepare",
      ),
      staffAuthority.indexOf(
        "$grainline_case_staff_resolution_prepare$;",
      ),
    );
    const orderLock = prepareBody.indexOf('FROM public."Order" AS orders');
    const transitionTimestamp = prepareBody.indexOf(
      "transition_at := pg_catalog.clock_timestamp()",
    );
    const lockTimestamp = prepareBody.indexOf(
      '"sellerRefundLockedAt" = CASE',
    );

    for (const functionName of [
      "grainline_seller_refund_claim",
      "grainline_blocked_checkout_refund_claim",
    ]) {
      const declaration = new RegExp(
        `CREATE(?: OR REPLACE)? FUNCTION public\\.${functionName}\\b`,
      ).exec(refundAuthority);
      assert.ok(declaration, `${functionName} declaration is missing`);
      const functionStart = declaration.index;
      const bodyDelimiter = `$${functionName}$;`;
      const functionEnd = refundAuthority.indexOf(bodyDelimiter, functionStart)
        + bodyDelimiter.length;
      assert.ok(
        functionEnd >= bodyDelimiter.length,
        `${functionName} body delimiter is missing`,
      );
      const functionBody = refundAuthority.slice(functionStart, functionEnd);
      const refundOrderLock = functionBody.indexOf('FROM public."Order" AS orders');
      const refundTransitionTimestamp = functionBody.indexOf(
        "pg_catalog.clock_timestamp()",
      );
      const refundLockTimestamp = functionBody.indexOf(
        '"sellerRefundLockedAt" = transition_at',
      );
      assert.ok(
        refundOrderLock >= 0
          && refundTransitionTimestamp > refundOrderLock
          && refundLockTimestamp > refundTransitionTimestamp,
        `${functionName} must timestamp its claim after waiting on the Order lock`,
      );
    }
    assert.ok(
      orderLock >= 0
        && transitionTimestamp > orderLock
        && lockTimestamp > transitionTimestamp,
    );
  });

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
