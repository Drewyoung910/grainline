import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  CRON_RUN_FAILED_RECLAIM_MS,
  cronUtcHourBucket,
  shouldReclaimFailedCronRun,
} = await import("../src/lib/cronRunState.ts");

describe("cron run idempotency helpers", () => {
  it("uses UTC hour buckets for deterministic cron run IDs", () => {
    assert.equal(cronUtcHourBucket(new Date("2026-04-28T23:59:59.999Z")), "2026-04-28T23");
    assert.equal(cronUtcHourBucket(new Date("2026-04-29T00:00:00.000Z")), "2026-04-29T00");
  });

  it("reclaims only failed cron runs older than the retry window", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");
    const stale = new Date(now.getTime() - CRON_RUN_FAILED_RECLAIM_MS - 1);
    const recent = new Date(now.getTime() - CRON_RUN_FAILED_RECLAIM_MS + 1);

    assert.equal(shouldReclaimFailedCronRun({ status: "FAILED", startedAt: stale }, now), true);
    assert.equal(shouldReclaimFailedCronRun({ status: "FAILED", startedAt: recent }, now), false);
    assert.equal(shouldReclaimFailedCronRun({ status: "RUNNING", startedAt: stale }, now), false);
    assert.equal(shouldReclaimFailedCronRun({ status: "COMPLETED", startedAt: stale }, now), false);
    assert.equal(shouldReclaimFailedCronRun({ status: "FAILED", startedAt: null }, now), false);
    assert.equal(shouldReclaimFailedCronRun(null, now), false);
  });
});
