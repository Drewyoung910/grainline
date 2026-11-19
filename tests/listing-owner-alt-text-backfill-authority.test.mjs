import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("listing AI alt-text backfill is owner- and reviewed-image-bound", async () => {
  const [migration, helper, provision, fullChainScenario] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/photoAltTextBackfill.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-owner-mutations.mjs", root), "utf8"),
  ]);

  const start = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_alt_text_backfill(",
  );
  const end = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_delete_lock(",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const authority = migration.slice(start, end);

  assert.match(authority, /current_setting\('app\.user_id', true\)/u);
  assert.match(authority, /listing\."sellerId" = seller_id/u);
  assert.match(authority, /array_agg\(photo\.url ORDER BY photo\."sortOrder", photo\.id\)/u);
  assert.match(authority, /IS DISTINCT FROM p_reviewed_image_urls/u);
  assert.match(authority, /photo\."altText" IS NULL OR photo\."altText" = ''/u);
  assert.match(authority, /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_alt_text_backfill/u);

  assert.match(helper, /withDbUserContext\(actorUserId, async \(client\) =>/u);
  assert.match(helper, /grainline_listing_owner_alt_text_backfill\(/u);
  assert.doesNotMatch(helper, /prisma\.photo\.(?:findMany|updateMany)/u);

  assert.match(
    provision,
    /public\."grainline_listing_owner_alt_text_backfill"\(text,text\[\],text\[\]\)'\s*,\s*true/u,
  );

  assert.match(fullChainScenario, /AI backfill must preserve seller-provided alt text/u);
  assert.match(fullChainScenario, /AI backfill must reject a stale reviewed image sequence/u);
  assert.match(fullChainScenario, /AI backfill must reject a cross-owner actor/u);
});
