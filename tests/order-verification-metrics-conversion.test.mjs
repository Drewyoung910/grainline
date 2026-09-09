import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const page = fs.readFileSync("src/app/admin/verification/page.tsx", "utf8");
const authority = fs.readFileSync(
  "prisma/migrations/20260901070000_prepare_order_seller_metrics_authority/migration.sql",
  "utf8",
);

describe("Guild Member Order metrics conversion", () => {
  it("uses the fixed durable-seller projection without direct Order-family SQL", () => {
    assert.match(page, /readOrderSellerMetricsFacts\(/);
    assert.match(page, /metricsPeriodStart\(new Date\(\), 3\)/);
    assert.doesNotMatch(page, /PAID_STRIPE_ORDER_SQL/);
    assert.doesNotMatch(page, /FROM\s+"OrderItem"|JOIN\s+"Order"|JOIN\s+"Listing"/);
    assert.match(authority, /source_order\."sellerProfileId" = p_seller_profile_id/);
    assert.match(authority, /source_item\."sellerProfileId" = p_seller_profile_id/);
  });

  it("preserves the product threshold and fails closed on projection mismatch", () => {
    assert.match(page, /totalSalesCents < 25_000/);
    assert.match(page, /\$250 completed non-refunded sales/);
    assert.match(
      page,
      /!orderFacts \|\| orderFacts\.sellerProfileId !== verification\.sellerProfileId/,
    );
    assert.match(page, /throw new Error\("Guild Member Order metrics authority returned no matching seller"\)/);
    assert.match(authority, /source_order\."sellerRefundId" IS NULL/);
    assert.match(authority, /source_order\."paymentRefundBlocked" = false/);
    assert.match(authority, /'DELIVERED'[\s\S]*'PICKED_UP'/);
  });
});
