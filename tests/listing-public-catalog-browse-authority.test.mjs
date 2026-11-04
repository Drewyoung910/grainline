import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("main browse uses the shared bounded public catalog authority", async () => {
  const [browse, access, migration, scenario] = await Promise.all([
    readFile(new URL("src/app/browse/page.tsx", root), "utf8"),
    readFile(new URL("src/lib/listingPublicCatalogAccess.ts", root), "utf8"),
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-public-catalog.mjs", root), "utf8"),
  ]);

  assert.match(browse, /listingPublicCatalogPage/u);
  assert.doesNotMatch(browse, /prisma\.listing\.(?:count|findMany)/u);
  assert.doesNotMatch(browse, /function fetchListings/u);
  assert.match(
    access,
    /const SORTS = new Set<ListingPublicCatalogSort>\(\[[\s\S]*"relevant"[\s\S]*\]\);/u,
    "the TypeScript boundary must accept the relevance sort that browse sends and PostgreSQL implements",
  );

  for (const filter of [
    "query",
    "selectedTags",
    "minPriceCents",
    "maxPriceCents",
    "listingType",
    "shipsWithinDays",
    "minimumSellerRating",
    "locationLat",
    "locationLng",
    "locationRadiusMiles",
  ]) {
    assert.match(access, new RegExp(filter, "u"));
    assert.match(migration, new RegExp(`'${filter}'`, "u"));
  }

  for (const proof of [
    "browse text relevance",
    "browse search treats wildcard characters literally",
    "browse selected-tag filter",
    "browse price filter",
    "browse shipping filter",
    "browse rating filter",
    "browse location filter",
    "browse popular fallback",
  ]) {
    assert.match(scenario, new RegExp(proof, "u"));
  }
});
