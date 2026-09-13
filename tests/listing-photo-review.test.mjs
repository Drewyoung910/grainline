import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { listingPhotoReviewImageUrls } = await import("../src/lib/listingPhotoReview.ts");

describe("listing photo review image selection", () => {
  it("prioritizes newly uploaded photos while preserving existing context", () => {
    assert.deepEqual(
      listingPhotoReviewImageUrls(["new-1", "new-2"], ["old-1", "old-2", "old-3"]),
      ["new-1", "new-2", "old-1", "old-2"],
    );
  });

  it("dedupes urls and respects the review image limit", () => {
    assert.deepEqual(
      listingPhotoReviewImageUrls(["new-1", "old-1"], ["old-1", "old-2"], 3),
      ["new-1", "old-1", "old-2"],
    );
  });
});
