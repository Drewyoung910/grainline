import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  ORDER_BUYER_PII_RETENTION_DAYS,
  orderBuyerPiiRetentionCutoff,
} = await import("../src/lib/orderPiiRetentionState.ts");

describe("order buyer PII retention helpers", () => {
  it("uses the default 90-day fulfilled-order cutoff", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");

    assert.equal(ORDER_BUYER_PII_RETENTION_DAYS, 90);
    assert.equal(
      orderBuyerPiiRetentionCutoff({ now }).toISOString(),
      "2026-01-28T12:00:00.000Z",
    );
  });

  it("supports explicit retention windows for tests and future policy changes", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");

    assert.equal(
      orderBuyerPiiRetentionCutoff({ now, retentionDays: 7 }).toISOString(),
      "2026-04-21T12:00:00.000Z",
    );
  });
});
