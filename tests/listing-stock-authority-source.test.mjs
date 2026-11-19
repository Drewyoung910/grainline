import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("manual stock locks and updates use actor-bound Listing authorities", async () => {
  const [migration, stockAccess, route, provision, inventory, scenario] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingStockMutation.ts", root), "utf8"),
    readFile(new URL("src/app/api/listings/[id]/stock/route.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tests/db-grant-inventory.test.mjs", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-owner-mutations.mjs", root), "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_stock_lock\(\s*p_listing_id text,\s*p_expected_seller_profile_id text\s*\)/u,
  );
  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_stock_apply\(\s*p_listing_id text,\s*p_expected_seller_profile_id text,\s*p_apply_delta boolean,\s*p_stock_delta integer,\s*p_quantity integer\s*\)/u,
  );
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /FOR UPDATE OF listing/u);
  assert.match(stockAccess, /grainline_listing_owner_stock_lock/u);
  assert.match(stockAccess, /export async function applyListingStockMutation\(/u);
  assert.match(stockAccess, /grainline_listing_owner_stock_apply/u);
  assert.doesNotMatch(stockAccess, /FROM "Listing"/u);
  assert.match(route, /withDbUserContext\(me\.id, async \(tx\) =>/u);
  assert.match(route, /applyListingStockMutation\(tx, \{/u);
  assert.doesNotMatch(route, /UPDATE "Listing"|FROM "Listing"/u);
  for (const signature of [
    'grainline_listing_owner_stock_lock"\\(text,text\\)',
    'grainline_listing_owner_stock_apply"\\(text,text,boolean,integer,integer\\)',
  ]) assert.match(provision, new RegExp(signature, "u"));
  assert.match(inventory, /"grainline_listing_owner_stock_lock"/u);
  assert.match(inventory, /"grainline_listing_owner_stock_apply"/u);
  for (const evidence of [
    "owner stock apply preserves checkout consumption",
    "owner stock apply performs the active sold-out transition",
    "cross-owner stock lock is empty",
  ]) assert.match(scenario, new RegExp(evidence, "u"));
});
