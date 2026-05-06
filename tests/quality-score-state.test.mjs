import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  QUALITY_SCORE_PENALTIES,
  qualityPenaltyForListing,
} = await import("../src/lib/qualityScoreState.ts");

describe("quality score penalties", () => {
  it("penalizes missing listing content that would otherwise ride discovery boosts", () => {
    assert.equal(
      qualityPenaltyForListing({ descLength: 0, photoCount: 0, aiReviewFlags: [] }),
      QUALITY_SCORE_PENALTIES.missingDescription + QUALITY_SCORE_PENALTIES.missingPhotos,
    );
  });

  it("penalizes short descriptions, one-photo listings, and moderation flags", () => {
    assert.equal(
      qualityPenaltyForListing({
        descLength: 24,
        photoCount: 1,
        aiReviewFlags: ["low-quality-description"],
      }),
      QUALITY_SCORE_PENALTIES.shortDescription +
        QUALITY_SCORE_PENALTIES.lowPhotoCount +
        QUALITY_SCORE_PENALTIES.moderationFlags,
    );
  });

  it("does not penalize complete listings or transient pending-review markers", () => {
    assert.equal(
      qualityPenaltyForListing({
        descLength: 200,
        photoCount: 4,
        aiReviewFlags: ["pending-ai-review", ""],
      }),
      0,
    );
  });
});
