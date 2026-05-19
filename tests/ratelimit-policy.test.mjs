import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { limitWithFailurePolicy } = await import("../src/lib/ratelimitPolicy.ts");
const ratelimitSource = readFileSync(new URL("../src/lib/ratelimit.ts", import.meta.url), "utf8");

function throwingLimiter() {
  return {
    async limit() {
      throw new Error("redis unavailable");
    },
  };
}

describe("rate-limit failure policy", () => {
  it("wires public helpers through the shared failure-policy helper", () => {
    assert.match(ratelimitSource, /limitWithFailurePolicy\(limiter, key, false/);
    assert.match(ratelimitSource, /limitWithFailurePolicy\(limiter, key, true/);
  });

  it("fails closed for protected writes and expensive reads when Redis is unavailable", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const result = await limitWithFailurePolicy(
        throwingLimiter(),
        "user_123",
        false,
        "Rate limit Redis error (fail closed):",
      );
      assert.equal(result.success, false);
      assert.equal(typeof result.reset, "number");
    } finally {
      console.error = originalError;
    }
  });

  it("fails open only for explicitly safe telemetry/diagnostic paths", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const result = await limitWithFailurePolicy(
        throwingLimiter(),
        "ip_123",
        true,
        "Rate limit Redis error (fail open):",
      );
      assert.equal(result.success, true);
      assert.equal(typeof result.reset, "number");
    } finally {
      console.error = originalError;
    }
  });
});
