import assert from "node:assert/strict";
import test from "node:test";
import {
  clerkWebhookCompletionFromRows,
  clerkWebhookEventLastError,
  clerkWebhookEventReservationFromRows,
  clerkWebhookFailureFromRows,
} from "../src/lib/clerkWebhookEventState.ts";
import {
  clerkWebhookHealthSummaryFromRows,
  clerkWebhookPruneCountFromRows,
} from "../src/lib/clerkWebhookMaintenanceState.ts";

test("Clerk webhook lease and finalizer parsers fail closed", () => {
  assert.deepEqual(
    clerkWebhookEventReservationFromRows([{ action: "process", claim_generation: "4" }]),
    { action: "process", claimGeneration: 4n },
  );
  assert.deepEqual(
    clerkWebhookEventReservationFromRows([{ action: "processed", claim_generation: 0n }]),
    { action: "processed", claimGeneration: 0n },
  );
  assert.throws(() => clerkWebhookEventReservationFromRows([]), /invalid row count/);
  assert.throws(
    () => clerkWebhookEventReservationFromRows([{ action: "process", claim_generation: 0n }]),
    /generation zero/,
  );
  assert.throws(
    () => clerkWebhookEventReservationFromRows([{ action: "other", claim_generation: 1n }]),
    /invalid action/,
  );
  assert.equal(clerkWebhookCompletionFromRows([{ result: "completed" }]), "completed");
  assert.equal(
    clerkWebhookCompletionFromRows([{ result: "already_processed" }]),
    "already_processed",
  );
  assert.throws(
    () => clerkWebhookCompletionFromRows([{ result: "superseded" }]),
    /superseded before completion/,
  );
  assert.equal(clerkWebhookFailureFromRows([{ result: "failed" }]), "failed");
  assert.equal(clerkWebhookFailureFromRows([{ result: "superseded" }]), "superseded");
});

test("Clerk webhook errors and maintenance results are bounded", () => {
  assert.equal(clerkWebhookEventLastError("x".repeat(800)).length, 500);
  assert.equal(clerkWebhookPruneCountFromRows([{ deleted_count: "12" }]), 12);
  assert.throws(
    () => clerkWebhookPruneCountFromRows([{ deleted_count: "1001" }]),
    /out-of-range/,
  );
  assert.deepEqual(
    clerkWebhookHealthSummaryFromRows([{
      failed_count: "1",
      released_count: "2",
      stale_count: "1",
      issue_count: "3",
    }]),
    { failedCount: 1, releasedCount: 2, staleCount: 1, issueCount: 3 },
  );
  assert.throws(
    () => clerkWebhookHealthSummaryFromRows([{
      failed_count: "2",
      released_count: "0",
      stale_count: "0",
      issue_count: "1",
    }]),
    /inconsistent counts/,
  );
});
