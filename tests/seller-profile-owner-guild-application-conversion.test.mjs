import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261020110000_prepare_seller_profile_owner_guild_application_state/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerOwnerPrivateAccess.ts", "utf8");
const route = readFileSync("src/app/api/verification/apply/route.ts", "utf8");

test("owner Guild application state is actor-bound and narrowly projected", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.grainline_seller_owner_guild_application_state\(/u,
  );
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /account_user\.banned = false/u);
  assert.match(migration, /account_user\."deletedAt" IS NULL/u);
  assert.match(migration, /seller\.id = p_seller_profile_id/u);
  assert.match(migration, /SET search_path = pg_catalog/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/u);
});

test("Guild application callers no longer read SellerProfile directly", () => {
  assert.match(access, /grainline_seller_owner_guild_application_state/u);
  assert.match(access, /withDbUserContext\(userId/u);
  assert.match(route, /sellerOwnerGuildApplicationState\(seller\.id, me\.id\)/u);
  assert.doesNotMatch(route, /prisma\.sellerProfile\./u);
  assert.doesNotMatch(access, /sellerOwnerGuildApplicationSelect/u);
});
