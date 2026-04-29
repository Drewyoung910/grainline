import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  UPLOAD_SERVICE_RETRY_AFTER_SECONDS,
  uploadServiceFailure,
} = await import("../src/lib/uploadServiceFailure.ts");

describe("upload service failure responses", () => {
  it("returns retryable 503 metadata for presign failures", () => {
    const failure = uploadServiceFailure("presign");

    assert.equal(failure.init.status, 503);
    assert.equal(failure.init.headers["Retry-After"], String(UPLOAD_SERVICE_RETRY_AFTER_SECONDS));
    assert.deepEqual(failure.body, {
      error: "Upload signing is temporarily unavailable. Please try again.",
    });
  });

  it("returns retryable 503 metadata for object write failures", () => {
    const failure = uploadServiceFailure("object-write");

    assert.equal(failure.init.status, 503);
    assert.equal(failure.init.headers["Retry-After"], String(UPLOAD_SERVICE_RETRY_AFTER_SECONDS));
    assert.deepEqual(failure.body, {
      error: "Upload storage is temporarily unavailable. Please try again.",
    });
  });
});
