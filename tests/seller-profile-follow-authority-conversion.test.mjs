import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const migration = source(
  "prisma/migrations/20261019170000_prepare_seller_profile_follow_authority/migration.sql",
);

test("follow endpoint uses fixed read, create, and delete authorities", () => {
  const route = source("src/app/api/follow/[sellerId]/route.ts");
  const access = source("src/lib/sellerFollowAccess.ts");

  assert.match(route, /sellerPublicFollowState\(/u);
  assert.match(route, /createSellerFollow\(me\.id, sellerId\)/u);
  assert.match(route, /deleteSellerFollow\(me\.id, sellerId\)/u);
  assert.doesNotMatch(route, /prisma\.(sellerProfile|follow|block)/u);
  assert.doesNotMatch(route, /visibleSellerProfileWhere/u);
  assert.match(access, /withDbUserContext\(actorUserId/u);
  assert.match(access, /randomUUID\(\)/u);
});

test("following page uses only the owner-bound page authorities", () => {
  const page = source("src/app/account/following/page.tsx");
  const access = source("src/lib/sellerFollowAccess.ts");

  assert.match(page, /sellerOwnerFollowingCount\(me\.id\)/u);
  assert.match(
    page,
    /sellerOwnerFollowingPage\(\s*me\.id,\s*PAGE_SIZE,\s*\(page - 1\) \* PAGE_SIZE/u,
  );
  assert.doesNotMatch(page, /prisma\.follow|visibleSellerProfileWhere|publicListingWhere/u);
  assert.match(access, /grainline_seller_owner_following_count/u);
  assert.match(access, /grainline_seller_owner_following_page/u);
});

test("follow creation shares the sorted block-pair lock and exact grants", () => {
  assert.match(migration, /grainline_user_block_pair_lock\(target_user_id\)/u);
  assert.match(migration, /ON CONFLICT \("followerId", "sellerProfileId"\) DO NOTHING/u);
  assert.match(migration, /relationship\."blockerId" = request_user_id/u);
  assert.match(migration, /relationship\."blockedId" = request_user_id/u);
  for (const signature of [
    "grainline_seller_public_follow_state(text)",
    "grainline_seller_public_follow_create(text,text)",
    "grainline_seller_public_follow_delete(text)",
    "grainline_seller_owner_following_count()",
    "grainline_seller_owner_following_page(integer,integer)",
  ]) {
    const escaped = signature
      .replace(/[()]/gu, "\\$&")
      .replace(/,/gu, ",\\s*");
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped}`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped}`));
  }
});
