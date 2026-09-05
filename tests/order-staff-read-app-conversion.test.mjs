import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = (path) => readFileSync(path, "utf8");
const list = source("src/app/admin/orders/page.tsx");
const flagged = source("src/app/admin/flagged/page.tsx");
const detail = source("src/app/admin/orders/[id]/page.tsx");
const caseDetail = source("src/app/admin/cases/[id]/page.tsx");

describe("Order staff read application conversion", () => {
  it("routes both queues through the dedicated credential and fixed scopes", () => {
    for (const page of [list, flagged]) {
      assert.match(page, /requireAdminPageAccess/);
      assert.match(page, /getOrderStaffReadClient\(\)/);
      assert.match(page, /readStaffOrderPage\(/);
      assert.match(page, /chargedTotalCents: order\.chargedTotalCents/);
      assert.doesNotMatch(page, /prisma\.order|listingSnapshot|\.listing\.title/);
    }
    assert.match(list, /"ALL"/);
    assert.match(flagged, /"REVIEW_NEEDED"/);
    assert.match(list, /order\.items[\s\S]*item\.title/);
    assert.match(flagged, /order\.items[\s\S]*item\.title/);
  });

  it("routes detail through the fixed projection without provider-state inference", () => {
    assert.match(detail, /readStaffOrderDetail\(/);
    assert.match(detail, /getOrderStaffReadClient\(\)/);
    assert.match(detail, /sellerRefundState === "AMBIGUOUS"/);
    assert.match(detail, /refundClaimState === "AMBIGUOUS"/);
    assert.match(detail, /orderTotalCents\(order\)/);
    assert.match(detail, /it\.listingActive/);
    assert.doesNotMatch(detail, /prisma\.order|listingSnapshot|refundClaimId/);
  });

  it("composes the staff Case view from Case and corrected Order authorities", () => {
    assert.match(caseDetail, /getVisibleCaseById\(/);
    assert.match(caseDetail, /readStaffOrderDetail\(/);
    assert.match(caseDetail, /getOrderStaffReadClient\(\)/);
    assert.match(caseDetail, /order\.buyerId !== visibleCase\.buyerId/);
    assert.match(caseDetail, /order\.sellerUserId !== visibleCase\.sellerId/);
    assert.match(caseDetail, /item\.snapshot\.title/);
    assert.match(caseDetail, /item\.currentListingType !== "IN_STOCK"/);
    assert.doesNotMatch(caseDetail, /prisma\.(?:order|user)/);
  });
});
