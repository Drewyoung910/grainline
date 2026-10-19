import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261019210000_prepare_seller_profile_owner_listing_metro_source/migration.sql";
const helperPath = "src/lib/sellerProfileOwnerAccess.ts";
const callerPath = "src/app/dashboard/listings/new/page.tsx";

test("owner listing metro source converts the exact-location listing consumer", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const helper = readFileSync(helperPath, "utf8");
  const caller = readFileSync(callerPath, "utf8");

  assert.match(migration, /grainline_seller_owner_listing_metro_source\([\s\S]*p_seller_profile_id text/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /seller\.id = p_seller_profile_id/u);
  assert.match(migration, /account_user\.banned = false/u);
  assert.match(migration, /account_user\."deletedAt" IS NULL/u);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO grainline_app_runtime/u);
  assert.match(helper, /export function sellerOwnerListingMetroSource/u);
  assert.match(helper, /withDbUserContext/u);
  assert.doesNotMatch(caller, /prisma\.sellerProfile\./u);
  assert.match(
    caller,
    /sellerOwnerListingMetroSource\(seller\.userId, seller\.id\)/u,
  );
  assert.match(caller, /findOrCreateMetro\(sellerLocation\.lat, sellerLocation\.lng\)/u);
});
