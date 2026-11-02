import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("exact and related public Listing targets reuse the bounded catalog authority", async () => {
  const [access, migration, listingPage, customOrder, scenario] = await Promise.all([
    readFile(new URL("src/lib/listingPublicCatalogAccess.ts", root), "utf8"),
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/app/listing/[id]/page.tsx", root), "utf8"),
    readFile(new URL("src/app/api/messages/custom-order-request/route.ts", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-public-catalog.mjs", root), "utf8"),
  ]);

  for (const filter of ["listingIds", "excludeListingId"]) {
    assert.match(access, new RegExp(filter, "u"));
    assert.match(migration, new RegExp(`'${filter}'`, "u"));
  }

  assert.match(
    listingPage,
    /listingPublicCatalogPage\([\s\S]*sellerId: listing\.sellerId,[\s\S]*excludeListingId: listing\.id,[\s\S]*sort: "quality"/u,
  );
  assert.doesNotMatch(listingPage, /prisma\.listing\.findMany\(/u);

  assert.match(
    customOrder,
    /listingPublicCatalogPage\(\s*me\.id,\s*\{[\s\S]*sellerId: seller\.sellerProfileId,[\s\S]*listingIds: \[listingId\]/u,
  );
  assert.doesNotMatch(customOrder, /prisma\.listing\.findFirst\(/u);

  assert.match(scenario, /exact listing-id catalog filter/u);
  assert.match(scenario, /excluded listing-id catalog filter/u);
  assert.match(scenario, /empty listing-id filters fail closed/u);
});
