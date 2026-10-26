import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stockRoute = readFileSync("src/app/api/listings/[id]/stock/route.ts", "utf8");

test("back-in-stock candidate selection delegates eligibility to the claim authority", () => {
  const start = stockRoute.indexOf("const candidateSubscribers = await stockNotificationRestockCandidates(");
  const end = stockRoute.indexOf("if (candidateSubscribers.length === 0) return;", start);
  assert.ok(start >= 0 && end > start, "missing reviewed candidate-selection block");
  const selection = stockRoute.slice(start, end);
  assert.match(selection, /backInStockAuthoritySourceId/u);
  assert.match(selection, /BACK_IN_STOCK_CLAIM_BATCH_SIZE/u);
  assert.doesNotMatch(selection, /userId/u);
  assert.doesNotMatch(selection, /StockNotification/u);
  assert.doesNotMatch(selection, /"SellerProfile"/u);
  assert.doesNotMatch(selection, /available_listing/u);
  assert.match(stockRoute, /claimBackInStockNotification\(\{[\s\S]{0,220}restockAuditId: backInStockAuthoritySourceId,[\s\S]{0,160}stockNotificationId/u);
  assert.match(stockRoute, /if \(claimedSubscribers\.length === 0\) return;/u);
});
