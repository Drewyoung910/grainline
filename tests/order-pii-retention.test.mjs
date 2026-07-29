import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

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

  it("delegates pruning to the fixed database authority instead of raw Case access", () => {
    const retention = source("src/lib/orderPiiRetention.ts");
    assert.match(retention, /grainline_order_buyer_pii_prune_batch/);
    assert.match(
      retention,
      /retentionDays !== ORDER_BUYER_PII_RETENTION_DAYS/,
    );
    assert.doesNotMatch(retention, /FROM "Case"|\$executeRaw/);
  });

  it("keeps privacy-policy retention copy aligned with fulfilled-order PII pruning", () => {
    const privacy = source("src/app/privacy/page.tsx");

    assert.match(privacy, /Buyer address components/);
    assert.match(privacy, /buyer contact details/);
    assert.match(privacy, /gift notes/);
    assert.match(privacy, /seller fulfillment notes/);
    assert.match(privacy, /tracking fields/);
    assert.match(privacy, /Shippo shipment\/rate\/label identifiers/);
    assert.match(privacy, /label URLs/);
    assert.match(privacy, /shipping-rate quote snapshots/);
    assert.match(privacy, /after <strong>90 days<\/strong>/);
    assert.match(privacy, /Shipping providers\s+and carriers may retain label, tracking, and delivery records/s);
  });
});
