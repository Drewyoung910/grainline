import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261019230000_prepare_seller_profile_owner_dashboard_state/migration.sql";
const dashboard = readFileSync("src/app/dashboard/page.tsx", "utf8");
const helper = readFileSync("src/lib/sellerProfileOwnerAccess.ts", "utf8");

test("seller dashboard uses owner authorities without SellerProfile table access", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(migration, /grainline_seller_owner_dashboard_state\(\)/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO grainline_app_runtime/u);
  assert.match(helper, /export function sellerOwnerDashboardState/u);
  assert.match(dashboard, /sellerOwnerDashboardState\(me\.id\)/u);
  assert.equal((dashboard.match(/sellerOwnerCore\(me\.id\)/gu) ?? []).length, 3);
  assert.doesNotMatch(dashboard, /prisma\.sellerProfile\./u);
  assert.doesNotMatch(dashboard, /seller:\s*\{\s*(?:select|include|userId|user):/u);
  assert.equal((dashboard.match(/sellerId:\s*sellerCore\.sellerProfileId/gu) ?? []).length, 3);
});
