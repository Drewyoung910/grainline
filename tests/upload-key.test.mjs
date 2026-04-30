import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { uploadKeyUserSegment } = await import("../src/lib/uploadKey.ts");

describe("upload key segments", () => {
  it("keeps only path-safe user id characters", () => {
    assert.equal(uploadKeyUserSegment("user_123-ABC"), "user_123-ABC");
    assert.equal(uploadKeyUserSegment("user/../bad:name"), "user____bad_name");
  });

  it("bounds empty or very long user id segments", () => {
    assert.equal(uploadKeyUserSegment(""), "user");
    assert.equal(uploadKeyUserSegment("x".repeat(200)).length, 128);
  });
});
