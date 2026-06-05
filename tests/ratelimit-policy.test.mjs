import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { limitWithFailurePolicy, providerRateLimitKey } = await import("../src/lib/ratelimitPolicy.ts");
const ratelimitSource = readFileSync(new URL("../src/lib/ratelimit.ts", import.meta.url), "utf8");
const ratelimitPolicySource = readFileSync(new URL("../src/lib/ratelimitPolicy.ts", import.meta.url), "utf8");

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

  it("captures Redis limiter failures to Sentry with policy context", () => {
    assert.match(ratelimitPolicySource, /Sentry\.captureException\?\.\(error/);
    assert.match(ratelimitPolicySource, /source: "ratelimit_failure_policy"/);
    assert.match(ratelimitPolicySource, /failurePolicy: failOpen \? "fail_open" : "fail_closed"/);
    assert.match(ratelimitPolicySource, /keyLength: key\.length/);
  });

  it("hashes provider keys before handing identifiers to Upstash-compatible limiters", async () => {
    const rawKey = "203.0.113.10:user_123";
    let observedKey = "";
    const limiter = {
      async limit(key) {
        observedKey = key;
        return { success: true, reset: 123 };
      },
    };

    const result = await limitWithFailurePolicy(limiter, rawKey, false, "unused");

    assert.deepEqual(result, { success: true, reset: 123 });
    assert.equal(observedKey, providerRateLimitKey(rawKey));
    assert.match(observedKey, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotMatch(observedKey, /203\.0\.113\.10|user_123/);
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
