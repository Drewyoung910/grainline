import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/listings/[id]/stock/route.ts", "utf8");

test("listing stock ownership uses the actor-bound Listing action state", () => {
  assert.match(route, /const listing = await listingOwnerActionState\(me\.id, id\)/u);
  assert.doesNotMatch(route, /seller:\s*\{\s*userId: me\.id\s*\}/u);
  assert.doesNotMatch(route, /seller:\s*\{\s*select:/u);
  assert.doesNotMatch(route, /prisma\.listing\.findFirst/u);
  assert.doesNotMatch(route, /sellerOwnerCore/u);
  assert.match(route, /sellerId: listing\.sellerId, actorId: me\.id/u);
  assert.match(route, /applyListingStockMutation\(tx, \{[\s\S]*sellerId: listing\.sellerId/u);
  assert.doesNotMatch(route, /UPDATE "Listing"|FROM "Listing"/u);
  assert.match(route, /userId: me\.id/u);
});
