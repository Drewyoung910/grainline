import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("seller rating summary refresh uses one derived Listing-domain authority", async () => {
  const [migration, access, provision, inventory, scenario] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/sellerRatingSummary.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tests/db-grant-inventory.test.mjs", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-owner-mutations.mjs", root), "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_seller_rating_summary_refresh\(\s*p_seller_profile_id text\s*\)/u,
  );
  assert.match(
    migration,
    /INSERT INTO public\."SellerRatingSummary"[\s\S]*JOIN public\."Listing" AS listing[\s\S]*ON CONFLICT \("sellerProfileId"\) DO UPDATE/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_seller_rating_summary_refresh\(text\)[\s\S]*TO grainline_app_runtime/u,
  );
  assert.match(access, /FROM public\.grainline_listing_seller_rating_summary_refresh\(/u);
  assert.doesNotMatch(access, /JOIN "Listing"/u);
  assert.doesNotMatch(access, /sellerRatingSummary\.upsert/u);
  assert.match(
    provision,
    /public\."grainline_listing_seller_rating_summary_refresh"\(text\)'\s*,\s*true/u,
  );
  assert.match(inventory, /"grainline_listing_seller_rating_summary_refresh"/u);
  for (const evidence of [
    "seller rating refresh computes the exact aggregate",
    "seller rating refresh replaces stale summary values",
    "seller rating refresh rejects malformed seller ids",
  ]) assert.match(scenario, new RegExp(evidence, "u"));
});
