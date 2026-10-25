import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { processNewlyEnqueuedEmailOutboxJob } = await import(
  "../src/lib/emailOutboxImmediate.ts"
);

function enqueued({ id = "job-1", created = true } = {}) {
  return {
    job: id === null ? null : { id },
    created,
  };
}

describe("immediate email outbox orchestration", () => {
  it("processes a newly-created durable row exactly once", async () => {
    const calls = [];
    const result = await processNewlyEnqueuedEmailOutboxJob(
      enqueued(),
      async (id) => {
        calls.push(id);
        return "sent";
      },
    );

    assert.equal(result, "sent");
    assert.deepEqual(calls, ["job-1"]);
  });

  it("leaves an existing replay row to its current claim or scheduled recovery", async () => {
    const calls = [];
    const result = await processNewlyEnqueuedEmailOutboxJob(
      enqueued({ created: false }),
      async (id) => {
        calls.push(id);
        return "sent";
      },
    );

    assert.equal(result, null);
    assert.deepEqual(calls, []);
  });

  it("does not dispatch when enqueue produced no durable row", async () => {
    let called = false;
    const result = await processNewlyEnqueuedEmailOutboxJob(
      enqueued({ id: null }),
      async () => {
        called = true;
        return "sent";
      },
    );

    assert.equal(result, null);
    assert.equal(called, false);
  });

  it("preserves the worker's recoverable provider-failure result", async () => {
    const result = await processNewlyEnqueuedEmailOutboxJob(
      enqueued(),
      async () => "failed",
    );

    assert.equal(result, "failed");
  });

  it("preserves an active-claim refusal without attempting a fallback send", async () => {
    let calls = 0;
    const result = await processNewlyEnqueuedEmailOutboxJob(
      enqueued(),
      async () => {
        calls += 1;
        return "unclaimed";
      },
    );

    assert.equal(result, "unclaimed");
    assert.equal(calls, 1);
  });
});
