import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261020010000_prepare_seller_profile_owner_vacation_update/migration.sql";
const route = readFileSync("src/app/api/seller/vacation/route.ts", "utf8");
const helper = readFileSync("src/lib/sellerProfileOwnerAccess.ts", "utf8");

test("vacation route uses the bounded owner mutation authority", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(migration, /grainline_seller_owner_vacation_update/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(helper, /export function sellerOwnerVacationUpdate/u);
  assert.match(route, /sellerOwnerVacationUpdate\(seller\.userId,/u);
  assert.doesNotMatch(route, /prisma\.sellerProfile\./u);
});
