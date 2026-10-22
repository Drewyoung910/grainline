import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261019190000_prepare_seller_profile_owner_blog_editor/migration.sql";
const helperPath = "src/lib/sellerProfileOwnerAccess.ts";
const callerPaths = [
  "src/app/dashboard/blog/new/page.tsx",
  "src/app/dashboard/blog/[id]/edit/page.tsx",
];

test("owner blog editor converts dashboard blog seller lookups", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const helper = readFileSync(helperPath, "utf8");
  assert.match(migration, /grainline_seller_owner_blog_editor\(\)/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /account_user\.banned = false/u);
  assert.match(migration, /account_user\."deletedAt" IS NULL/u);
  assert.match(migration, /listing\.status = 'ACTIVE'::public\."ListingStatus"/u);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO grainline_app_runtime/u);
  assert.match(helper, /export function sellerOwnerBlogEditor/u);
  assert.match(helper, /withDbUserContext\(userId, readSellerOwnerBlogEditor\)/u);

  for (const callerPath of callerPaths) {
    const caller = readFileSync(callerPath, "utf8");
    assert.doesNotMatch(caller, /(?:prisma|tx|client|db)\.sellerProfile\./u);
    assert.match(caller, /sellerOwnerBlogEditor/u);
  }
});
