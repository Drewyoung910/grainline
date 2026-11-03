import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
  "utf8",
);
const editorPage = readFileSync(
  "src/app/dashboard/listings/[id]/edit/page.tsx",
  "utf8",
);
const access = readFileSync("src/lib/listingOwnerAccess.ts", "utf8");

test("owner editor projection is actor-bound and includes bounded media and variants", () => {
  assert.match(migration, /CREATE FUNCTION public\.grainline_listing_owner_editor\(\s*p_listing_id text\s*\)/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /actor\.banned = false/u);
  assert.match(migration, /actor\."deletedAt" IS NULL/u);
  assert.match(migration, /seller\."ownerAccountActive"/u);
  assert.match(migration, /listing\."sellerId" = seller_id/u);
  assert.match(migration, /listing\."archivedAt" IS NULL/u);
  assert.match(migration, /pg_catalog\.jsonb_agg[\s\S]*FROM public\."Photo"/u);
  assert.match(migration, /pg_catalog\.jsonb_agg[\s\S]*FROM public\."ListingVariantGroup"/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_editor\(text\)[\s\S]*TO grainline_app_runtime/u);
});

test("listing editor reads owner state only through the bounded authority", () => {
  assert.match(access, /export function listingOwnerEditor/u);
  assert.match(access, /if \(!validId\(listingId\)\) return Promise\.resolve\(null\)/u);
  assert.match(access, /row\.materials\.every\(\(material\) => typeof material === "string"\)/u);
  assert.match(editorPage, /listingOwnerEditor\(actor\.id, listingId\)/u);
  assert.match(editorPage, /listingOwnerEditor\(actor\.id, id\)/u);
  assert.doesNotMatch(editorPage, /prisma\.listing\.findFirst/u);
});
