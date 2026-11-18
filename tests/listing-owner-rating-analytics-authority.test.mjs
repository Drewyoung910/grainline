import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("seller rating history uses one actor-bound Listing-domain aggregate", async () => {
  const [migration, access, analytics, provision, scenario] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingOwnerAccess.ts", root), "utf8"),
    readFile(new URL("src/app/api/seller/analytics/route.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-owner-mutations.mjs", root), "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_rating_buckets\(\s*p_start_epoch_millis bigint,\s*p_end_epoch_millis bigint,\s*p_end_exclusive boolean\s*\)/u,
  );
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_rating_buckets\(\s*bigint,bigint,boolean\s*\)[\s\S]*TO grainline_app_runtime/u,
  );
  assert.match(access, /export function listingOwnerRatingBuckets\(/u);
  assert.match(access, /FROM public\.grainline_listing_owner_rating_buckets\(/u);
  assert.match(analytics, /listingOwnerRatingBuckets\(me\.id, \{/u);
  assert.doesNotMatch(analytics, /JOIN "Listing" l ON l\.id = r\."listingId"/u);
  assert.match(
    provision,
    /public\."grainline_listing_owner_rating_buckets"\(bigint,bigint,boolean\)'\s*,\s*true/u,
  );
  for (const evidence of [
    "owner rating buckets preserve monthly averages",
    "cross-owner rating buckets are empty",
    "missing-actor rating buckets fail closed",
  ]) assert.match(scenario, new RegExp(evidence, "u"));
});
