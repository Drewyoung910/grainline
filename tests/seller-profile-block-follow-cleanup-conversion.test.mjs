import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/users/[id]/block/route.ts", "utf8");
const access = readFileSync("src/lib/blockMutationAccess.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261019140000_prepare_seller_profile_block_follow_cleanup/migration.sql",
  "utf8",
);

test("blocking delegates reciprocal follow cleanup to one actor-bound authority", () => {
  assert.match(route, /cleanupUserBlockFollows\(me\.id, blockedId\)/u);
  assert.doesNotMatch(route, /prisma\.sellerProfile|prisma\.follow/u);
  assert.match(access, /withDbUserContext\(blockerId/u);
  assert.match(access, /grainline_user_block_follow_cleanup\(\$\{blockedId\}::text\)/u);
  assert.match(access, /TransactionIsolationLevel\.ReadCommitted/u);
});

test("block follow cleanup is exact, contextual, and runtime-only", () => {
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /grainline_user_block_pair_lock\(p_target_user_id\)/u);
  assert.match(migration, /relationship\."blockerId" = request_user_id/u);
  assert.match(migration, /relationship\."blockedId" = p_target_user_id/u);
  assert.match(migration, /DELETE FROM public\."Follow" AS following/u);
  assert.match(migration, /GET DIAGNOSTICS deleted_count = ROW_COUNT/u);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.grainline_user_block_follow_cleanup\(text\)\s+FROM PUBLIC, grainline_app_runtime/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_user_block_follow_cleanup\(text\)\s+TO grainline_app_runtime/u,
  );
});
