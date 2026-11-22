import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const browse = readFileSync("src/app/browse/page.tsx", "utf8");

test("browse index hydrates card presentation through the bounded authority", () => {
  assert.match(browse, /listingPublicCatalogPage\(/u);
  assert.doesNotMatch(browse, /prisma\.listing\.(?:findMany|count)/u);
  assert.match(browse, /sellerPublicListingCards\(viewerUserId, rows\.map/u);
  assert.match(browse, /if \(!seller \|\| seller\.sellerProfileId !== listing\.sellerId\) return \[\];/u);
  assert.match(browse, /const featured = await hydrateSellerCards\(meDbId, \[\.\.\.featuredPage\.listings\]\)/u);
});
