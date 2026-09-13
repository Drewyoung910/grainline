import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("full buyer history and seller sales use bidirectional bounded summaries", () => {
  const buyer = readFileSync("src/app/account/orders/page.tsx", "utf8");
  const seller = readFileSync("src/app/dashboard/sales/page.tsx", "utf8");
  const authority = readFileSync("src/lib/orderParticipantReadAuthority.ts", "utf8");

  for (const [label, source] of [["buyer", buyer], ["seller", seller]]) {
    assert.match(source, /parseOrderHistoryCursor/u, label);
    assert.match(source, /buildOrderHistoryCursor/u, label);
    assert.match(source, /direction: "newer"/u, label);
    assert.match(source, /direction: "older"/u, label);
    assert.doesNotMatch(source, /prisma\.order|skip:/u, label);
    assert.doesNotMatch(source, /listingSnapshot|readHistoricalOrderItemSnapshot/u, label);
  }
  assert.match(buyer, /countBuyerOrders/u);
  assert.match(buyer, /readBuyerOrderSummaryPage/u);
  assert.match(seller, /countSellerOrders/u);
  assert.match(seller, /readSellerOrderSummaryPage/u);
  assert.match(seller, /const mySubtotalCents = o\.itemsSubtotalCents/u);
  assert.match(authority, /grainline_order_buyer_summary_after_page/u);
  assert.match(authority, /grainline_order_seller_summary_after_page/u);
});
