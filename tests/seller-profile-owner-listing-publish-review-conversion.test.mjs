import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261019220000_prepare_seller_profile_owner_listing_publish_review/migration.sql";
const helperPath = "src/lib/sellerProfileOwnerAccess.ts";
const callerPath = "src/app/seller/[id]/shop/actions.ts";

test("owner listing publish review replaces both publish-state seller reads", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const helper = readFileSync(helperPath, "utf8");
  const caller = readFileSync(callerPath, "utf8");

  assert.match(migration, /grainline_seller_owner_listing_publish_review\(/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /listing\.status IN \([\s\S]*'ACTIVE'[\s\S]*'SOLD'[\s\S]*'SOLD_OUT'/u);
  assert.match(migration, /seller\.id = p_seller_profile_id/u);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO grainline_app_runtime/u);
  assert.match(helper, /export function sellerOwnerListingPublishReview/u);
  assert.doesNotMatch(caller, /prisma\.sellerProfile\./u);
  assert.match(
    caller,
    /sellerOwnerListingPublishReview\(\s*listing\.seller\.userId,\s*listing\.sellerId,?\s*\)/u,
  );
  assert.match(caller, /sellerReview\.publishReviewListingCount/u);
});
