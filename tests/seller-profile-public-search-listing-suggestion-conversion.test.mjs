import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/api/search/suggestions/route.ts", "utf8");
const authority = readFileSync(
  "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
  "utf8",
);

test("listing suggestions delegate seller eligibility to an exact listing authority", () => {
  assert.match(source, /listingPublicTitleSuggestions\(meDbId, q\)/u);
  assert.doesNotMatch(source, /prisma\.listing\.|FROM "Listing"/u);
  assert.match(authority, /grainline_listing_public_title_suggestions/u);
  assert.match(authority, /listing\."sellerPubliclyOrderable" = true/u);
  assert.match(authority, /public\."Block"/u);
});
