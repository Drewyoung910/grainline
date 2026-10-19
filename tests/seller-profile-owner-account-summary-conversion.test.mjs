import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const migration = source(
  "prisma/migrations/20261019160000_prepare_seller_profile_owner_account_summary/migration.sql",
);

test("owner account surfaces use one actor-bound SellerProfile summary", () => {
  const access = source("src/lib/sellerProfileOwnerAccess.ts");
  const meRoute = source("src/app/api/me/route.ts");
  const accountPage = source("src/app/account/page.tsx");
  const settingsPage = source("src/app/account/settings/page.tsx");

  assert.match(access, /withDbUserContext\(userId/u);
  assert.match(access, /grainline_seller_owner_account_summary\(\)/u);
  for (const caller of [meRoute, accountPage, settingsPage]) {
    assert.match(caller, /sellerOwnerAccountSummary\(user\.id\)|sellerOwnerAccountSummary\(me\.id\)/u);
    assert.doesNotMatch(caller, /prisma\.sellerProfile/u);
  }
});

test("owner account summary owns actor validation and exact grants", () => {
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /account_user\.banned = false/u);
  assert.match(migration, /account_user\."deletedAt" IS NULL/u);
  assert.match(migration, /listing\.status = 'ACTIVE'/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.grainline_seller_owner_account_summary\(\)\s+FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_seller_owner_account_summary\(\)\s+TO grainline_app_runtime/u,
  );
});
