import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261020200000_prepare_seller_profile_owner_profile_editor/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerOwnerPrivateAccess.ts", "utf8");
const profilePage = readFileSync("src/app/dashboard/profile/page.tsx", "utf8");
const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

test("profile-editor state and updates use actor-bound fixed operations", () => {
  assert.match(migration, /grainline_seller_owner_profile_editor_state/u);
  assert.match(migration, /grainline_seller_owner_profile_update/u);
  assert.equal([...migration.matchAll(/current_setting\('app\.user_id', true\)/gu)].length, 2);
  assert.equal([...migration.matchAll(/actor\.banned = false/gu)].length, 2);
  assert.equal([...migration.matchAll(/actor\."deletedAt" IS NULL/gu)].length, 2);
  assert.equal([...migration.matchAll(/SET search_path = pg_catalog/gu)].length, 2);
  assert.match(migration, /FOR UPDATE OF seller/u);
  assert.match(migration, /pg_catalog\.lower\(candidate\."displayName"\)/u);
  assert.match(access, /grainline_seller_owner_profile_editor_state/u);
  assert.match(access, /grainline_seller_owner_profile_update/u);
  assert.doesNotMatch(access, /duplicateSellerOwnerDisplayName/u);
  assert.doesNotMatch(access, /sellerProfileEditorSelect/u);
  assert.match(profilePage, /withDbUserContext\(seller\.userId, async \(tx\)/u);
  assert.match(profilePage, /duplicateDisplayName = result\.duplicateDisplayName/u);
  assert.doesNotMatch(profilePage, /duplicateSellerOwnerDisplayName/u);
  assert.equal(
    [...provision.matchAll(/grainline_seller_owner_profile_editor_state/g)].length,
    2,
  );
  assert.equal(
    [...provision.matchAll(/grainline_seller_owner_profile_update/g)].length,
    2,
  );
});
