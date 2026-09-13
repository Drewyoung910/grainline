import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { appendReviewPhotoUrl, normalizeReviewPhotoUrls } = await import("../src/lib/reviewPhotoState.ts");

describe("review photo client state", () => {
  it("dedupes and caps submitted review photos", () => {
    assert.deepEqual(
      normalizeReviewPhotoUrls([" a ", "b", "a", "", "c"], 3),
      ["a", "b", "c"],
    );
  });

  it("reports duplicate and capped uploads instead of silently dropping them", () => {
    assert.deepEqual(
      appendReviewPhotoUrl(["a"], "a", 2),
      { urls: ["a"], status: "duplicate" },
    );
    assert.deepEqual(
      appendReviewPhotoUrl(["a", "b"], "c", 2),
      { urls: ["a", "b"], status: "limit" },
    );
    assert.deepEqual(
      appendReviewPhotoUrl(["a"], "b", 2),
      { urls: ["a", "b"], status: "added" },
    );
  });
});
