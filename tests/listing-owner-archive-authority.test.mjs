import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("listing deletion archives an exact-version owned row through one fixed authority", async () => {
  const [migration, ownerAccess, listingDelete, provision] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingOwnerAccess.ts", root), "utf8"),
    readFile(new URL("src/lib/listingDelete.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
  ]);

  const authorityStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_archive(",
  );
  const authorityEnd = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_transition(",
    authorityStart,
  );
  assert.ok(authorityStart >= 0 && authorityEnd > authorityStart);
  const authority = migration.slice(authorityStart, authorityEnd);

  assert.match(
    authority,
    /CREATE FUNCTION public\.grainline_listing_owner_archive\(\s*p_listing_id text,\s*p_expected_updated_at timestamp without time zone\s*\)/u,
  );
  assert.match(authority, /current_setting\('app\.user_id', true\)/u);
  assert.match(authority, /actor\.banned = false/u);
  assert.match(authority, /actor\."deletedAt" IS NULL/u);
  assert.match(authority, /seller\."ownerAccountActive" = true/u);
  assert.match(authority, /listing\."sellerId" = seller_id/u);
  assert.match(authority, /listing\."updatedAt" = p_expected_updated_at/u);
  assert.match(authority, /listing\."archivedAt" IS NULL/u);
  assert.match(authority, /listing\.status <> 'PENDING_REVIEW'/u);
  assert.match(authority, /FOR UPDATE/u);
  assert.match(authority, /SET status = 'HIDDEN'/u);
  assert.match(authority, /"isPrivate" = true/u);
  assert.match(authority, /"archivedAt" = source_now/u);
  assert.match(authority, /"updatedAt" = source_now/u);
  assert.match(
    authority,
    /REVOKE ALL ON FUNCTION public\.grainline_listing_owner_archive\(\s*text,timestamp without time zone\s*\)[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(
    authority,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_archive\(\s*text,timestamp without time zone\s*\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(ownerAccess, /export async function archiveListingOwnerDeleteState/u);
  assert.match(ownerAccess, /DbUserContextTransactionClient/u);
  assert.match(ownerAccess, /FROM public\.grainline_listing_owner_archive\(/u);

  assert.match(
    listingDelete,
    /archiveListingOwnerDeleteState\(\s*tx,\s*normalizedListingId,\s*listing\.updatedAt,?\s*\)/u,
  );
  assert.doesNotMatch(listingDelete, /tx\.listing\.updateMany/u);
  assert.match(listingDelete, /withSerializableDbUserContext/u);

  assert.match(
    provision,
    /public\."grainline_listing_owner_archive"\(text,timestamp without time zone\)'\s*,\s*true/u,
  );
});
