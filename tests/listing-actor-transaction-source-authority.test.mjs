import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("single-listing cart and checkout reads use one actor-bound transaction source", async () => {
  const [migration, access, provision] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/sellerTransactionAccess.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
  ]);

  const sourceStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_actor_transaction_source(",
  );
  const sourceEnd = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_ai_review_context(",
    sourceStart,
  );
  assert.ok(sourceStart >= 0 && sourceEnd > sourceStart);
  const authority = migration.slice(sourceStart, sourceEnd);

  assert.match(authority, /current_setting\('app\.user_id', true\)/u);
  assert.match(authority, /listing\."archivedAt" IS NULL/u);
  assert.match(authority, /listing\."reservedForUserId" = actor_id/u);
  assert.match(authority, /jsonb_agg[\s\S]*public\."ListingVariantOption"/u);
  assert.match(authority, /jsonb_agg[\s\S]*public\."Photo"/u);
  assert.match(
    authority,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_actor_transaction_source\(text\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(access, /FROM public\.grainline_listing_actor_transaction_source\(/u);
  assert.doesNotMatch(access, /client\.listing\.findUnique/u);
  assert.match(
    provision,
    /public\."grainline_listing_actor_transaction_source"\(text\)'\s*,\s*true/u,
  );
});
