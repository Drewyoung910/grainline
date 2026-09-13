import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const plan = readFileSync(
  "docs/order-payment-shipping-compatible-schema-plan.md",
  "utf8",
);

describe("Order/payment/shipping compatible seller-key plan", () => {
  it("remains design-only and inspection-gated", () => {
    assert.match(plan, /not a Prisma migration, deployable SQL artifact or production approval/);
    assert.match(plan, /aggregate inspector must run first/);
    assert.match(plan, /order_without_item_count = 0/);
    assert.match(plan, /order_multi_seller_count = 0/);
    assert.match(plan, /must not pick an arbitrary seller/);
  });

  it("pins the same-Order and purchased-Listing seller constraints", () => {
    assert.match(plan, /nullable `sellerProfileId` to both `Order` and `OrderItem`/);
    assert.match(plan, /`OrderItem\(orderId, sellerProfileId\)` references\s+`Order\(id, sellerProfileId\)`/);
    assert.match(plan, /`OrderItem\(listingId, sellerProfileId\)` references\s+`Listing\(id, sellerId\)`/);
    assert.match(plan, /prevents seller reassignment\s+after a Listing has been purchased/);
    assert.match(plan, /`\(sellerProfileId, createdAt, id\)`/);
  });

  it("protects old and new webhook coexistence", () => {
    assert.match(plan, /`BEFORE INSERT OR UPDATE` OrderItem\s+trigger/);
    assert.match(plan, /derives `NEW\.sellerProfileId` from the referenced Listing/);
    assert.match(plan, /fills a null\s+`Order\.sellerProfileId` from the first item/);
    assert.match(plan, /old cart webhook creates the Order and then separate OrderItems/);
    assert.match(plan, /old single-item webhook creates nested items with the Order/);
    assert.match(plan, /pin `search_path`/);
    assert.match(plan, /no dynamic SQL/);
    assert.match(plan, /receives no\s+PUBLIC EXECUTE grant/);
  });

  it("keeps convergence and RLS as later releases", () => {
    assert.match(plan, /later invariant migration set both seller\s+columns `NOT NULL`/);
    assert.match(plan, /RLS\/function activation remains a separate release/);
    assert.match(plan, /dropping schema underneath a mixed deployment is forbidden/);
    assert.match(plan, /does not collapse them\s+into one migration/);
  });
});
