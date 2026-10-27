import assert from "node:assert/strict";
import test from "node:test";

const {
  isSimilarListingCategoryMatch,
  normalizeSimilarListingCategoryMatch,
} = await import("../src/lib/sellerSimilarListingCategory.ts");

test("an uncategorized similar listing becomes a non-match instead of taking down the page", () => {
  assert.equal(isSimilarListingCategoryMatch(null), true);
  assert.equal(normalizeSimilarListingCategoryMatch(null), false);
  assert.equal(normalizeSimilarListingCategoryMatch(false), false);
  assert.equal(normalizeSimilarListingCategoryMatch(true), true);
});

test("similar-listing authority still rejects non-null non-boolean category output", () => {
  assert.equal(isSimilarListingCategoryMatch("false"), false);
  assert.equal(isSimilarListingCategoryMatch(0), false);
  assert.equal(isSimilarListingCategoryMatch(undefined), false);
});
