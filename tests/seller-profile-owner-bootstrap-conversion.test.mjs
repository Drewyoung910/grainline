import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261020120000_prepare_seller_profile_owner_bootstrap/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerProfileOwnerAccess.ts", "utf8");
const ensureSeller = readFileSync("src/lib/ensureSeller.ts", "utf8");

test("seller bootstrap is one actor-bound idempotent database operation", () => {
  assert.match(migration, /grainline_seller_owner_bootstrap\(/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /account_user\.banned = false/u);
  assert.match(migration, /account_user\."deletedAt" IS NULL/u);
  assert.match(migration, /ON CONFLICT DO NOTHING/u);
  assert.match(migration, /SET search_path = pg_catalog/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/u);
});

test("ensureSeller no longer has a find-then-create SellerProfile race", () => {
  assert.match(access, /grainline_seller_owner_bootstrap/u);
  assert.match(access, /withDbUserContext\(userId/u);
  assert.match(ensureSeller, /sellerOwnerBootstrap\(me\.id/u);
  assert.match(ensureSeller, /proposedSellerProfileId: randomUUID\(\)/u);
  assert.doesNotMatch(ensureSeller, /prisma\.sellerProfile\./u);
  assert.doesNotMatch(ensureSeller, /sellerBootstrapSelect/u);
});
