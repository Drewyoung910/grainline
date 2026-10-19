import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/makers/[metroSlug]/page.tsx", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261019110000_prepare_seller_profile_public_metro_directory/migration.sql",
  "utf8",
);

test("metro maker page uses only bounded SellerProfile authorities", () => {
  assert.match(page, /sellerPublicMetroStaticSlugs\(\)/u);
  assert.match(page, /sellerPublicMetroMakers\(meDbId, metro\.id, isMajorMetro, 24\)/u);
  assert.match(page, /sellerPublicNearbyMetros\(meDbId, metro\.id\)/u);
  assert.doesNotMatch(page, /prisma\.sellerProfile|activeSellerProfileWhere|publicListingWhere/u);
  assert.doesNotMatch(page, /sellerProfiles:|sellerCityProfiles:/u);
  assert.match(page, /seller\.bannerImageUrl \?\? seller\.coverImageUrl/u);
  assert.match(page, /seller\.activeListingCount/u);
});

test("metro-directory authorities retain distinct eligibility and exact grants", () => {
  assert.match(migration, /grainline_seller_public_metro_static_slugs/u);
  assert.match(migration, /grainline_seller_public_metro_makers/u);
  assert.match(migration, /grainline_seller_public_nearby_metros/u);
  assert.match(migration, /counts\.active_listing_count > 0/u);
  assert.match(migration, /ORDER BY listing\."createdAt" DESC, listing\.id DESC/u);
  assert.match(migration, /ORDER BY photo\."sortOrder" ASC/u);
  assert.match(migration, /FROM public\."Block" AS relationship/u);
  assert.match(migration, /ORDER BY candidates\.name ASC, candidates\.slug ASC/u);
  assert.equal(
    (migration.match(/GRANT EXECUTE ON FUNCTION public\.grainline_seller_public_/gu) ?? []).length,
    3,
  );
  assert.equal(
    (migration.match(/REVOKE ALL ON FUNCTION public\.grainline_seller_public_/gu) ?? []).length,
    3,
  );
});
