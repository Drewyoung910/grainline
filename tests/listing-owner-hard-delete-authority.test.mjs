import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("listing deletion hard-deletes an exact-version unreferenced owned row through one fixed authority", async () => {
  const [migration, ownerAccess, listingDelete, provision] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingOwnerAccess.ts", root), "utf8"),
    readFile(new URL("src/lib/listingDelete.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
  ]);

  const authorityStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_hard_delete(",
  );
  const authorityEnd = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_transition(",
    authorityStart,
  );
  assert.ok(authorityStart >= 0 && authorityEnd > authorityStart);
  const authority = migration.slice(authorityStart, authorityEnd);

  assert.match(
    authority,
    /CREATE FUNCTION public\.grainline_listing_owner_hard_delete\(\s*p_listing_id text,\s*p_expected_updated_at timestamp without time zone\s*\)/u,
  );
  assert.match(authority, /current_setting\('app\.user_id', true\)/u);
  assert.match(authority, /actor\.banned = false/u);
  assert.match(authority, /actor\."deletedAt" IS NULL/u);
  assert.match(authority, /seller\."ownerAccountActive" = true/u);
  assert.match(authority, /listing\."sellerId" = seller_id/u);
  assert.match(authority, /listing\."updatedAt" = p_expected_updated_at/u);
  assert.match(authority, /listing\."archivedAt" IS NULL/u);
  assert.match(authority, /listing\."customOrderConversationId" IS NULL/u);
  assert.match(authority, /listing\.status <> 'PENDING_REVIEW'/u);
  assert.match(authority, /FOR UPDATE/u);
  assert.match(authority, /grainline_listing_delete_reference_state/u);
  assert.match(authority, /reference_state\."hasOrderItems"/u);
  assert.match(authority, /reference_state\."hasReviews"/u);
  assert.match(authority, /reference_state\."hasConversations"/u);
  assert.match(authority, /reference_state\."hasMessages"/u);
  assert.match(authority, /reference_state\."hasCheckoutReservations"/u);
  assert.match(authority, /grainline_direct_upload_sync_listing/u);
  assert.match(authority, /upload_result\.untracked <> 0/u);
  assert.match(authority, /DELETE FROM public\."Photo"/u);
  assert.match(authority, /DELETE FROM public\."Listing"/u);
  assert.match(
    authority,
    /REVOKE ALL ON FUNCTION public\.grainline_listing_owner_hard_delete\(\s*text,timestamp without time zone\s*\)[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(
    authority,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_hard_delete\(\s*text,timestamp without time zone\s*\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(ownerAccess, /export async function hardDeleteListingOwnerDeleteState/u);
  assert.match(ownerAccess, /DbUserContextTransactionClient/u);
  assert.match(ownerAccess, /FROM public\.grainline_listing_owner_hard_delete\(/u);

  assert.match(
    listingDelete,
    /hardDeleteListingOwnerDeleteState\(\s*tx,\s*normalizedListingId,\s*listing\.updatedAt,?\s*\)/u,
  );
  assert.doesNotMatch(listingDelete, /tx\.photo\.deleteMany/u);
  assert.doesNotMatch(listingDelete, /tx\.listing\.deleteMany/u);
  assert.match(listingDelete, /withSerializableDbUserContext/u);

  assert.match(
    provision,
    /public\."grainline_listing_owner_hard_delete"\(text,timestamp without time zone\)'\s*,\s*true/u,
  );
});
