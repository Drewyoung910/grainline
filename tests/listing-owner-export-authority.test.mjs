import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
  import.meta.url,
);
const accessPath = new URL("../src/lib/listingOwnerAccess.ts", import.meta.url);
const exportRoutePath = new URL("../src/app/api/account/export/route.ts", import.meta.url);
const provisionPath = new URL("../scripts/provision-runtime-db-role.sql", import.meta.url);

test("listing owner export is actor-bound, paged, and replaces direct Listing export reads", async () => {
  const [migration, access, route, provision] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(accessPath, "utf8"),
    readFile(exportRoutePath, "utf8"),
    readFile(provisionPath, "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_export_page\(\s*p_before_created_at timestamp without time zone,\s*p_before_listing_id text,\s*p_limit integer\s*\)/u,
  );
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /actor\.id = actor_id/u);
  assert.match(migration, /listing\."sellerId" = seller_id/u);
  assert.match(migration, /ORDER BY listing\."createdAt" DESC, listing\.id DESC/u);
  assert.match(migration, /LIMIT p_limit/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_export_page\([\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(access, /export function listingOwnerExportRows\(userId: string\)/u);
  assert.match(access, /withDbUserContext\(/u);
  assert.match(access, /Prisma\.TransactionIsolationLevel\.RepeatableRead/u);
  assert.match(access, /Listing owner export cursor did not advance/u);
  assert.match(access, /FROM public\.grainline_listing_owner_export_page\(/u);

  assert.match(route, /listingOwnerExportRows\(user\.id\)/u);
  assert.doesNotMatch(route, /prisma\.listing\.findMany\(/u);
  assert.match(
    provision,
    /public\."grainline_listing_owner_export_page"\(timestamp without time zone,text,integer\)'\s*,\s*true/u,
  );
});
