import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const directCases = [
  ["src/app/browse/[metroSlug]/page.tsx", "const [listingRows", "prisma.listing.count"],
];

for (const [file, selectionStart, selectionEnd] of directCases) {
  test(`${file} hydrates seller cards through the bounded authority`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, /sellerPublicListingCards\(meDbId, listingRows\.map/u);
    const start = source.indexOf(selectionStart);
    const end = source.indexOf(selectionEnd, start);
    assert.ok(start >= 0 && end > start, `missing reviewed listing selection in ${file}`);
    assert.doesNotMatch(source.slice(start, end), /seller:\s*\{/u);
  });
}

for (const file of [
  "src/app/tag/[slug]/page.tsx",
  "src/app/browse/[metroSlug]/[category]/page.tsx",
]) {
  test(`${file} hydrates bounded public-catalog rows through the seller authority`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, /listingPublicCatalogPage/u);
    assert.match(source, /sellerPublicListingCards\(meDbId, listingRows\.map/u);
    assert.doesNotMatch(source, /prisma\.listing\.(?:findMany|count)/u);
  });
}
