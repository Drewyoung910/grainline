import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cases = [
  "src/app/tag/[slug]/page.tsx",
  "src/app/browse/[metroSlug]/page.tsx",
  "src/app/browse/[metroSlug]/[category]/page.tsx",
];

for (const file of cases) {
  test(`${file} hydrates seller cards through the bounded authority`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, /sellerPublicListingCards\(meDbId, listingRows\.map/u);
    assert.match(source, /listingPublicCatalogPage\(/u);
    assert.doesNotMatch(source, /prisma\.listing\.(?:findMany|count)/u);
  });
}
