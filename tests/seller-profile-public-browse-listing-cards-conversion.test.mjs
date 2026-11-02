import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const file of [
  "src/app/tag/[slug]/page.tsx",
  "src/app/browse/[metroSlug]/page.tsx",
  "src/app/browse/[metroSlug]/[category]/page.tsx",
]) {
  test(`${file} hydrates bounded public-catalog rows through the seller authority`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, /listingPublicCatalogPage/u);
    assert.match(source, /sellerPublicListingCards\(meDbId, listingRows\.map/u);
    assert.doesNotMatch(source, /prisma\.listing\.(?:findMany|count)/u);
  });
}
