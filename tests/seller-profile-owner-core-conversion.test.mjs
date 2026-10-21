import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261019180000_prepare_seller_profile_owner_core/migration.sql";
const helperPath = "src/lib/sellerProfileOwnerAccess.ts";
const callerPaths = [
  "src/app/api/seller/analytics/recent-sales/route.ts",
  "src/app/api/seller/analytics/route.ts",
  "src/app/api/seller/broadcast/route.ts",
  "src/app/api/upload/image/route.ts",
  "src/app/api/upload/presign/route.ts",
  "src/app/dashboard/sales/page.tsx",
  "src/app/dashboard/sales/[orderId]/page.tsx",
  "src/app/seller/[id]/shop/actions.ts",
];

test("owner core converts analytics, broadcast, and seller-upload lookups", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const helper = readFileSync(helperPath, "utf8");
  assert.match(migration, /grainline_seller_owner_core\(\)/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /account_user\.banned = false/u);
  assert.match(migration, /account_user\."deletedAt" IS NULL/u);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO grainline_app_runtime/u);
  assert.match(helper, /export function sellerOwnerCore/u);
  assert.match(helper, /withDbUserContext\(userId, readSellerOwnerCore\)/u);

  for (const callerPath of callerPaths) {
    const caller = readFileSync(callerPath, "utf8");
    assert.doesNotMatch(caller, /(?:prisma|tx|client|db)\.sellerProfile\./u);
    assert.match(caller, /sellerOwnerCore/u);
  }

  const shopActions = readFileSync("src/app/seller/[id]/shop/actions.ts", "utf8");
  assert.match(shopActions, /sellerId: seller\.sellerProfileId/u);
  assert.doesNotMatch(shopActions, /(?:select|include): \{ seller:/u);
});
