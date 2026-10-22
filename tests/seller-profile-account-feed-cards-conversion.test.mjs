import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20261020040000_prepare_seller_profile_account_feed_cards/migration.sql";
const route = readFileSync("src/app/api/account/feed/route.ts", "utf8");

test("account feed uses the actor-bound followed-seller card authority", () => {
  assert.equal(existsSync(migrationPath), true);
  const migration = readFileSync(migrationPath, "utf8");
  const helper = readFileSync("src/lib/sellerProfileParticipantAccess.ts", "utf8");

  assert.match(migration, /grainline_seller_actor_account_feed_cards\(text\[\]\)/u);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /public\."Follow"/u);
  assert.match(migration, /public\."Block"/u);
  assert.match(helper, /export function sellerActorAccountFeedCards/u);
  assert.match(route, /sellerActorAccountFeedCards\(me\.id, sellerIds\)/u);
  assert.doesNotMatch(route, /prisma\.sellerProfile|activeSellerProfileWhere/u);
  assert.doesNotMatch(route, /seller:\s*\{|sellerProfile:\s*\{/u);
});
