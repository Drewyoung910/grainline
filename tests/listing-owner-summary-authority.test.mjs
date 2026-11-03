import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
  import.meta.url,
);
const accessPath = new URL("../src/lib/listingOwnerAccess.ts", import.meta.url);
const dashboardPath = new URL("../src/app/dashboard/page.tsx", import.meta.url);
const profilePath = new URL("../src/app/dashboard/profile/page.tsx", import.meta.url);
const inventoryPath = new URL("../src/app/dashboard/inventory/page.tsx", import.meta.url);
const provisionPath = new URL("../scripts/provision-runtime-db-role.sql", import.meta.url);

test("owner workshop listing summaries use one actor-bound paged authority", async () => {
  const [migration, access, dashboard, profile, inventory, provision] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(accessPath, "utf8"),
    readFile(dashboardPath, "utf8"),
    readFile(profilePath, "utf8"),
    readFile(inventoryPath, "utf8"),
    readFile(provisionPath, "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_summary_page\([\s\S]*p_status text,[\s\S]*p_listing_type text,[\s\S]*p_include_archived boolean,[\s\S]*p_before_updated_at timestamp without time zone,[\s\S]*p_before_listing_id text,[\s\S]*p_limit integer/u,
  );
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /listing\."sellerId" = seller_id/u);
  assert.match(migration, /ORDER BY listing\."updatedAt" DESC, listing\.id DESC/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_summary_page\([\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(access, /export function listingOwnerSummaryRows\(\s*userId: string/u);
  assert.match(access, /FROM public\.grainline_listing_owner_summary_page\(/u);
  assert.match(access, /Prisma\.TransactionIsolationLevel\.RepeatableRead/u);

  assert.match(dashboard, /listingOwnerSummaryRows\(me\.id,[\s\S]*includeArchived: false,[\s\S]*take: 6/u);
  assert.match(profile, /listingOwnerSummaryRows\(me\.id,[\s\S]*status: ListingStatus\.ACTIVE/u);
  assert.match(inventory, /listingOwnerSummaryRows\(me\.id,[\s\S]*listingType: ListingType\.IN_STOCK,[\s\S]*take: 100/u);
  for (const source of [dashboard, profile, inventory]) {
    assert.doesNotMatch(source, /prisma\.listing\.findMany\(/u);
  }
  assert.match(
    provision,
    /public\."grainline_listing_owner_summary_page"\(text,text,boolean,timestamp without time zone,text,integer\)'\s*,\s*true/u,
  );
});
