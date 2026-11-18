import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("tag and metro pages share one bounded public catalog authority", async () => {
  const [migration, access, tagPage, metroPage, metroCategoryPage, provision, scenario, runner] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingPublicCatalogAccess.ts", root), "utf8"),
    readFile(new URL("src/app/tag/[slug]/page.tsx", root), "utf8"),
    readFile(new URL("src/app/browse/[metroSlug]/page.tsx", root), "utf8"),
    readFile(new URL("src/app/browse/[metroSlug]/[category]/page.tsx", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-public-catalog.mjs", root), "utf8"),
    readFile(new URL("tests/database-full-chain-postgres.test.mjs", root), "utf8"),
  ]);

  const start = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_public_catalog_page(",
  );
  const end = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_detail_source_core(",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const authority = migration.slice(start, end);

  assert.match(authority, /listing\.status = 'ACTIVE'::public\."ListingStatus"/u);
  assert.match(authority, /listing\."isPrivate" = false/u);
  assert.match(authority, /listing\."archivedAt" IS NULL/u);
  assert.match(authority, /listing\."sellerPubliclyOrderable" = true/u);
  assert.match(authority, /public\."Block"/u);
  assert.match(authority, /'id', page\.id/u);
  assert.match(authority, /'url', photo\.url/u);
  assert.doesNotMatch(authority, /originalUrl/u);
  assert.match(
    authority,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_public_catalog_page\(jsonb,integer,integer\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(access, /grainline_listing_public_catalog_page/u);
  assert.match(access, /withDbUserContext/u);
  assert.match(tagPage, /listingPublicCatalogCount/u);
  assert.match(tagPage, /listingPublicCatalogPage/u);
  assert.doesNotMatch(tagPage, /prisma\.listing\.(?:count|findMany)/u);
  assert.match(metroCategoryPage, /listingPublicCatalogPage/u);
  assert.doesNotMatch(metroCategoryPage, /prisma\.listing\.(?:count|findMany|groupBy)/u);
  assert.doesNotMatch(metroCategoryPage, /generateStaticParams/u);
  assert.match(access, /categoryCounts/u);
  assert.match(metroPage, /includeCategoryCounts: true/u);
  assert.match(metroPage, /categoryCounts/u);
  assert.doesNotMatch(metroPage, /prisma\.listing\.(?:count|findMany)/u);
  assert.match(
    provision,
    /public\."grainline_listing_public_catalog_page"\(jsonb, integer, integer\)'\s*,\s*true/u,
  );

  for (const expected of [
    "tag filter",
    "metro category filter",
    "blocked seller exclusion",
    "private listing exclusion",
    "sold-out listing exclusion",
    "originalUrl",
    "unknown public-catalog filters fail closed",
    "category facets",
  ]) {
    assert.match(scenario, new RegExp(expected, "u"));
  }
  assert.match(runner, /proveListingDomainPublicCatalog/u);
});
