import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  HEALTH_CACHE_MS,
  healthResponsePayload,
  isFreshHealthResult,
  isVerboseHealthRequest,
} = await import("../src/lib/healthState.ts");

describe("health route state helpers", () => {
  it("treats health check results as fresh only inside the cache window", () => {
    assert.equal(isFreshHealthResult(null, 1_000), false);
    assert.equal(isFreshHealthResult({ timestamp: 1_000 }, 1_000 + HEALTH_CACHE_MS - 1), true);
    assert.equal(isFreshHealthResult({ timestamp: 1_000 }, 1_000 + HEALTH_CACHE_MS), false);
  });

  it("requires the configured token before returning verbose health details", () => {
    assert.equal(isVerboseHealthRequest("https://example.test/api/health?token=secret", "secret"), true);
    assert.equal(isVerboseHealthRequest("https://example.test/api/health?token=wrong", "secret"), false);
    assert.equal(isVerboseHealthRequest("https://example.test/api/health?token=secret", ""), false);
    assert.equal(isVerboseHealthRequest("not a url", "secret"), false);
  });

  it("hides backend check details from anonymous health responses", () => {
    const result = {
      ok: false,
      checks: { db: "ok", redis: "fail", r2: "ok" },
      timestamp: 1_234,
    };

    assert.deepEqual(healthResponsePayload(result, false, true), { ok: false });
    assert.deepEqual(healthResponsePayload(result, true, true), {
      ok: false,
      checks: result.checks,
      timestamp: 1_234,
      cached: true,
    });
  });
});
