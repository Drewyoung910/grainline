import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/page.tsx", "utf8");
const cardSelect = page.slice(
  page.indexOf("const homeListingCardSelect"),
  page.indexOf("async function getFeaturedMakerBlock"),
);

test("homepage listing rows hydrate seller cards through the bounded authority", () => {
  assert.match(page, /sellerPublicListingCards\(meDbId, homeListingIds\)/u);
  assert.match(page, /const homeListingCardById = new Map/u);
  assert.match(page, /hydrateHomeListingCards\(freshRows, homeListingCardById\)/u);
  assert.match(page, /hydrateHomeListingCards\(topSavedRows, homeListingCardById\)/u);
  assert.doesNotMatch(cardSelect, /seller:\s*\{/u);
});
