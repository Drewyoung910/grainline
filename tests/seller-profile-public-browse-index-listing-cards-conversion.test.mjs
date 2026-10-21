import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const browse = readFileSync("src/app/browse/page.tsx", "utf8");

test("browse index hydrates card presentation through the bounded authority", () => {
  const selectStart = browse.indexOf("async function fetchListings");
  const selectEnd = browse.indexOf("function scoreListings", selectStart);
  assert.ok(selectStart >= 0 && selectEnd > selectStart, "missing reviewed browse selection");
  assert.doesNotMatch(browse.slice(selectStart, selectEnd), /seller:\s*\{/u);
  assert.match(browse, /sellerPublicListingCards\(viewerUserId, rows\.map/u);
  assert.match(browse, /if \(!seller \|\| seller\.sellerProfileId !== listing\.sellerId\) return \[\];/u);
  assert.match(browse, /const featured = await hydrateSellerCards\(meDbId, featuredRows\)/u);
});
