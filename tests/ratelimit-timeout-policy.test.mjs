import assert from "node:assert/strict";
import { test } from "node:test";

const { limitWithFailurePolicy } = await import("../src/lib/ratelimitPolicy.ts");

const timedOut = { limit: async () => ({ success: true, reset: 1, reason: "timeout" }) };
const allowed = { limit: async () => ({ success: true, reset: 1 }) };

test("a limiter timeout follows the failure policy instead of allowing the request (X-01)", async () => {
  assert.equal((await limitWithFailurePolicy(timedOut, "k", false, "m")).success, false);
  assert.equal((await limitWithFailurePolicy(timedOut, "k", true, "m")).success, true);
});

test("a normal answer passes through", async () => {
  assert.equal((await limitWithFailurePolicy(allowed, "k", false, "m")).success, true);
});
