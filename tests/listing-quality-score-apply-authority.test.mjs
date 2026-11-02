import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("quality-score writes use one bounded Listing-domain service authority", async () => {
  const [migration, access, quality, provision, inventory, scenario] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/sellerProfileQualityScoreAccess.ts", root), "utf8"),
    readFile(new URL("src/lib/quality-score.ts", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tests/db-grant-inventory.test.mjs", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/seller-profile-quality-score-authorities.mjs", root), "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_service_quality_score_apply\(\s*p_scores jsonb\s*\)/u,
  );
  assert.match(migration, /jsonb_array_length\(p_scores\) > 200/u);
  assert.match(migration, /score_value < 0(?:\.0)? OR score_value > 1\.2/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_service_quality_score_apply\(jsonb\)[\s\S]*TO grainline_app_runtime/u,
  );
  assert.match(access, /export async function sellerServiceApplyQualityScores\(/u);
  assert.match(access, /grainline_listing_service_quality_score_apply/u);
  assert.match(quality, /sellerServiceApplyQualityScores\(scores\)/u);
  assert.doesNotMatch(quality, /UPDATE "Listing"|\$executeRaw/u);
  assert.match(
    provision,
    /public\."grainline_listing_service_quality_score_apply"\(jsonb\)'\s*,\s*true/u,
  );
  assert.match(inventory, /"grainline_listing_service_quality_score_apply"/u);
  for (const evidence of [
    "quality-score apply updates the exact bounded batch",
    "quality-score apply rejects duplicate listing ids",
    "quality-score apply rejects out-of-range scores",
  ]) assert.match(scenario, new RegExp(evidence, "u"));
});
