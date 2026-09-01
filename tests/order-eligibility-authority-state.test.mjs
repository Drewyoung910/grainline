import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  listingOrderArchiveBlockedFromRows,
  reportTargetAccessFromRows,
  reviewEligibilityFromRows,
  sellerVerificationSalesFromRows,
} from "../src/lib/orderEligibilityState.ts";

describe("Order eligibility authority state", () => {
  it("parses exact review, report, sales and archive results", async () => {
    assert.deepEqual(reviewEligibilityFromRows([
      { order_item_id: "item-1", seller_profile_id: "seller-1" },
    ]),
      { orderItemId: "item-1", sellerProfileId: "seller-1" },
    );
    assert.equal(reportTargetAccessFromRows([{ value: true }]), true);
    assert.equal(sellerVerificationSalesFromRows([{ total_sales_cents: 1500n }]), 1500);
    assert.equal(listingOrderArchiveBlockedFromRows([{ blocked: false }]), false);
  });

  it("distinguishes denial from zero and rejects malformed authority rows", async () => {
    assert.equal(sellerVerificationSalesFromRows([]), null);
    assert.throws(() => reportTargetAccessFromRows([{ value: "true" }]), /invalid/i);
    assert.throws(() => sellerVerificationSalesFromRows([{ total_sales_cents: -1n }]), /invalid/i);
    assert.throws(() => reviewEligibilityFromRows([
      { order_item_id: "item-1", seller_profile_id: "seller-1" },
      { order_item_id: "item-2", seller_profile_id: "seller-1" },
    ]), /invalid/i);
  });
});
