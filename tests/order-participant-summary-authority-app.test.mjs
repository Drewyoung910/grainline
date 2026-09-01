import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("buyer summary surfaces use the bounded database projection", () => {
  const dashboard = readFileSync("src/app/dashboard/orders/page.tsx", "utf8");
  const account = readFileSync("src/app/account/page.tsx", "utf8");
  const authority = readFileSync("src/lib/orderParticipantReadAuthority.ts", "utf8");

  for (const [path, source] of [
    ["dashboard orders", dashboard],
    ["account overview", account],
  ]) {
    assert.match(source, /readBuyerOrderSummaryPage/u, path);
    assert.doesNotMatch(source, /prisma\.order\.(?:findMany|count)/u, path);
    assert.match(source, /\.title/u, path);
    assert.doesNotMatch(source, /listingSnapshot|readHistoricalOrderItemSnapshot/u, path);
  }
  assert.match(authority, /grainline_order_buyer_summary_page/u);
  assert.match(dashboard, /itemCount > o\.items\.length/u);
});
