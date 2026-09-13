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
    const previousRotation = process.env.CRON_SECRET_PREVIOUS;
    delete process.env.CRON_SECRET;
    process.env.CRON_SECRET_PREVIOUS = "previous-secret";
    try {
      assert.equal(verifyCronRequest(requestWithAuth("Bearer previous-secret")), false);
    } finally {
      if (previous !== undefined) process.env.CRON_SECRET = previous;
      else delete process.env.CRON_SECRET;
      if (previousRotation !== undefined) process.env.CRON_SECRET_PREVIOUS = previousRotation;
      else delete process.env.CRON_SECRET_PREVIOUS;
    }
  });

  it("accepts only the exact bearer token", () => {
    process.env.CRON_SECRET = "test-secret";

    assert.equal(verifyCronRequest(requestWithAuth("Bearer test-secret")), true);
    assert.equal(verifyCronRequest(requestWithAuth("Bearer wrong-secret")), false);
    assert.equal(verifyCronRequest(requestWithAuth("test-secret")), false);
    assert.equal(verifyCronRequest(requestWithAuth(null)), false);
  });

  it("accepts the previous secret during rotation", () => {
    const previous = process.env.CRON_SECRET;
    const previousRotation = process.env.CRON_SECRET_PREVIOUS;
    process.env.CRON_SECRET = "current-secret";
    process.env.CRON_SECRET_PREVIOUS = "previous-secret";
    try {
      assert.equal(verifyCronRequest(requestWithAuth("Bearer current-secret")), true);
      assert.equal(verifyCronRequest(requestWithAuth("Bearer previous-secret")), true);
      assert.equal(verifyCronRequest(requestWithAuth("Bearer old-secret")), false);
    } finally {
      if (previous !== undefined) process.env.CRON_SECRET = previous;
      else delete process.env.CRON_SECRET;
      if (previousRotation !== undefined) process.env.CRON_SECRET_PREVIOUS = previousRotation;
      else delete process.env.CRON_SECRET_PREVIOUS;
    }
  });
});
