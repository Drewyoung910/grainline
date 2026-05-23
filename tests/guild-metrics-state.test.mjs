import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  GUILD_MASTER_REQUIREMENTS,
  meetsGuildMasterRequirements,
  metricsPeriodStart,
} = await import("../src/lib/metricsState.ts");

function metrics(overrides = {}) {
  return {
    sellerProfileId: "seller_1",
    calculatedAt: new Date("2026-05-23T12:00:00.000Z"),
    periodMonths: 3,
    averageRating: GUILD_MASTER_REQUIREMENTS.averageRating,
    reviewCount: GUILD_MASTER_REQUIREMENTS.reviewCount,
    onTimeShippingRate: GUILD_MASTER_REQUIREMENTS.onTimeShippingRate,
    responseRate: GUILD_MASTER_REQUIREMENTS.responseRate,
    totalSalesCents: GUILD_MASTER_REQUIREMENTS.totalSalesCents,
    completedOrderCount: 10,
    activeCaseCount: GUILD_MASTER_REQUIREMENTS.activeCaseCount,
    accountAgeDays: GUILD_MASTER_REQUIREMENTS.accountAgeDays,
    ...overrides,
  };
}

describe("Guild metrics state", () => {
  it("computes metrics periods by fixed day windows without calendar rollover", () => {
    const start = metricsPeriodStart(new Date("2026-05-31T12:00:00.000Z"), 3);

    assert.equal(start.toISOString(), "2026-03-02T12:00:00.000Z");
  });

  it("requires every Guild Master threshold and blocks active unresolved cases", () => {
    assert.deepEqual(meetsGuildMasterRequirements(metrics()).allMet, true);
    assert.equal(meetsGuildMasterRequirements(metrics({ averageRating: 4.49 })).ratingMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ reviewCount: 24 })).reviewsMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ onTimeShippingRate: 0.949 })).shippingMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ responseRate: 0.899 })).responseMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ accountAgeDays: 179 })).ageMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ totalSalesCents: 99_999 })).salesMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ activeCaseCount: 1 })).casesMet, false);
    assert.equal(meetsGuildMasterRequirements(metrics({ activeCaseCount: 1 })).allMet, false);
  });
});
