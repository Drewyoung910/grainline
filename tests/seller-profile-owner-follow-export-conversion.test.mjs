import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261020235910_prepare_seller_profile_owner_follow_export/migration.sql";

test("account export reads followed-shop labels through an actor-bound authority", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const helper = readFileSync("src/lib/sellerProfileParticipantAccess.ts", "utf8");
  const route = readFileSync("src/app/api/account/export/route.ts", "utf8");

  assert.match(migration, /grainline_seller_owner_follow_export\(\)/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /public\."Follow"/u);
  assert.match(migration, /AT TIME ZONE 'UTC'/u);
  assert.match(helper, /export function sellerOwnerFollowExportRows/u);
  assert.match(route, /sellerOwnerFollowExportRows\(user\.id\)/u);
  assert.doesNotMatch(route, /prisma\.follow\.findMany/u);
  assert.doesNotMatch(route, /sellerProfile:\s*\{\s*select:\s*\{\s*displayName/u);
});
