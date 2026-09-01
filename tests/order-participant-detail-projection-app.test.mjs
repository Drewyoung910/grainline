import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("buyer and seller detail pages use the fixed v2 participant projections", () => {
  const buyer = readFileSync("src/app/dashboard/orders/[id]/page.tsx", "utf8");
  const seller = readFileSync("src/app/dashboard/sales/[orderId]/page.tsx", "utf8");
  const authority = readFileSync("src/lib/orderParticipantDetailAuthority.ts", "utf8");
  const state = readFileSync("src/lib/orderParticipantDetailState.ts", "utf8");

  assert.match(buyer, /readBuyerOrderDetail\(me\.id, id\)/u);
  assert.match(seller, /readSellerOrderDetail\(me\.id, orderId\)/u);
  for (const [label, source] of [["buyer", buyer], ["seller", seller]]) {
    assert.doesNotMatch(source, /prisma\.order|listingSnapshot|readHistoricalOrderItemSnapshot/u, label);
    assert.match(source, /it\.listingActive/u, label);
  }
  assert.match(authority, /grainline_order_buyer_detail_v2/u);
  assert.match(authority, /grainline_order_seller_detail_v2/u);
  assert.doesNotMatch(authority, /FROM public\.grainline_order_(?:buyer|seller)_detail\(/u);
  assert.match(state, /buyer purge boundary is inconsistent/u);
  assert.match(state, /seller note purge boundary is inconsistent/u);
  assert.match(state, /label boundary is inconsistent/u);
});

test("detail contact actions fail closed when the counterparty is unavailable", () => {
  const buyer = readFileSync("src/app/dashboard/orders/[id]/page.tsx", "utf8");
  const seller = readFileSync("src/app/dashboard/sales/[orderId]/page.tsx", "utf8");

  assert.match(buyer, /let messageHref: string \| null = null/u);
  assert.match(buyer, /The maker&apos;s account is not available for messages/u);
  assert.match(buyer, /href="\/support"/u);
  assert.match(seller, /order\.buyerId \? \(/u);
  assert.doesNotMatch(seller, /order\.buyer\?\.id/u);
  assert.doesNotMatch(seller, /sellerRefundId/u);
});
