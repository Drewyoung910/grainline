import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/listings/[id]/stock/route.ts", "utf8");

test("listing stock ownership uses the actor-bound owner core without a SellerProfile relation", () => {
  assert.match(route, /const seller = await sellerOwnerCore\(me\.id\)/u);
  assert.match(route, /where: \{ id, sellerId: seller\.sellerProfileId \}/u);
  assert.doesNotMatch(route, /seller:\s*\{\s*userId: me\.id\s*\}/u);
  assert.doesNotMatch(route, /seller:\s*\{\s*select:/u);
  assert.match(route, /sellerId: seller\.sellerProfileId, actorId: me\.id/u);
  assert.match(route, /AND "sellerId" = \$\{seller\.sellerProfileId\}/u);
  assert.match(route, /userId: me\.id/u);
});
