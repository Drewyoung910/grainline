import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("global Listing title suggestions use one bounded indexed authority", async () => {
  const [migration, access, route, provision, inventory, scenario] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingPublicCatalogAccess.ts", root), "utf8"),
    readFile(new URL("src/app/api/search/suggestions/route.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tests/db-grant-inventory.test.mjs", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-public-catalog.mjs", root), "utf8"),
  ]);

  assert.match(migration, /CREATE FUNCTION public\.grainline_listing_public_title_suggestions\(\s*p_query text\s*\)/u);
  assert.match(migration, /OPERATOR\(public\.%\)/u);
  assert.match(migration, /public\.similarity/u);
  assert.match(migration, /pg_trgm\.similarity_threshold/u);
  assert.match(migration, /listing\."sellerPubliclyOrderable" = true/u);
  assert.match(migration, /public\."Block"/u);
  assert.match(migration, /ESCAPE E'\\\\'/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_public_title_suggestions\(text\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(access, /export (?:async )?function listingPublicTitleSuggestions/u);
  assert.match(access, /grainline_listing_public_title_suggestions/u);
  assert.match(access, /withDbUserContext/u);
  assert.match(route, /listingPublicTitleSuggestions\(meDbId, q\)/u);
  assert.doesNotMatch(route, /prisma\.listing\.|FROM "Listing"|FROM public\."Listing"/u);
  assert.doesNotMatch(route, /listingFuzzySuggestionRows/u);

  assert.match(
    provision,
    /public\."grainline_listing_public_title_suggestions"\(text\)'\s*,\s*true/u,
  );
  assert.match(inventory, /"grainline_listing_public_title_suggestions"/u);
  for (const evidence of [
    "exact title suggestions",
    "fuzzy title suggestions",
    "suggestion wildcard characters are literal",
    "blocked title suggestions",
  ]) {
    assert.match(scenario, new RegExp(evidence, "u"));
  }
});
