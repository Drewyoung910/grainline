import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { verifyCronRequest } = await import("../src/lib/cronAuth.ts");

function requestWithAuth(value) {
  return new Request("https://thegrainline.com/api/cron/quality-score", {
    headers: value ? { authorization: value } : {},
  });
}

describe("cron auth", () => {
  it("rejects cron requests when CRON_SECRET is missing", () => {
    const previous = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      assert.equal(verifyCronRequest(requestWithAuth("Bearer test-secret")), false);
    } finally {
      if (previous !== undefined) process.env.CRON_SECRET = previous;
    }
  });

  it("accepts only the exact bearer token", () => {
    process.env.CRON_SECRET = "test-secret";

    assert.equal(verifyCronRequest(requestWithAuth("Bearer test-secret")), true);
    assert.equal(verifyCronRequest(requestWithAuth("Bearer wrong-secret")), false);
    assert.equal(verifyCronRequest(requestWithAuth("test-secret")), false);
    assert.equal(verifyCronRequest(requestWithAuth(null)), false);
  });
});
