import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("listing account deletion is bound to the durable local-anonymize claim", async () => {
  const [migration, wrapper, deletion, provision, fullChainScenario] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingAccountDeletionAccess.ts", root), "utf8"),
    readFile(new URL("src/lib/accountDeletion.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-owner-mutations.mjs", root), "utf8"),
  ]);

  const start = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_account_deletion_redact(",
  );
  const end = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_delete_lock(",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const authority = migration.slice(start, end);

  assert.match(authority, /grainline_account_deletion_claim_user\(/u);
  assert.match(authority, /claimed_user_id IS DISTINCT FROM p_expected_user_id/u);
  assert.match(authority, /pg_catalog\.array_agg\(listing\.id ORDER BY listing\.id\)/u);
  assert.match(authority, /DELETE FROM public\."Photo"/u);
  assert.match(authority, /DELETE FROM public\."ListingVariantGroup"/u);
  assert.match(authority, /title = 'Deleted listing'/u);
  assert.match(authority, /status = 'HIDDEN'/u);
  assert.match(authority, /"rejectionReason" = 'Seller account deleted'/u);
  assert.match(authority, /GRANT EXECUTE ON FUNCTION public\.grainline_listing_account_deletion_redact/u);

  assert.match(wrapper, /export async function redactListingsForAccountDeletion/u);
  assert.match(wrapper, /grainline_listing_account_deletion_redact/u);
  assert.match(wrapper, /listingIds: Object\.freeze\(\[\.\.\.row\.listing_ids\]\)/u);
  assert.match(deletion, /redactListingsForAccountDeletion\(tx,/u);
  assert.match(deletion, /listingDeletion\.listingIds/u);
  assert.doesNotMatch(deletion, /tx\.photo\.deleteMany/u);
  assert.doesNotMatch(deletion, /tx\.listingVariantGroup\.deleteMany/u);
  assert.doesNotMatch(deletion, /tx\.listing\.updateMany/u);
  assert.doesNotMatch(deletion, /tx\.listing\.findMany/u);

  assert.match(
    provision,
    /public\."grainline_listing_account_deletion_redact"\(text,text,bigint,uuid,timestamp without time zone\)/u,
  );
  assert.match(fullChainScenario, /Listing deletion authority must reject a mismatched claimed user/u);
  assert.match(fullChainScenario, /Listing deletion authority must remove children and redact the parent/u);
});
