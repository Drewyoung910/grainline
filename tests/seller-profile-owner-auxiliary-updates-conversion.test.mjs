import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261020170000_prepare_seller_profile_owner_auxiliary_updates/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerOwnerPrivateAccess.ts", "utf8");
const profilePage = readFileSync("src/app/dashboard/profile/page.tsx", "utf8");
const sellerPage = readFileSync("src/app/dashboard/seller/page.tsx", "utf8");
const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

test("owner auxiliary SellerProfile writes are actor-bound fixed operations", () => {
  const metroHelper = access.slice(
    access.indexOf("export function updateSellerOwnerMetroAssignment"),
    access.indexOf("export async function updateSellerOwnerProfile"),
  );
  const avatarHelper = access.slice(
    access.indexOf("export async function clearSellerOwnerAvatar"),
    access.indexOf("export function toggleSellerOwnerFeaturedListing"),
  );
  assert.match(migration, /grainline_seller_owner_avatar_clear/u);
  assert.match(migration, /grainline_seller_owner_metro_assignment_update/u);
  assert.equal([...migration.matchAll(/current_setting\('app\.user_id', true\)/gu)].length, 2);
  assert.equal([...migration.matchAll(/SET search_path = pg_catalog/gu)].length, 2);
  assert.equal([...migration.matchAll(/actor\.banned = false/gu)].length, 2);
  assert.equal([...migration.matchAll(/actor\."deletedAt" IS NULL/gu)].length, 2);
  assert.match(access, /DbUserContextTransactionClient/u);
  assert.match(access, /grainline_seller_owner_avatar_clear/u);
  assert.match(access, /grainline_seller_owner_metro_assignment_update/u);
  assert.doesNotMatch(metroHelper, /sellerProfile\.updateMany/u);
  assert.doesNotMatch(avatarHelper, /sellerProfile\.updateMany/u);
  assert.match(profilePage, /withDbUserContext\(seller\.userId, async \(tx\)/u);
  assert.match(sellerPage, /updateSellerOwnerMetroAssignment\(seller\.userId/u);
  assert.equal(
    [...provision.matchAll(/grainline_seller_owner_avatar_clear/g)].length,
    2,
  );
  assert.equal(
    [...provision.matchAll(/grainline_seller_owner_metro_assignment_update/g)].length,
    2,
  );
});
