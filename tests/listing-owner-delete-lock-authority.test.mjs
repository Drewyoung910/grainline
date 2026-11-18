import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("listing deletion locks an active owner's exact row through one fixed authority", async () => {
  const [migration, ownerAccess, listingDelete, provision] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingOwnerAccess.ts", root), "utf8"),
    readFile(new URL("src/lib/listingDelete.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
  ]);

  const authorityStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_delete_lock(",
  );
  const authorityEnd = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_transition(",
    authorityStart,
  );
  assert.ok(authorityStart >= 0 && authorityEnd > authorityStart);
  const authority = migration.slice(authorityStart, authorityEnd);
  assert.match(
    authority,
    /CREATE FUNCTION public\.grainline_listing_owner_delete_lock\(\s*p_listing_id text\s*\)/u,
  );
  assert.match(authority, /current_setting\('app\.user_id', true\)/u);
  assert.match(authority, /actor\.banned = false/u);
  assert.match(authority, /actor\."deletedAt" IS NULL/u);
  assert.match(authority, /seller\."ownerAccountActive" = true/u);
  assert.match(authority, /listing\."sellerId" = seller_id[\s\S]*FOR UPDATE/u);
  assert.match(authority, /source_listing\."updatedAt"/u);
  assert.match(
    authority,
    /REVOKE ALL ON FUNCTION public\.grainline_listing_owner_delete_lock\(text\)[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(
    authority,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_delete_lock\(text\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(ownerAccess, /export async function lockListingOwnerDeleteState/u);
  assert.match(ownerAccess, /DbUserContextTransactionClient/u);
  assert.match(ownerAccess, /FROM public\.grainline_listing_owner_delete_lock\(/u);

  assert.match(
    listingDelete,
    /lockListingOwnerDeleteState\(\s*tx,\s*normalizedListingId,?\s*\)/u,
  );
  assert.doesNotMatch(listingDelete, /FROM public\."Listing" AS listing/u);
  assert.doesNotMatch(listingDelete, /FOR UPDATE OF listing/u);
  assert.match(listingDelete, /withSerializableDbUserContext/u);

  assert.match(
    provision,
    /public\."grainline_listing_owner_delete_lock"\(text\)'\s*,\s*true/u,
  );
});
