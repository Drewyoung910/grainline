import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("seller shop bounds public and owner catalogs without broad private Listing reads", async () => {
  const shop = await readFile(
    new URL("src/app/seller/[id]/shop/page.tsx", root),
    "utf8",
  );
  const ownerAccess = await readFile(
    new URL("src/lib/listingOwnerCatalogAccess.ts", root),
    "utf8",
  );
  const migration = await readFile(
    new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root),
    "utf8",
  );
  const provision = await readFile(
    new URL("scripts/provision-runtime-db-role.sql", root),
    "utf8",
  );
  const scenario = await readFile(
    new URL("tools/database-full-chain/scenarios/listing-domain-public-catalog.mjs", root),
    "utf8",
  );

  assert.match(
    shop,
    /import \{ listingPublicCatalogCount, listingPublicCatalogPage \} from "@\/lib\/listingPublicCatalogAccess"/u,
  );
  assert.match(shop, /listingOwnerCatalogPage\(/u);
  assert.match(ownerAccess, /grainline_listing_owner_catalog_page/u);
  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_catalog_page\(\s*p_seller_profile_id text,\s*p_filter jsonb,\s*p_offset integer,\s*p_limit integer\s*\)/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_catalog_page\(\s*text,jsonb,integer,integer\s*\)[\s\S]*TO grainline_app_runtime/u,
  );
  assert.match(
    provision,
    /public\."grainline_listing_owner_catalog_page"\(text,jsonb,integer,integer\)'\s*,\s*true/u,
  );
  assert.match(shop, /sellerId,[\s\S]*includeCategoryCounts: true/u);
  assert.match(shop, /sellerId,[\s\S]*\.\.\.\(tag \? \{ tag \} : \{\}\)/u);
  assert.doesNotMatch(shop, /prisma\.listing\.(?:groupBy|count)\(/u);

  // This page intentionally keeps its safe-column card list direct. The public
  // policy and explicit column grants protect that read after activation, while
  // owner-only drafts remain on the separately reviewed owner path.
  assert.match(shop, /:\s*await prisma\.listing\.findMany\(/u);
  assert.match(shop, /const listings = isOwner[\s\S]*listingOwnerCatalogPage\(/u);
  for (const evidence of [
    "cross-user owner catalog denial",
    "owner price ordering includes the private listing",
    "owner category facets preserve status and tag filters",
    "owner nonpublic status filter",
  ]) assert.match(scenario, new RegExp(evidence, "u"));
});
