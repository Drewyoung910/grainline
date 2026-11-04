import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("new-listing metro assignment is owner-, version-, and topology-bound", async () => {
  const [migration, ownerAccess, newPage, provision] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingOwnerAccess.ts", root), "utf8"),
    readFile(new URL("src/app/dashboard/listings/new/page.tsx", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_assign_metros\(\s*p_listing_id text,\s*p_expected_updated_at timestamp without time zone,\s*p_metro_id text,\s*p_city_metro_id text\s*\)/u,
  );
  assert.match(
    migration,
    /RETURNS TABLE \(applied boolean, "updatedAt" timestamp without time zone\)/u,
  );
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /listing\."sellerId" = seller_id[\s\S]*FOR UPDATE/u);
  assert.match(migration, /source_listing\."updatedAt" IS DISTINCT FROM p_expected_updated_at/u);
  assert.match(migration, /source_listing\."archivedAt" IS NOT NULL/u);
  assert.match(migration, /source_listing\."metroId" IS NOT NULL/u);
  assert.match(migration, /source_listing\."cityMetroId" IS NOT NULL/u);
  assert.match(
    migration,
    /major_metro\."isActive" = true[\s\S]*major_metro\."parentMetroId" IS NULL/u,
  );
  assert.match(
    migration,
    /city_metro\."isActive" = true[\s\S]*city_metro\."parentMetroId" = p_metro_id/u,
  );

  assert.match(ownerAccess, /export function assignListingOwnerMetros/u);
  assert.match(ownerAccess, /withDbUserContext\(userId,/u);
  assert.match(ownerAccess, /FROM public\.grainline_listing_owner_assign_metros\(/u);
  assert.match(ownerAccess, /row\.updatedAt instanceof Date/u);

  assert.match(newPage, /assignListingOwnerMetros\(seller\.userId,/u);
  assert.match(newPage, /expectedUpdatedAt: reviewedListingVersion/u);
  assert.match(newPage, /reviewedListingVersion = assignment\.updatedAt/u);
  assert.doesNotMatch(newPage, /prisma\.listing\.update\(/u);

  assert.match(
    provision,
    /public\."grainline_listing_owner_assign_metros"\(text,timestamp without time zone,text,text\)'\s*,\s*true/u,
  );
});
