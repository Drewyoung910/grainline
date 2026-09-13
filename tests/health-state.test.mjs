import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    assert.equal(
      isVerboseHealthRequest(
        new Request("https://example.test/api/health", { headers: { authorization: "Bearer secret" } }),
        "secret",
      ),
      true,
    );
    assert.equal(
      isVerboseHealthRequest(
        new Request("https://example.test/api/health", { headers: { "x-health-check-token": "secret" } }),
        "secret",
      ),
      true,
    );
    assert.equal(
      isVerboseHealthRequest(
        new Request("https://example.test/api/health", { headers: { authorization: "Bearer wrong" } }),
        "secret",
      ),
      false,
    );
    assert.equal(
      isVerboseHealthRequest(
        new Request("https://example.test/api/health", { headers: { authorization: "Bearer secret" } }),
        "",
      ),
      false,
    );
    assert.equal(
      isVerboseHealthRequest(new Request("https://example.test/api/health?token=secret"), "secret"),
      false,
    );
  });

  it("compares verbose health tokens with a constant-time digest check", () => {
    const source = readFileSync("src/lib/healthState.ts", "utf8");

    assert.match(source, /timingSafeEqual/);
    assert.match(source, /sha256\(supplied\), sha256\(token\)/);
    assert.doesNotMatch(source, /supplied === token/);
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
