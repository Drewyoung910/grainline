import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/checkout/success/page.tsx", "utf8");
const authority = readFileSync("src/lib/orderCheckoutReceiptAuthority.ts", "utf8");
const state = readFileSync("src/lib/orderCheckoutReceiptState.ts", "utf8");

test("checkout success uses only the fixed buyer receipt projection", () => {
  assert.match(page, /readBuyerCheckoutReceipts\(me\.id, sessionIds\)/u);
  assert.match(page, /readBuyerCheckoutReceipts\(me\.id, \[sessionId\]\)/u);
  assert.doesNotMatch(page, /\b(?:prisma|tx|client)\.order\b/u);
  assert.doesNotMatch(page, /listingSnapshot|readHistoricalOrderItemSnapshot/u);
  assert.match(authority, /grainline_order_buyer_receipts_by_sessions/u);
  assert.match(authority, /normalizeDbUserContextUserId/u);
  assert.match(authority, /values\.length > 50/u);
  assert.match(authority, /new Set\(values\)\.size !== values\.length/u);
});

test("checkout receipts preserve snapshot identity and actor-visible links", () => {
  assert.match(page, /order\.buyerLabel \?\? "Guest"/u);
  assert.match(page, /item\.snapshot\.title/u);
  assert.match(page, /item\.snapshot\.sellerName/u);
  assert.match(page, /item\.listingLinkAvailable/u);
  assert.doesNotMatch(page, /order\.buyer\?\.(?:name|email)/u);
  assert.match(state, /projectedSubtotal !== itemsSubtotalCents/u);
});

test("checkout success performs one real bounded webhook-race retry", () => {
  assert.match(page, /await delay\(250\)/u);
  assert.equal((page.match(/await delay\(250\)/gu) ?? []).length, 1);
  assert.match(page, /webhook is the only order writer/u);
  assert.doesNotMatch(page, /\$transaction|\.create\s*\(/u);
});
