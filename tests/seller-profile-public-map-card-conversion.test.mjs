import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/seller/[id]/map-card/route.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261019100000_prepare_seller_profile_public_map_card/migration.sql",
  "utf8",
);

test("map-card endpoint uses the bounded database authority", () => {
  assert.match(route, /sellerPublicMapCard\(id\)/u);
  assert.doesNotMatch(route, /prisma\.sellerProfile/u);
  assert.doesNotMatch(route, /activeSellerProfileWhere/u);
  assert.doesNotMatch(route, /publicListingWhere/u);
  assert.match(route, /seller\.bannerImageUrl \?\? seller\.coverImageUrl \?\? null/u);
});

test("map-card authority preserves visibility, cover ordering and exact grants", () => {
  for (const predicate of [
    /"ownerAccountActive" = true/u,
    /"chargesEnabled" = true/u,
    /"stripeAccountSupported" = true/u,
    /"vacationMode" = false/u,
    /"publicMapOptIn" = true/u,
    /listing\.status::text = 'ACTIVE'/u,
    /listing\."isPrivate" = false/u,
    /listing\."archivedAt" IS NULL/u,
  ]) {
    assert.match(migration, predicate);
  }
  assert.match(migration, /ORDER BY listing\."qualityScore" DESC, listing\.id DESC/u);
  assert.match(migration, /ORDER BY photo\."sortOrder" ASC/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.grainline_seller_public_map_card\(text\)\s+FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_seller_public_map_card\(text\)\s+TO grainline_app_runtime/u,
  );
});
