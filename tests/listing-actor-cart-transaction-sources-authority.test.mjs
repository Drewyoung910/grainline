import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("cart display, checkout, resume, shipping and export share one actor-bound listing source", async () => {
  const [migration, listingAccess, cartAccess, provision] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/sellerTransactionAccess.ts", root), "utf8"),
    readFile(new URL("src/lib/cartOwnerAccess.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
  ]);

  const sourceStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_actor_cart_transaction_sources(",
  );
  const sourceEnd = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_ai_review_context(",
    sourceStart,
  );
  assert.ok(sourceStart >= 0 && sourceEnd > sourceStart);
  const authority = migration.slice(sourceStart, sourceEnd);
  assert.match(authority, /current_setting\('app\.user_id', true\)/u);
  assert.match(authority, /cart\."userId" = actor\.id/u);
  assert.match(authority, /actor\.id = actor_id/u);
  assert.match(
    authority,
    /grainline_listing_actor_transaction_source_core\(\s*cart_item\."listingId",\s*true\s*\)/u,
  );
  assert.match(
    authority,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_actor_cart_transaction_sources\(text\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(listingAccess, /grainline_listing_actor_cart_transaction_sources/u);
  assert.match(cartAccess, /readListingActorCartTransactionSources/u);
  assert.doesNotMatch(cartAccess, /include:\s*\{\s*listing:\s*true/u);
  assert.doesNotMatch(cartAccess, /listing:\s*\{\s*include:/u);
  assert.doesNotMatch(cartAccess, /listing:\s*\{\s*select:/u);
  assert.match(
    provision,
    /public\."grainline_listing_actor_cart_transaction_sources"\(text\)'\s*,\s*true/u,
  );
});
