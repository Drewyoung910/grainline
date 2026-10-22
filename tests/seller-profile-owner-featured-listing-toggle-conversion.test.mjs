import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261020160000_prepare_seller_profile_owner_featured_listing_toggle/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerOwnerPrivateAccess.ts", "utf8");
const page = readFileSync("src/app/dashboard/profile/page.tsx", "utf8");
const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

test("owner featured-listing toggles are actor-bound and atomic", () => {
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /FOR UPDATE OF seller/u);
  assert.match(migration, /listing\."sellerId" = p_seller_profile_id/u);
  assert.match(migration, /FOR KEY SHARE OF listing/u);
  assert.match(migration, /cardinality\(source_featured_ids\) >= 6/u);
  assert.match(migration, /SET search_path = pg_catalog/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/u);
  assert.match(access, /withDbUserContext\(userId/u);
  assert.match(access, /grainline_seller_owner_featured_listing_toggle/u);
  assert.doesNotMatch(access, /sellerOwnerFeaturedListingIds/u);
  assert.doesNotMatch(access, /updateSellerOwnerFeaturedListingIds/u);
  assert.match(page, /toggleSellerOwnerFeaturedListing\(seller\.userId/u);
  assert.doesNotMatch(page, /tx\.listing\.count/u);
  assert.equal(
    [...provision.matchAll(/grainline_seller_owner_featured_listing_toggle/g)].length,
    2,
    "runtime-role reprovisioning must revoke then restore only the reviewed EXECUTE grant",
  );
});
