import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  QUALITY_SCORE_PENALTIES,
  normalizeQualityScoreAIReviewFlags,
  qualityPenaltyForListing,
} = await import("../src/lib/qualityScoreState.ts");
const {
  MAX_QUALITY_SCORE,
  scoreQualityRow,
} = await import("../src/lib/qualityScoreFormula.ts");

const DAY_MS = 24 * 60 * 60 * 1000;

function qualityRow(overrides = {}) {
  const now = Date.parse("2026-05-23T12:00:00.000Z");
  return {
    id: "listing_1",
    sellerId: "seller_1",
    viewCount: 100,
    clickCount: 10,
    favCount: 10n,
    orderCount: 5n,
    photoCount: 4n,
    hasAltText: true,
    descLength: 220,
    aiReviewFlags: [],
    createdAt: new Date(now - 10 * DAY_MS),
    sellerCreatedAt: new Date(now - 20 * DAY_MS),
    guildLevel: "NONE",
    sellerAvgRating: 4.8,
    sellerReviewCount: 0n,
    ...overrides,
  };
}

const globalMeans = {
  avgConversion: 0.02,
  avgCtr: 0.08,
  avgRating: 4.5,
};

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

  it("ignores malformed AI review flags instead of crashing the cron", () => {
    assert.deepEqual(
      normalizeQualityScoreAIReviewFlags([" pending-ai-review ", "low-quality", null, 123, {}, ""]),
      ["low-quality"],
    );
    assert.deepEqual(normalizeQualityScoreAIReviewFlags(null), []);
    assert.equal(
      qualityPenaltyForListing({
        descLength: 200,
        photoCount: 4,
        aiReviewFlags: [null, 123, " low-quality-description "],
      }),
      QUALITY_SCORE_PENALTIES.moderationFlags,
    );
  });

  it("scores quality rows across discovery-bump boundaries", () => {
    const now = Date.parse("2026-05-23T12:00:00.000Z");
    const day1 = scoreQualityRow(qualityRow({ createdAt: new Date(now - 1 * DAY_MS) }), globalMeans, now);
    const day14 = scoreQualityRow(qualityRow({ createdAt: new Date(now - 14 * DAY_MS) }), globalMeans, now);
    const day30 = scoreQualityRow(qualityRow({ createdAt: new Date(now - 30 * DAY_MS) }), globalMeans, now);
    const day31 = scoreQualityRow(qualityRow({ createdAt: new Date(now - 31 * DAY_MS) }), globalMeans, now);

    assert.ok(day1 > day30, "fresh listings should receive the full early discovery bump");
    assert.ok(day14 > day30, "day-14 listings should still receive the full early discovery bump");
    assert.ok(day30 > day31, "day-30 listings retain only the tail of the decaying discovery bump");
  });

  it("dampens sparse engagement instead of over-trusting tiny samples", () => {
    const now = Date.parse("2026-05-23T12:00:00.000Z");
    const sparse = scoreQualityRow(qualityRow({ viewCount: 1, clickCount: 1, orderCount: 1n }), globalMeans, now);
    const mature = scoreQualityRow(qualityRow({ viewCount: 200, clickCount: 60, orderCount: 30n }), globalMeans, now);

    assert.ok(sparse < mature, "one lucky view should not outrank sustained engagement");
  });

  it("orders Guild boosts and new-seller bumps without changing the base formula", () => {
    const now = Date.parse("2026-05-23T12:00:00.000Z");
    const baseline = scoreQualityRow(qualityRow({
      createdAt: new Date(now - 40 * DAY_MS),
      sellerCreatedAt: new Date(now - 40 * DAY_MS),
      sellerReviewCount: 5n,
    }), globalMeans, now);
    const guildMember = scoreQualityRow(qualityRow({
      createdAt: new Date(now - 40 * DAY_MS),
      sellerCreatedAt: new Date(now - 40 * DAY_MS),
      sellerReviewCount: 5n,
      guildLevel: "GUILD_MEMBER",
    }), globalMeans, now);
    const guildMaster = scoreQualityRow(qualityRow({
      createdAt: new Date(now - 40 * DAY_MS),
      sellerCreatedAt: new Date(now - 40 * DAY_MS),
      sellerReviewCount: 5n,
      guildLevel: "GUILD_MASTER",
    }), globalMeans, now);
    const newSeller = scoreQualityRow(qualityRow({
      createdAt: new Date(now - 40 * DAY_MS),
      sellerCreatedAt: new Date(now - 20 * DAY_MS),
      sellerReviewCount: 0n,
    }), globalMeans, now);

    assert.ok(guildMember > baseline, "Guild Member should add a smaller trust boost");
    assert.ok(guildMaster > guildMember, "Guild Master should outrank Guild Member when other signals match");
    assert.ok(newSeller > baseline, "new zero-review sellers should receive the documented starter bump");
  });

  it("bounds quality scores to finite values", () => {
    const now = Date.parse("2026-05-23T12:00:00.000Z");
    const overloaded = scoreQualityRow(qualityRow({
      viewCount: 100,
      clickCount: 500,
      orderCount: 500n,
      favCount: 5_000n,
      guildLevel: "GUILD_MASTER",
    }), globalMeans, now);
    const invalid = scoreQualityRow(qualityRow(), { ...globalMeans, avgConversion: Number.NaN }, now);

    assert.equal(overloaded, MAX_QUALITY_SCORE);
    assert.equal(invalid, 0);
  });
});
