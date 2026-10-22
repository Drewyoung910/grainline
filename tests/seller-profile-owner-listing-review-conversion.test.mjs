import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261019200000_prepare_seller_profile_owner_listing_review/migration.sql";
const helperPath = "src/lib/sellerProfileOwnerAccess.ts";
const callerPaths = [
  "src/app/dashboard/listings/new/page.tsx",
  "src/app/dashboard/listings/custom/page.tsx",
];

test("owner listing review converts the two listing-moderation seller counts", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const helper = readFileSync(helperPath, "utf8");
  assert.match(migration, /grainline_seller_owner_listing_review\(\)/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /account_user\.banned = false/u);
  assert.match(migration, /account_user\."deletedAt" IS NULL/u);
  assert.match(migration, /pg_catalog\.count\(listing\.id\)/u);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO grainline_app_runtime/u);
  assert.match(helper, /export function sellerOwnerListingReview/u);
  assert.match(helper, /withDbUserContext\(userId, readSellerOwnerListingReview\)/u);

  for (const callerPath of callerPaths) {
    const caller = readFileSync(callerPath, "utf8");
    assert.doesNotMatch(caller, /const sellerInfo = await prisma\.sellerProfile\.findUnique/u);
    assert.match(caller, /sellerOwnerListingReview\(seller\.userId\)/u);
    assert.match(caller, /sellerInfo\?\.totalListingCount \?\? 0/u);
  }
});
