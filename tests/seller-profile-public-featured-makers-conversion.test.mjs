import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync("src/app/page.tsx", "utf8");
const helper = readFileSync("src/lib/sellerProfilePublicAccess.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261019090000_prepare_seller_profile_public_featured_makers/migration.sql",
  "utf8",
);

test("homepage featured makers use only the bounded database authority", () => {
  assert.match(home, /sellerPublicFeaturedMakers\(\)/u);
  assert.match(home, /home-featured-makers-v5/u);
  assert.doesNotMatch(home, /prisma\.sellerProfile/u);
  assert.doesNotMatch(home, /activeSellerProfileWhere/u);
  assert.doesNotMatch(home, /FROM\s+"SellerProfile"/u);

  assert.match(helper, /grainline_seller_public_featured_makers\(\)/u);
  assert.match(helper, /makers\.length > 2/u);
  assert.match(helper, /new Set\(makers\.map\(\(maker\) => maker\.id\)\)/u);
});

test("featured-maker authority owns the exact three-tier deterministic selection", () => {
  for (const predicate of [
    /"ownerAccountActive" = true/u,
    /"chargesEnabled" = true/u,
    /"stripeAccountSupported" = true/u,
    /"vacationMode" = false/u,
  ]) {
    assert.match(migration, predicate);
  }
  assert.match(
    migration,
    /ORDER BY \(active\.profile\)\."featuredUntil" DESC,[\s\S]*\(active\.profile\)\.id ASC/u,
  );
  assert.match(migration, /'GUILD_MEMBER', 'GUILD_MASTER'/u);
  assert.match(migration, /date_trunc\([\s\S]*'week'/u);
  assert.match(
    migration,
    /ORDER BY COALESCE\(summary\."reviewCount", 0\) DESC,[\s\S]*LIMIT 4/u,
  );
  assert.match(migration, /ORDER BY selected\.selection_rank ASC\s+LIMIT 2/u);
});

test("featured-maker authority exposes only runtime execution", () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.grainline_seller_public_featured_makers\(\)\s+FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_seller_public_featured_makers\(\)\s+TO grainline_app_runtime/u,
  );
  assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]*TO PUBLIC/u);
});
