import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/search/suggestions/route.ts", "utf8");

test("listing suggestions delegate seller eligibility to an exact listing authority", () => {
  const listingSuggestionSource = source.slice(
    source.indexOf("async function listingFuzzySuggestionRows"),
    source.indexOf("async function blogFuzzySuggestionRows"),
  );
  assert.match(listingSuggestionSource, /grainline_seller_public_follower_listing_target/u);
  assert.doesNotMatch(listingSuggestionSource, /JOIN "SellerProfile"/u);
  assert.equal(
    listingSuggestionSource.match(/grainline_seller_public_follower_listing_target/gu)?.length,
    1,
  );
});
