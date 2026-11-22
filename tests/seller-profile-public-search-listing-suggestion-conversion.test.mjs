import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/search/suggestions/route.ts", "utf8");

test("listing suggestions delegate seller eligibility to an exact listing authority", () => {
  assert.match(source, /listingPublicTitleSuggestions\(meDbId, q\)/u);
  assert.match(source, /listingPublicCatalogPage\([\s\S]*\{ listingIds \}/u);
  assert.match(source, /sellerPublicListingCards\(viewerUserId, listingIds\)/u);
  assert.doesNotMatch(source, /JOIN "SellerProfile"|prisma\.listing\./u);
});
