import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/lib/footerMetros.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261019120000_prepare_seller_profile_public_footer_metros/migration.sql",
  "utf8",
);

test("footer metro cache uses only its bounded SellerProfile authority", () => {
  assert.match(source, /sellerPublicFooterMetros\(\)/u);
  assert.doesNotMatch(source, /prisma\.metro|activeSellerProfileWhere|publicListingWhere/u);
  assert.match(source, /unstable_cache/u);
  assert.match(source, /FOOTER_METROS_CACHE_TAG/u);
});

test("footer metro authority retains exact runtime-only execution", () => {
  assert.match(migration, /grainline_seller_public_footer_metros/u);
  assert.match(migration, /LIMIT 10/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.grainline_seller_public_footer_metros\(\)/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_seller_public_footer_metros\(\)[\s\S]*TO grainline_app_runtime/u);
});
