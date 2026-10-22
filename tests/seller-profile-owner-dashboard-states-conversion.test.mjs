import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261020190000_prepare_seller_profile_owner_dashboard_states/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerOwnerPrivateAccess.ts", "utf8");
const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

test("Guild and Shop Settings owner reads use actor-bound projections", () => {
  assert.match(migration, /grainline_seller_owner_guild_dashboard_state/u);
  assert.match(migration, /grainline_seller_owner_shop_settings_state/u);
  assert.equal([...migration.matchAll(/current_setting\('app\.user_id', true\)/gu)].length, 2);
  assert.equal([...migration.matchAll(/actor\.banned = false/gu)].length, 2);
  assert.equal([...migration.matchAll(/actor\."deletedAt" IS NULL/gu)].length, 2);
  assert.equal([...migration.matchAll(/SET search_path = pg_catalog/gu)].length, 2);
  assert.match(migration, /LEFT JOIN public\."MakerVerification"/u);
  assert.match(access, /grainline_seller_owner_guild_dashboard_state/u);
  assert.match(access, /grainline_seller_owner_shop_settings_state/u);
  assert.doesNotMatch(access, /sellerOwnerGuildDashboardSelect/u);
  assert.doesNotMatch(access, /sellerSettingsOwnerSelect/u);
  assert.equal(
    [...provision.matchAll(/grainline_seller_owner_guild_dashboard_state/g)].length,
    2,
  );
  assert.equal(
    [...provision.matchAll(/grainline_seller_owner_shop_settings_state/g)].length,
    2,
  );
});
