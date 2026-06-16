import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  CRON_RUN_FAILED_RECLAIM_MS,
  cronRunErrorMessage,
  cronUtcHourBucket,
  shouldReclaimFailedCronRun,
} = await import("../src/lib/cronRunState.ts");
const { cronRunPartialIssueSummary } = await import("../src/lib/cronRunPartialIssues.ts");

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

  it("sanitizes persisted cron failure messages", () => {
    const message = cronRunErrorMessage(
      new Error(
        "Failed for buyer@example.com at https://api.stripe.com/v1/transfers/tr_1234567890abcdef with 0123456789abcdef0123456789abcdef",
      ),
    );

    assert.equal(message, "Failed for [email] at [url] with [token]");
    assert.equal(cronRunErrorMessage({ raw: "object" }), "Unknown error");
  });

  it("summarizes bounded partial issue arrays from completed cron results", () => {
    assert.deepEqual(
      cronRunPartialIssueSummary({
        failures: [{ requestId: "commission_1", code: "P2002" }],
        errors: [
          { sellerId: "seller_1", code: "TIMEOUT" },
          { sellerId: "seller_2", code: "UNKNOWN" },
        ],
        ignored: [{ id: "not_a_partial_failure_key" }],
      }),
      { count: 3, keys: ["failures", "errors"] },
    );

    assert.deepEqual(cronRunPartialIssueSummary({ failures: [], errors: "not-array" }), {
      count: 0,
      keys: [],
    });
    assert.deepEqual(cronRunPartialIssueSummary(null), { count: 0, keys: [] });
  });
});
