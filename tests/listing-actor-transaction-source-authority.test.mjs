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

  const coreStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_actor_transaction_source_core(",
  );
  const sourceStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_actor_transaction_source(",
    coreStart,
  );
  const sourceEnd = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_actor_cart_transaction_sources(",
    sourceStart,
  );
  assert.ok(coreStart >= 0 && sourceStart > coreStart && sourceEnd > sourceStart);
  const core = migration.slice(coreStart, sourceStart);
  const authority = migration.slice(sourceStart, sourceEnd);

  assert.match(core, /current_setting\('app\.user_id', true\)/u);
  assert.match(core, /listing\."archivedAt" IS NULL/u);
  assert.match(core, /listing\."reservedForUserId" = actor_id/u);
  assert.match(core, /jsonb_agg[\s\S]*public\."ListingVariantOption"/u);
  assert.match(core, /jsonb_agg[\s\S]*public\."Photo"/u);
  assert.match(
    core,
    /REVOKE ALL ON FUNCTION public\.grainline_listing_actor_transaction_source_core\(text,boolean\)[\s\S]*FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    authority,
    /grainline_listing_actor_transaction_source_core\(\s*p_listing_id,\s*false\s*\)/u,
  );
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
